# 安全审计报告 — chatgpt2api-pro (二次审查)

**日期**: 2026-05-31  
**审查轮次**: 第 2 轮（含首次修复验证）  
**范围**: Go 后端 (`server/`) + React 前端 (`web/`) + 基础设施配置  
**方法**: 全量静态代码分析 + 修复验证 + 增量检查  

---

## 一、总览

| 等级 | 数量 | 说明 |
|------|------|------|
| CRITICAL | 2 | 需立即修复 |
| HIGH | 5 | 生产部署前必须修复 |
| MEDIUM | 8 | 建议 1 周内修复 |
| LOW | 6 | 建议 1 月内修复 |
| INFO | 2 | 已接受风险 / 建议改进 |

---

## 二、已验证修复 ✅

以下项目经代码审查确认**已修复**：

| 项目 | 文件 | 修复内容 |
|------|------|----------|
| 限流器代理穿透 | `middleware/ratelimit.go:24-26` | 新增 `X-Forwarded-For` → `X-Real-IP` → `RemoteAddr` 链 |
| 注册配置密码泄露 | `api/handler.go:246-248` | `GetRegisterConfig` 序列化前置空 `mail[i].AdminPassword` |

以下缓解措施**代码中原已存在**，属于正确设计：

| 项目 | 文件 | 措施 |
|------|------|------|
| Prompt 长度限制 | `api/generations.go:78` | `len(prompt) > 2000` → 400 |
| 敏感词过滤 | `api/generations.go:85-98` | Admin 配置 `banned_words`，逗号分隔 |
| 请求体大小限制 (生图) | `api/generations.go:57` | `MaxBytesReader(10MB)` |
| 调度器参数校验 | `api/scheduler.go:27-28` | `MaxGlobal 1-50`, `MaxPerUser 1-20` 范围限制 |

---

## 三、第二次审查新发现 / 确认未修复

### CRITICAL · 2 项

#### C-01: TLS 证书验证完全禁用

**文件**: `server/internal/service/chrome_transport.go:97`

```go
uconn := utls.UClient(rawConn, &utls.Config{
    ServerName:         host,
    InsecureSkipVerify: true,  // ← 未修复
}, utls.HelloRandomizedNoALPN)
```

**风险**: 所有到 `chatgpt.com` 和 `auth.openai.com` 的 HTTPS 流量均可被中间人攻击拦截。Access token、用户 prompt、生成图片全部暴露。  
**修复建议**: 改为 `false`；如需自签证书，显式加载特定 CA。

---

#### C-02: 默认管理员硬编码密码

**文件**: `server/migrations/001_init.sql:37-38`

```sql
INSERT IGNORE INTO admins (username, password_hash) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
```

**风险**: `admin/admin123` 是公开弱密码，bcrypt hash 已被收录在多个彩虹表中，数秒即可破解。Docker Compose 部署后若未立即改密码，攻击者直接获得管理权限。  
**修复建议**: 删除种子数据；首次部署通过 `cmd/reset_admin` 工具或环境变量强制设置；增加密码复杂度要求。

---

### HIGH · 5 项

#### H-01: 管理员用户列表返回密码哈希

**文件**: `server/internal/store/mysql.go:573`

```go
rows, err := s.db.Query("SELECT id, email, password_hash, COALESCE(name,''), points, status, created_at FROM users " + where + " ORDER BY id DESC LIMIT ? OFFSET ?", args...)
```

**风险**: 管理员查看用户列表 (`GET /api/admin/users`) 返回所有用户的 bcrypt 哈希，可被离线破解。  
**修复建议**: 从 `ListUsers` 的 SQL 中移除 `password_hash` 字段。

---

#### H-02: JWT Secret 默认弱值

**文件**: `server/internal/config/config.go:41`

```go
JWTSecret: env("JWT_SECRET", "change-me"),
```

**风险**: 若部署未设环境变量，token 签名密钥为已知字符串。  
**修复建议**: 启动时检测默认值则拒绝启动，或自动生成随机密钥并打印。

