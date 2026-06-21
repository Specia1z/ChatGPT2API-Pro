# Admin API 调用日志 & 实时监控 设计文档

**日期**: 2026-06-21  
**状态**: 待实现

---

## 1. 目标

Admin 后台新增 API Key 调用日志全局查看与实时监控能力：
- 记录每次 API Key 调用的详细信息（时间、端点、IP、token 消耗、延迟、状态码等）
- Admin 后台页面支持实时逐条日志推送（`tail -f` 风格）+ 聚合 KPI 仪表盘
- 支持按用户/端点/状态/Key 筛选历史明细

---

## 2. 现有基础

| 组件 | 状态 | 说明 |
|---|---|---|
| `api_call_logs` 表 | ✅ 已有 | user_id, api_key_id, endpoint, status_code, tokens_cost, count, latency_ms, created_at |
| `apilog.Writer` | ✅ 已有 | 异步批量写入器，channel + 定时/定量 flush |
| `middleware.APILogger` | ✅ 已有 | 最外层采集中间件，捕获 APICallInfo + 耗时 |
| `store.BatchInsertAPICallLogs` | ✅ 已有 | 批量 INSERT |
| `store.GetAPIUsageSummary` | ✅ 已有 | 用户级聚合（按端点/Key/日趋势） |
| `store.GetAPICallLogs` | ✅ 已有 | 用户级分页明细 |
| Admin SSE 模式 | ✅ 已有 | `/api/admin/system/events` 每 2 秒推快照 |

**缺失**: Admin 全局视角（跨用户查询 + 实时推送）。

---

## 3. 设计

### 3.1 架构数据流

```
HTTP Request → SecurityHeaders → MetricsCount → CORS → Router
                                                         │
  ┌──────────────────────────────────────────────────────┘
  │  API Key 认证路由（/api/v1/*, /v1/*）
  │  APILogger(ep)( RateLimit( apiKeyAuth( apiUserRL( handler ))))
  │       │
  │       ├─ 采集 APICallInfo + IP + 耗时 → apilog.Record
  │       ├─ writer.Submit(record)          → channel → 批量写 DB
  │       └─ broadcaster.Broadcast(record)  → channel → Admin SSE 订阅者
  │
  └── Admin SSE: GET /api/admin/api-logs/events
      ├─ 首帧推最近 50 条历史（从 DB）
      └─ 之后每收到一条 broadcast → 推送给客户端
```

### 3.2 加 IP 字段

| 层 | 文件 | 改动 |
|---|---|---|
| 结构体 | `apilog/writer.go` | `Record` 加 `IP string` |
| 中间件 | `middleware/apilogger.go` | 从 `r.RemoteAddr` 提取 IP（带 X-Real-IP / X-Forwarded-For 信任链） |
| DB 迁移 | `migrations/xxx_add_ip_to_api_call_logs.sql` | `ALTER TABLE api_call_logs ADD COLUMN ip VARCHAR(45) NOT NULL DEFAULT '' AFTER endpoint` |
| 存储 | `store/mysql_apilog.go` | INSERT 补 ip；SELECT 查询补 ip 列 |
| 模型 | `model/types.go` | `APICallLog` 加 `IP string` |

IP 提取逻辑：优先 `X-Real-IP`（由前端 nginx/Caddy 设置，已有信任机制），其次 `X-Forwarded-For` 第一个，最后回退 `r.RemoteAddr`。

### 3.3 实时广播（新组件）

**新文件**: `server/internal/apilog/broadcaster.go`

```
Broadcaster
├── Subscribe()   → <-chan Record   // 注册订阅者
├── Unsubscribe()                   // 取消订阅
└── Broadcast(r Record)             // 非阻塞广播（channel 满丢弃）
```

- 内部维护 `map[chan Record]struct{}` + 读写锁
- `Broadcast` 遍历所有订阅 channel，非阻塞 send（select default 丢弃）
- 全局单例 `var DefaultBroadcaster = NewBroadcaster()`

**中间件改动**: `apilogger.go` 中在 `writer.Submit(record)` 之后追加 `broadcaster.Broadcast(record)`。

### 3.4 Admin API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/api-logs` | 分页查全站日志。参数: page, page_size, user_id, email, endpoint, status, key_id |
| GET | `/api/admin/api-stats` | 全站聚合统计。参数: days(默认1=今天), minutes(实时模式最近N分钟) |
| GET | `/api/admin/api-logs/events` | SSE 实时推送逐条调用 |

