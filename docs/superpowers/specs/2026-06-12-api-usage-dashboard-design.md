# API 用量 & 计费仪表盘 — 设计文档

- 日期：2026-06-12
- 状态：已确认，待实现计划
- 范围：面向 API 开发者的独立用量仪表盘（仅用户自视）

## 背景与定位

本项目为令牌桶制：用户买套餐得令牌额度，API 调用消耗令牌，按速率恢复，**无额外按量付费**。用户中心已有「用量统计」Tab（`/api/user/stats`），展示整体出图概览/成功率/趋势/令牌桶，基于 `generations` 表聚合。

本功能是**面向 API 开发者的独立仪表盘**，与既有「用量统计」分工：后者是整体出图概览，本面板聚焦 **API Key 调用视角**——按 Key 拆分用量、各端点调用分布、额度消耗与限流(429)、逐次调用明细。

「计费」在本项目语义下 = **令牌消耗量**，不折算成金额（项目无真实按量付费，造金额体系属 YAGNI）。

## 关键约束（已核对代码）

1. `generations` 表只有 `user_id`，**未记录发起的 API Key**。按 Key 分组需新增埋点。
2. 限流 429 发生在 handler 之前的中间件，handler 内无从感知。
3. 图生文(`image_to_text.go`)/一键增强**不落 `generations`**；矢量走 `generations(gen_type=svg)`。统计全部端点需独立采集。

结论：采用**专用调用日志表 + 最外层中间件采集**，是唯一能凑齐「调用明细/429/各端点/按 Key/耗时」全部指标的方案。

## 架构总览

```
API 请求 → [apiLogger 中间件(最外层)] → [限流] → [apiKeyAuth] → handler
                  │                                                  │
                  │ 抓 status/latency/endpoint/key_id                │ 把 tokens_cost
                  │                                                  │ 写入 ctx holder
                  ▼                                                  ▼
          非阻塞投递 channel ──→ [异步批量 writer] ──→ api_call_logs 表
                                                              │
                                          [定时清理] 删 N 天前 ←┘
```

## 组件设计

### 1. 数据模型 — `api_call_logs`

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK AUTO_INCREMENT | |
| user_id | BIGINT NOT NULL | 索引 |
| api_key_id | BIGINT NOT NULL DEFAULT 0 | 哪个 Key 发起；0=未解析 |
| endpoint | VARCHAR(48) NOT NULL | 端点枚举（见下） |
| status_code | INT NOT NULL DEFAULT 0 | HTTP 状态码 |
| tokens_cost | INT NOT NULL DEFAULT 0 | 本次消耗令牌；429/4xx=0 |
| count | INT NOT NULL DEFAULT 0 | 请求图片数（生图类） |
| latency_ms | INT NOT NULL DEFAULT 0 | 处理耗时（毫秒） |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | 索引 |

- 索引：`(user_id, created_at)`、`(user_id, api_key_id)`
- 建表走 `autoMigrate` 的 `CREATE TABLE IF NOT EXISTS` 模式
- `endpoint` 枚举：`images.generations` / `images.query` / `vector` / `image-to-text` / `image-enhance` / `openai.images` / `openai.models` / `user.tokens`

### 2. api_key_id 解析

扩展 `middleware.ApiKeyAuth`：`GetUserByAPIKey` 已 JOIN `user_api_keys`，顺带返回 key id（改签名或新增轻量查询），塞入 context `APIKeyIDKey`。不引入额外往返查询。

### 3. 采集中间件 `apiLogger`

包在所有 `apiKeyAuth` 路由的**最外层**：
- 记录 start time；包装 `http.ResponseWriter` 捕获最终 status_code
- handler 返回后计算 `latency_ms`，从 context 读 `api_key_id`、`tokens_cost`
- 因是最外层，限流提前拒绝的 **429 也能被记录**（tokens_cost=0）
- `tokens_cost`：handler 把实际消耗写入 request 作用域 holder（context 中放 `*int` 指针），中间件事后读取。保持单一落库路径。

### 4. 异步批量 writer

- 带缓冲 channel（容量如 1024）+ 后台 goroutine
- 中间件**非阻塞**投递（`select { case ch <- rec: default: drop }`），channel 满即丢弃，**绝不阻塞请求**
- writer 每 2 秒 或 累积 200 条 触发一次多行 INSERT
- 进程退出时 flush 剩余缓冲
- 符合项目高并发性能约束：请求路径零额外 DB 写、零额外延迟

### 5. 保留期清理

- 复用 storage cleaner 定时器思路，定期 `DELETE FROM api_call_logs WHERE created_at < NOW() - INTERVAL ? DAY`
- 新增后台可配项 `api_log_retention_days`（默认 30），走 `add-configurable-setting` 套路
- 0 的语义：用内置默认 30（与项目既有"0=默认"约定一致）

### 6. 后端接口（userAuth，仅用户自视）

- `GET /api/user/api-usage/summary?days=N`
  返回：总调用数、成功/失败数、总令牌消耗、按端点分布、按 Key 分布、每日趋势（成功 vs 失败）、429 次数
- `GET /api/user/api-usage/logs?page=&page_size=&key_id=&endpoint=&status=`
  分页调用明细，支持按 Key/端点/状态筛选

### 7. 前端页面 `/user/api-usage`

- **概览卡**：本期总调用 / 成功率 / 消耗令牌 / 429 次数
- **图表**（复用 recharts）：每日调用趋势（成功 vs 失败堆叠）、端点分布、按 Key 用量
- **额度面板**：当前令牌桶（容量/剩余/恢复速率），复用 `/api/user/tokens`
- **调用明细表**：时间 / 端点 / Key 名 / 状态码 / 令牌 / 耗时，分页 + 筛选
- 复用现有 CARD 玻璃拟态样式 + Navbar；从用户中心「API 密钥」Tab 放一个入口链接

## 错误处理

- 日志投递失败（channel 满）：静默丢弃，不影响主请求；不重试（用量统计容忍少量丢失）
- writer 批量 INSERT 失败：记日志、丢弃该批，不阻塞后续；不影响业务
- 接口查询失败：返回 500 + 错误信息，前端提示

## 测试策略

- **纯逻辑单测**：异步 writer（批量触发/满则丢/退出 flush）、endpoint 枚举映射
- **聚合查询**：喂种子数据验证 summary/logs 各维度正确
- **保留清理**：插入跨期数据，验证只删过期
- CRUD/聚合走真实本机 MySQL，连不上则 `t.Skip`（沿用 `admin_login_test.go` 模式）
- 改动后 `go build` / `go vet` / 前端 `tsc` 验证

## 已定小决策

- 记录范围：所有 `apiKeyAuth` 经过的调用全记（含 GET 查询/meta），endpoint 标签区分，给开发者完整视角
- 保留期：默认 30 天，后台可配
- 计费语义：令牌消耗量，不折算金额
- 管理端全局视角：本期不做（仅用户自视），列为潜在二期

## 非目标（本期不做）

- 管理端跨用户的全局 API 看板
- 真实金额计费 / 账单导出
- 按量付费、超额扣费