---

#### H-03: OpenAI Token 明文存储在 MySQL

**文件**: `server/internal/store/mysql.go` accounts 表结构，全局引用

**风险**: 数据库泄露 = 所有 OpenAI 账号被盗。Access token 可直接调用 OpenAI API 产生费用。  
**修复建议**: 使用 AES-256-GCM 加密，密钥通过环境变量注入；条件允许可上密钥管理服务（Vault/KMS）。

---

#### H-04: SaveRegisterConfig 响应未脱敏 (新发现)

**文件**: `server/internal/api/handler.go:286`

```go
func (h *Handler) SaveRegisterConfig(w http.ResponseWriter, r *http.Request) {
    // ...
    writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})  // ← cfg 含 AdminPassword
}
```

**风险**: `GET /api/register` 过滤器已脱敏（line 246-248），但 `POST /api/register` 响应未脱敏，会将所有邮件提供商的 `AdminPassword` 原样返回前端。攻击者可利用 XSS 或浏览器缓存历史获取。  
**修复建议**: `SaveRegisterConfig` 保存成功后返回脱敏后的 cfg 或不返回敏感字段。

---

#### H-05: 多个 POST 端点缺少请求体大小限制 (新发现)

**文件**: `server/internal/api/handler.go:92-110` (AddAccounts), `server/internal/api/handler.go:252-287` (SaveRegisterConfig), `server/internal/api/handler.go:298-306` (SaveSettings), `server/internal/api/users.go:36-48,52-68,72-88,92-100` (UpdateUser/ResetPassword/AdjustPoints/ToggleStatus), `server/internal/api/plans.go:33-77` (CreatePlan/UpdatePlan/DeletePlan)

**风险**: 所有上述端点直接使用 `io.ReadAll(r.Body)` 或 `json.NewDecoder(r.Body).Decode()` 无 `MaxBytesReader` 限制。攻击者可发送超大 payload 导致服务器 OOM。  
**修复建议**: 参照 `CreateGeneration` 的实现，在所有 POST 端点添加 `r.Body = http.MaxBytesReader(w, r.Body, maxSize)`。

---

### MEDIUM · 8 项

#### M-01: SQL 拼接反模式

**文件**: `server/internal/store/mysql.go:758-760`

```go
_, err := s.db.Exec(fmt.Sprintf(
    `UPDATE plans SET ... WHERE id=%d`, p.ID), ...)  // ← 非参数化
```

虽然 `p.ID` 当前是 `int` 类型暂无注入风险，但这是危险的反模式。如果未来改变类型或类似代码被复制，可能导致 SQL 注入。对比 `DeletePlan` 使用了正确的 `WHERE id=?` 参数化。  
**修复建议**: 统一为 `WHERE id=?` + 参数绑定。

---

#### M-02: 错误信息泄露

**文件**: `server/internal/api/generations.go:38`，以及 handler.go、users.go 中所有 500 响应

```go
writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
```

数据库错误、网络错误直接返回给客户端。可泄露表结构、内部路径等。  
**修复建议**: 生产环境返回 `"内部错误"`，详细信息只写服务端日志。

---

#### M-03: 内存速率限制器

**文件**: `server/internal/middleware/ratelimit.go:19,28-36`

虽然代理头问题已修复，限流器仍为内存存储：服务重启后计数清零，多实例不共享状态。  
**修复建议**: 迁移到 Redis（已有 `ConsumeToken` Lua 脚本实现可参考）。

---

#### M-04: 无优雅关闭

**文件**: `server/main.go:43-45`

```go
if err := http.ListenAndServe(":"+cfg.Port, router); err != nil {
    log.Fatalf("[http] 启动失败: %v", err)
}
```

无 `SIGTERM/SIGINT` 捕获。Kubernetes/Docker 停止容器时正在进行的图像生成任务被强制终止，连接泄漏。  
**修复建议**: 实现 signal handling + `http.Server.Shutdown()` with 30s timeout。

---