**全站 stats 响应结构**:
```json
{
  "total_calls": 12345,
  "success_calls": 12000,
  "failed_calls": 300,
  "rate_limited": 45,
  "total_tokens": 500000,
  "active_users": 89,
  "active_keys": 120,
  "current_qps": 12,
  "by_endpoint": [{ "name": "images.generations", "calls": 8000, "tokens": 400000 }],
  "by_status": [{ "code": 200, "count": 11000 }, { "code": 429, "count": 45 }],
  "top_users": [{ "user_id": 1, "email": "a@b.com", "calls": 500, "tokens": 25000 }],
  "trend_minutes": [{ "minute": "15:04", "calls": 120, "errors": 3 }]
}
```

**SSE 事件格式**（与现有 sysmonitor SSE 风格一致）:
```
event: snapshot
data: {"time":"15:04:05","qps":12,...}   // 每 5 秒推一次聚合快照

event: log
data: {"id":123,"user_email":"a@b.com","endpoint":"images.generations","ip":"1.2.3.4","status_code":200,"tokens_cost":5,"latency_ms":320,"created_at":"2026-06-21 15:04:05"}

event: stats
data: {和 /api/admin/api-stats 结构相同}   // 每 30 秒推一次全量统计更新
```

**全站日志查询 SQL 新增方法**:
- `GetAllAPICallLogs(page, pageSize, userID, email, endpoint, status, keyID)` → 跨用户分页查询，LEFT JOIN users 取 email
- `GetAPIStatsGlobal(days, minutes)` → 全站聚合（不限定 user_id）

### 3.5 前端页面

**新文件**: `web/src/app/admin/apilogs/page.tsx`

**布局**（参考 `sysmonitor/page.tsx` 风格）：

```
┌─ Header（标题「API 调用日志」+ 实时/连接中状态指示器）──────┐
├─ KPI 卡片行（实时 QPS / 成功率 / 429 次数 / 活跃 Key 数）  │
├─ 筛选栏（用户搜索 + 端点 + 状态 + Key 下拉）                │
├─ Tab: 「实时流」│「历史明细」                              │
│  ┌─ 实时流 Tab ──────────────────────────────────────────┐ │
│  │ 自动滚动日志行：时间 | IP | 用户 | 端点 | 状态 | 耗时 | 令牌 │
│  │ 新日志从顶部插入，绿色=2xx 黄色=429 红色=4xx/5xx       │ │
│  │ 可暂停/继续自动滚动                                    │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌─ 历史明细 Tab ───────────────────────────────────────┐ │
│  │ 分页表格 + 筛选器（复用现有 admin 表格风格）           │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**UI/UX 一致性**：
- 复用 `AdminSidebar` 布局 + 流体背景
- 字体：Outfit(heading) + DM_Mono(等宽数据)
- 卡片：`rounded-2xl border bg-card` 风格
- 动画：framer-motion stagger + fadeUp
- 状态指示：绿色脉冲点 = 实时连接中
- 移动端：底部 Tab 栏适配

### 3.6 侧栏导航

在 `admin-sidebar.tsx` 的「概览」分组下新增：
```tsx
{ href: "/admin/apilogs", icon: ScrollText, label: "API 调用日志" },
```

---

## 4. 实现步骤

1. **后端 - 加 IP 字段**: 改 Record 结构体 + 中间件 + 迁移 + mysql_apilog 读写
2. **后端 - 实时广播**: 新建 broadcaster.go + 中间件投递
3. **后端 - Admin API handlers**: 新建 api_log_admin.go（日志列表/统计/SSE）
4. **后端 - 注册路由**: router.go 加 3 个新路由
5. **前端 - 页面**: 新建 admin/apilogs/page.tsx
6. **前端 - 导航**: admin-sidebar.tsx 加入口
7. **验证**: go build + frontend build + 功能验证

---

## 5. 自审清单

- [x] 无 TBD/TODO 占位 — 所有设计点已明确
- [x] 内部一致 — 后端 API 结构与前端页面设计匹配
- [x] 范围聚焦 — 仅 API 日志模块，不涉及其他系统
- [x] 无歧义 — IP 提取链/SQL 查询/SSE 事件格式均已明确
- [x] IP 提取信任 X-Real-IP（已有信任基础，与现有安全约定一致）
- [x] 实时广播非阻塞（满丢弃），不影响请求延迟