#### M-05: RegisterOnce 无法外部取消 (新发现)

**文件**: `server/internal/service/register_runner.go:118-165`

`RegisterOnce` 在一个无限 for 循环中运行（无 context），仅在任务数达标后返回，无任何外部取消机制。如果在监控补注册任务中调用了 `RegisterOnce`，它可能运行数十分钟而不受控。  
**修复建议**: 添加 `context.Context` 参数支持取消，或在循环中加入超时/上限保护。

---

#### M-06: 单例初始化竞态

**文件**: `server/internal/service/account_pool.go:19-26`, `server/internal/service/account_monitor.go:24-33`

```go
var pool = &AccountPool{}   // 无 sync.Once
func GetAccountPool(mysql *store.MySQLStore) *AccountPool {
    if pool.mysql == nil { pool.mysql = mysql }  // ← 竞态
    return pool
}
```

**修复建议**: 统一使用 `sync.Once`（参照 `scheduler.go` 的做法）。

---

#### M-07: 签到 streak 非连续天数验证

**文件**: `server/internal/api/checkin.go:42-47`

```go
lastStreak, _ := h.MySQL.GetLastCheckinStreak(uid)
streak := 1
if lastStreak > 0 { streak = lastStreak + 1 }
```

当前仅取上次签到 streak +1，不验证上次签到是否在昨天。用户可以隔一天签到一次仍增长 streak。  
**修复建议**: 检查 `DATE(上次签到) = CURDATE() - INTERVAL 1 DAY`，否则 streak 重置为 1。

---

#### M-08: 数据库迁移脆弱

**文件**: `server/internal/store/mysql.go:38-227`

- `autoMigrate()` 中 ALTER TABLE 在 CREATE TABLE 之前执行
- 错误检测依赖字符串匹配 `"Duplicate column"`，不同 MySQL 版本可能不匹配
- 无版本号管理，无法回滚
- 部分 ALTER TABLE 语句含义不明确

**修复建议**: 使用正式迁移工具如 `golang-migrate`，至少给每个迁移加版本号和幂等检查。

---

### LOW · 6 项

| 编号 | 问题 | 文件 | 说明 |
|------|------|------|------|
| L-01 | 代理 URL 日志明文输出 | `handler.go:262` | `log.Printf("...proxy=%s...")` 含代理地址，若含 userinfo 则泄露凭据 |
| L-02 | 硬编码代理回退地址 | `openai_backend.go:163` | `http://127.0.0.1:10808` 硬编码，无代理时默认指向本地 Clash 端口 |
| L-03 | `math/rand` 用于邮箱生成 | `mail/cloudflare_temp.go:362-375` | `randomMailboxName` 使用非加密随机数，邮箱地址可被预测 |
| L-04 | 无安全响应头 | 全局 | 缺少 `X-Content-Type-Options`, `X-Frame-Options`, `CSP` 等 |
| L-05 | bcrypt cost 默认值 | `auth.go:39` | `bcrypt.DefaultCost` = 10，2026 年建议 >= 12 |
| L-06 | 公开 Settings 接口未限制 | `api/handler.go:72` | `GET /api/settings` 无需认证，虽然已脱敏 secret_key，但泄露站点配置可能用于社会工程 |

---

### INFO · 2 项（已接受风险）

| 编号 | 问题 | 说明 |
|------|------|------|
| I-01 | localStorage Token 存储 | 纯前端 SPA 无法使用 httpOnly cookie。token 不暴露在 URL，TLS 可缓解 |
| I-02 | HTTP 明文 | 开发环境使用 HTTP。**生产必须使用 TLS 反向代理**（nginx/caddy） |

---

## 四、代码质量审查

### 错误处理覆盖不足

整个代码库大量使用 `_` 忽略错误，涵盖数据库操作、JSON 编解码、密码哈希、Redis 操作等关键路径：

```go
// auth.go:39
hash, _ := bcrypt.GenerateFromPassword(...)  // 失败则密码为空

// auth.go:75
h.Redis.SetToken(r.Context(), "user:"+token, user.ID, 24*time.Hour)  // 忽略返回值

// users.go:42
json.Unmarshal(body, &req)  // 不检查解析错误

// handler.go:132
bodyBytes, _ := io.ReadAll(r.Body)  // 可能读取失败
```

**影响**: 静默错误会导致数据不一致和难以调试的 bug。

### Goroutine 泄漏风险

`api/generations.go:140` 的图像生成 goroutine 无超时控制，网络故障时可能无限等待。`doSSEPost` 中的 SSE scanner 也无超时。

### 代码重复

- `newUUID()` 在 `image_gen.go` 和 `openai_register.go` 中各实现了一份
- `fnv1a32()` 同样重复

---

## 五、Docker 安全审查

**文件**: `docker-compose.yml`

| 发现 | 严重度 | 说明 |
|------|--------|------|
| MySQL root 密码硬编码 `root123` | MEDIUM | 凭证明文写在 compose 文件中 |
| Redis 无密码 | MEDIUM | 未配置 `requirepass` |
| MySQL 端口暴露到宿主机 `3307:3306` | LOW | 生产环境应移除 ports 映射或绑定 127.0.0.1 |
| 无资源限制 | LOW | 建议添加 `mem_limit`, `cpus` 限制 |

---

## 六、前端安全简要审查

`web/src/lib/api.ts` + `web/src/lib/auth.tsx`:

- Token 和用户数据存储在 `localStorage`（已接受风险 I-01）
- `api()` 函数无请求超时、无重试、无响应拦截器
- 前端无 CSP nonce/hash 集成
- Admin 面板无超时自动退出机制

无新的高危前端漏洞发现。

---

## 七、修复路线图

### 第一阶段（上线前必须，1-3 天）

| 优先级 | 编号 | 项目 | 预计工时 |
|--------|------|------|----------|
| P0 | C-01 | 启用 TLS 证书验证 | 30min |
| P0 | C-02 | 移除默认管理员种子数据 | 30min |
| P0 | H-01 | ListUsers 移除 password_hash | 10min |
| P0 | H-02 | JWT_SECRET 强制设置检查 | 15min |
| P0 | H-04 | SaveRegisterConfig 响应脱敏 | 10min |
| P0 | H-05 | 所有 POST 端点添加 MaxBytesReader | 1h |
| P1 | H-03 | Token 加密存储 | 4h |

### 第二阶段（1-2 周内）

| 优先级 | 编号 | 项目 | 预计工时 |
|--------|------|------|----------|
| P1 | M-01 | UpdatePlan SQL 参数化 | 10min |
| P1 | M-02 | 错误信息脱敏 | 2h |
| P1 | M-04 | 优雅关闭 | 2h |
| P1 | M-06 | 单例 sync.Once 修复 | 30min |
| P1 | M-08 | 数据库迁移规范化 | 4h |

### 第三阶段（1 月内）

| 优先级 | 编号 | 项目 | 预计工时 |
|--------|------|------|----------|
| P2 | M-03 | 速率限制迁移到 Redis | 3h |
| P2 | M-05 | RegisterOnce 可取消化 | 1h |
| P2 | M-07 | 签到连续天数验证 | 1h |
| P2 | L-01~L-06 | 低危项修复 | 4h |
| P2 | — | 全局错误处理完善 | 8h |

---

## 八、总结

二次审查确认：**上一轮报告中的 5 项修复声明中，2 项已代码落地（限流代理穿透、注册配置脱敏），另 3 项为原有设计功能**。然而，**4 项 CRITICAL/HIGH 问题依然存在**——TLS 验证禁用、默认弱密码、密码哈希泄露、Token 明文存储，这些在上一轮报告中被错误地降级或遗漏。

**当前风险评级: 中高风险** — 不建议在未修复 CRITICAL 和 HIGH 项的情况下部署到公网。

> *二次审查由全量代码静态分析完成。建议修复 P0 项后安排渗透测试验证。*
