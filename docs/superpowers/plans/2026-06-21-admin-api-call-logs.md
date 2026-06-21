# Admin API 调用日志 & 实时监控 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin 后台新增全站 API Key 调用日志页面，支持实时 SSE 推送逐条日志 + 聚合 KPI + 历史分页查询。

**Architecture:** 扩展现有 `apilog` 包（Record 加 IP、新增 Broadcaster pub/sub），中间件采集 IP 并同时投递 DB 写入通道和广播通道；Admin SSE handler 订阅广播推实时日志，同时提供分页查询和聚合统计 API；前端复用 sysmonitor 的 SSE 连接 + 流体卡片 UI 模式。

**Tech Stack:** Go 1.x（net/http, channel pub/sub）, MySQL（新列 + 索引）, Next.js 15（SSE reader, framer-motion, recharts）, Tailwind

## Global Constraints

- IP 提取信任链：`X-Real-IP` > `X-Forwarded-For` 首个 > `r.RemoteAddr`（与现有安全约定一致）
- 实时广播非阻塞（channel 满丢弃），不影响请求延迟
- 前端 UI/UX 与 sysmonitor 页面风格一致：Outfit heading + DM_Mono 数据 + framer-motion 动画 + rounded-2xl border bg-card 卡片
- DB 迁移使用 `columnExists` 守卫（与现有 autoMigrate 模式一致）
- 所有 Admin API 路由走 `adminAuth` 鉴权

---

## File Structure

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `server/internal/apilog/writer.go` | Record 加 IP 字段 |
| **新建** | `server/internal/apilog/broadcaster.go` | 实时 pub/sub 广播器 |
| **新建** | `server/internal/apilog/broadcaster_test.go` | Broadcaster 单元测试 |
| 修改 | `server/internal/middleware/apilogger.go` | 提取 IP + 投递广播 |
| 修改 | `server/internal/store/mysql.go:630-646` | autoMigrate 加 ip 列 |
| 修改 | `server/internal/store/mysql_apilog.go` | INSERT/SELECT 补 ip；新增全站查询/统计方法 |
| **新建** | `server/internal/api/api_log_admin.go` | Admin handler：分页列表/全站统计/SSE 实时推送 |
| 修改 | `server/internal/api/router.go` | 注册 3 个新路由 |
| 修改 | `server/internal/model/types.go` | APICallLog 加 IP；新增 Admin 统计类型 |
| **新建** | `web/src/app/admin/apilogs/page.tsx` | Admin API 调用日志页面 |
| 修改 | `web/src/components/admin-sidebar.tsx` | 侧栏加「API 调用日志」入口 |

---

### Task 1: Record 加 IP 字段 + Broadcaster 新建

**Files:**
- Modify: `server/internal/apilog/writer.go`
- Create: `server/internal/apilog/broadcaster.go`
- Create: `server/internal/apilog/broadcaster_test.go`

**Interfaces:**
- Produces: `apilog.Record{..., IP string}`, `apilog.DefaultBroadcaster` (全局单例), `apilog.NewBroadcaster() *Broadcaster`, `(*Broadcaster).Subscribe() <-chan Record`, `(*Broadcaster).Unsubscribe(ch <-chan Record)`, `(*Broadcaster).Broadcast(r Record)`

- [ ] **Step 1: 修改 Record 结构体加 IP 字段**

编辑 `server/internal/apilog/writer.go`，在 `Record` 中加 `IP`：

```go
// Record 一条 API 调用日志（对应 api_call_logs 一行）。
type Record struct {
	UserID     int64
	APIKeyID   int64
	Endpoint   string
	IP         string // 调用方 IP（X-Real-IP / X-Forwarded-For / RemoteAddr）
	StatusCode int
	TokensCost int
	Count      int
	LatencyMs  int
}
```

- [ ] **Step 2: 新建 Broadcaster**

创建 `server/internal/apilog/broadcaster.go`：

```go
package apilog

import "sync"

// Broadcaster 实时 API 调用广播器（pub/sub，非阻塞 send）。
// Admin SSE 通过 Subscribe 订阅，中间件通过 Broadcast 推送。
type Broadcaster struct {
	mu   sync.RWMutex
	subs map[chan Record]struct{}
}

// NewBroadcaster 创建广播器。
func NewBroadcaster() *Broadcaster {
	return &Broadcaster{subs: make(map[chan Record]struct{})}
}

// Subscribe 注册订阅者。返回的 channel 缓冲 256 条，慢消费者不阻塞 Broadcast。
func (b *Broadcaster) Subscribe() chan Record {
	ch := make(chan Record, 256)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

// Unsubscribe 取消订阅并关闭 channel。
func (b *Broadcaster) Unsubscribe(ch chan Record) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}

// Broadcast 非阻塞广播给所有订阅者。channel 满则跳过该订阅者。
func (b *Broadcaster) Broadcast(r Record) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- r:
		default:
			// 慢消费者丢弃，不阻塞请求路径
		}
	}
}

// DefaultBroadcaster 全局单例，供中间件和 handler 共享。
var DefaultBroadcaster = NewBroadcaster()
```

- [ ] **Step 3: 新建 Broadcaster 测试**

创建 `server/internal/apilog/broadcaster_test.go`：

```go
package apilog

import (
	"testing"
	"time"
)

func TestBroadcasterSubscribeAndReceive(t *testing.T) {
	b := NewBroadcaster()
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	b.Broadcast(Record{UserID: 1, Endpoint: "test"})

	select {
	case r := <-ch:
		if r.UserID != 1 || r.Endpoint != "test" {
			t.Errorf("got %+v", r)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for broadcast")
	}
}

func TestBroadcasterMultipleSubscribers(t *testing.T) {
	b := NewBroadcaster()
	ch1 := b.Subscribe()
	ch2 := b.Subscribe()
	defer b.Unsubscribe(ch1)
	defer b.Unsubscribe(ch2)

	b.Broadcast(Record{UserID: 2})

	for i, ch := range []chan Record{ch1, ch2} {
		select {
		case r := <-ch:
			if r.UserID != 2 {
				t.Errorf("subscriber %d got %+v", i, r)
			}
		case <-time.After(time.Second):
			t.Fatalf("subscriber %d timeout", i)
		}
	}
}

func TestBroadcasterUnsubscribe(t *testing.T) {
	b := NewBroadcaster()
	ch := b.Subscribe()
	b.Unsubscribe(ch)

	// Unsubscribe 后 channel 已关闭，读取应立即返回零值
	_, ok := <-ch
	if ok {
		t.Error("channel should be closed after unsubscribe")
	}
}

func TestBroadcasterNonBlockingSend(t *testing.T) {
	b := NewBroadcaster()
	// 创建小缓冲 channel 并手动塞满，验证 Broadcast 不阻塞
	ch := make(chan Record, 1)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()

	ch <- Record{} // 塞满
	// Broadcast 应不阻塞（select default 丢弃）
	done := make(chan struct{})
	go func() {
		b.Broadcast(Record{UserID: 3})
		close(done)
	}()
	select {
	case <-done:
		// 成功：非阻塞
	case <-time.After(time.Second):
		t.Fatal("Broadcast blocked when subscriber full")
	}
	// 清理
	<-ch
	b.Unsubscribe(ch)
}
```

- [ ] **Step 4: 运行 Broadcaster 测试验证**

```bash
cd server && go test ./internal/apilog/ -run TestBroadcaster -v
```

预期：4 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/internal/apilog/writer.go server/internal/apilog/broadcaster.go server/internal/apilog/broadcaster_test.go
git commit -m "feat: apilog Record 加 IP 字段 + 新增 Broadcaster pub/sub 实时广播"
```

---

### Task 2: 中间件提取 IP + 投递广播

**Files:**
- Modify: `server/internal/middleware/apilogger.go`

**Interfaces:**
- Consumes: `apilog.Record{IP string}`, `apilog.DefaultBroadcaster`
- Produces: 中间件在 `writer.Submit` 后追加 `DefaultBroadcaster.Broadcast(record)`

- [ ] **Step 1: 加 IP 提取 helper 函数**

在 `server/internal/middleware/apilogger.go` 文件顶部（`package` 声明之后，`statusWriter` 之前）加：

```go
import "net"

// clientIP 从请求提取真实客户端 IP。
// 信任链：X-Real-IP > X-Forwarded-For 第一个 > RemoteAddr。
// X-Real-IP 由前端 Nginx/Caddy 设置（已有信任基础）。
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// 取逗号分隔的第一个 IP
		for i := 0; i < len(fwd); i++ {
			if fwd[i] == ',' {
				return fwd[:i]
			}
		}
		return fwd
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
```

- [ ] **Step 2: 在 APILogger 函数中提取 IP 并投递广播**

编辑 `APILogger` 函数中 `next.ServeHTTP` 之后的代码段。找到：

```go
		writer.Submit(apilog.Record{
			UserID:     info.UserID,
			APIKeyID:   info.APIKeyID,
			Endpoint:   endpoint,
			StatusCode: status,
			TokensCost: tokens,
			Count:      info.Count,
			LatencyMs:  int(time.Since(start).Milliseconds()),
		})
```

替换为：

```go
		record := apilog.Record{
			UserID:     info.UserID,
			APIKeyID:   info.APIKeyID,
			Endpoint:   endpoint,
			IP:         clientIP(r),
			StatusCode: status,
			TokensCost: tokens,
			Count:      info.Count,
			LatencyMs:  int(time.Since(start).Milliseconds()),
		}
		writer.Submit(record)
		apilog.DefaultBroadcaster.Broadcast(record)
```

同时在 `import` 块中移除不再需要的导入调整（如果 net 不在 import 中则加上）。

新 import 块：

```go
import (
	"context"
	"net"
	"net/http"
	"time"

	"chatgpt2api-pro/internal/apilog"
)
```

- [ ] **Step 3: 构建验证**

```bash
cd server && go build ./...
```

预期：编译通过，无错误。

- [ ] **Step 4: 提交**

```bash
git add server/internal/middleware/apilogger.go
git commit -m "feat: 中间件提取真实 IP + 投递 Broadcast 实时推送"
```

---

### Task 3: Model 类型补全 + DB 加 ip 列 + 全站查询/统计方法

**Files:**
- Modify: `server/internal/model/types.go` (APICallLog 加 IP/UserEmail；新增全站统计类型)
- Modify: `server/internal/store/mysql.go` (autoMigrate 补 ip 列)
- Modify: `server/internal/store/mysql_apilog.go` (INSERT 补 ip；新增 GetAllAPICallLogs / GetAPIStatsGlobal / GetRecentAPICallLogs)

**Interfaces:**
- Consumes: `apilog.Record{IP string}`
- Produces: `model.APICallLog{IP, UserEmail}`, `model.APIStatsGlobal`, `(*MySQLStore).GetAllAPICallLogs(...)`, `(*MySQLStore).GetAPIStatsGlobal(...)`, `(*MySQLStore).GetRecentAPICallLogs(...)`

- [ ] **Step 1: 补全 model 类型**

编辑 `server/internal/model/types.go`，在 `APICallLog` 结构体中加 `IP` 和 `UserEmail`：

```go
// APICallLog 单条调用明细（GET /api/user/api-usage/logs 返回；Admin 端复用）。
type APICallLog struct {
	ID         int64  `json:"id"`
	APIKeyID   int64  `json:"api_key_id"`
	KeyName    string `json:"key_name"`
	Endpoint   string `json:"endpoint"`
	IP         string `json:"ip"`                    // 调用方 IP
	StatusCode int    `json:"status_code"`
	TokensCost int    `json:"tokens_cost"`
	Count      int    `json:"count"`
	LatencyMs  int    `json:"latency_ms"`
	CreatedAt  string `json:"created_at"`
	UserEmail  string `json:"user_email,omitempty"`  // Admin 全站查询时附带
}
```

在 `APIUsageTrendPoint` 之后（`}` 和空行之间）追加新类型：

```go
// APIStatsGlobal 全站 API 调用聚合统计（Admin 视角）。
type APIStatsGlobal struct {
	TotalCalls   int                   `json:"total_calls"`
	SuccessCalls int                   `json:"success_calls"`
	FailedCalls  int                   `json:"failed_calls"`
	RateLimited  int                   `json:"rate_limited"`
	TotalTokens  int                   `json:"total_tokens"`
	ActiveUsers  int                   `json:"active_users"`
	ActiveKeys   int                   `json:"active_keys"`
	ByEndpoint   []APIUsageDimension   `json:"by_endpoint"`
	ByStatus     []APIStatsStatusDim   `json:"by_status"`
	TopUsers     []APIStatsUserDim     `json:"top_users"`
	TrendMinutes []APIStatsTrendMinute `json:"trend_minutes"`
}

// APIStatsStatusDim 按状态码聚合。
type APIStatsStatusDim struct {
	Code  int `json:"code"`
	Count int `json:"count"`
}

// APIStatsUserDim 按用户聚合（Top 用户排行）。
type APIStatsUserDim struct {
	UserID int64  `json:"user_id"`
	Email  string `json:"email"`
	Calls  int    `json:"calls"`
	Tokens int    `json:"tokens"`
}

// APIStatsTrendMinute 按分钟趋势点。
type APIStatsTrendMinute struct {
	Minute string `json:"minute"` // HH:MM
	Calls  int    `json:"calls"`
	Errors int    `json:"errors"`
}
```

- [ ] **Step 2: autoMigrate 加 ip 列**

编辑 `server/internal/store/mysql.go`，在 `api_call_logs` 建表语句的 index 行之后、`) ENGINE=InnoDB` 之前加列。找到：

```go
		INDEX idx_user_key_created (user_id, api_key_id, created_at)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
```

替换为：

```go
		INDEX idx_user_key_created (user_id, api_key_id, created_at)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

	// 补 ip 列（旧库兼容）
	dbName := s.currentDBName()
	if !s.columnExists(dbName, "api_call_logs", "ip") {
		s.db.Exec("ALTER TABLE api_call_logs ADD COLUMN ip VARCHAR(45) NOT NULL DEFAULT '' AFTER endpoint")
	}
	if !s.columnExists(dbName, "api_call_logs", "ip") {
		// 二次确认，防并发
		s.db.Exec("ALTER TABLE api_call_logs ADD COLUMN ip VARCHAR(45) NOT NULL DEFAULT '' AFTER endpoint")
	}
```

注意：现在 `autoMigrate` 函数里需要 `dbName` 变量。检查函数开头是否已有 `dbName := s.currentDBName()`（已有其他 columnExists 调用用它），如果没有则在函数开头加一行。查看函数开头附近（行 88 附近）已经用到 `mcDB := s.currentDBName()`，所以我们用同一个模式——在 ip 列添加前获取：

实际上需要把 `dbName` 的定义放在适当位置。检查已有代码：行 120 有 `mcDB := s.currentDBName()`。我们在行 643 之前插入 ip 补列逻辑，需要一个新的 `dbName` 变量调用。可以直接复用 `s.currentDBName()` 调用：

```go
		// 补 ip 列（旧库兼容；VARCHAR(45) 兼容 IPv6）
		if !s.columnExists(s.currentDBName(), "api_call_logs", "ip") {
			s.db.Exec("ALTER TABLE api_call_logs ADD COLUMN ip VARCHAR(45) NOT NULL DEFAULT '' AFTER endpoint")
		}
```

- [ ] **Step 3: 修改 BatchInsertAPICallLogs 补 ip 列**

编辑 `server/internal/store/mysql_apilog.go`，修改 `BatchInsertAPICallLogs`：

找到：

```go
	sb.WriteString("INSERT INTO api_call_logs (user_id, api_key_id, endpoint, status_code, tokens_cost, count, latency_ms) VALUES ")
```

替换为：

```go
	sb.WriteString("INSERT INTO api_call_logs (user_id, api_key_id, endpoint, ip, status_code, tokens_cost, count, latency_ms) VALUES ")
```

找到 VALUES 占位符行：

```go
		sb.WriteString("(?,?,?,?,?,?,?)")
```

替换为：

```go
		sb.WriteString("(?,?,?,?,?,?,?,?)")
```

找到 args append 行：

```go
		args = append(args, r.UserID, r.APIKeyID, r.Endpoint, r.StatusCode, r.TokensCost, r.Count, r.LatencyMs)
```

替换为：

```go
		args = append(args, r.UserID, r.APIKeyID, r.Endpoint, r.IP, r.StatusCode, r.TokensCost, r.Count, r.LatencyMs)
```

- [ ] **Step 4: 修改 GetAPICallLogs 的 SELECT 加 ip 列**

编辑 `server/internal/store/mysql_apilog.go`，修改 `GetAPICallLogs`：

找到 SELECT 列定义（约行 147）：

```go
	q := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') " +
```

替换为：

```go
	q := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.ip, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') " +
```

找到 Scan 行（约行 158）：

```go
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt) == nil {
```

替换为：

```go
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.IP, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt) == nil {
```

- [ ] **Step 5: 新增 GetAllAPICallLogs 方法（全站，跨用户）**

在 `server/internal/store/mysql_apilog.go` 文件末尾追加：

```go
// GetAllAPICallLogs 全站分页查询 API 调用明细（Admin 视角，跨用户）。
// 支持按 user_id / email（LIKE 模糊）/ endpoint / status / key_id 筛选。
// email 非空时走子查询转 user_id 列表，避免 JOIN users 的全表扫。
func (s *MySQLStore) GetAllAPICallLogs(userID int64, email string, page, pageSize int, endpoint string, status int, keyID int64) ([]model.APICallLog, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	where := "WHERE 1=1"
	args := []any{}

	if userID > 0 {
		where += " AND l.user_id=?"
		args = append(args, userID)
	}
	if email != "" {
		where += " AND l.user_id IN (SELECT id FROM users WHERE email LIKE ?)"
		args = append(args, "%"+email+"%")
	}
	if endpoint != "" {
		where += " AND l.endpoint=?"
		args = append(args, endpoint)
	}
	if status > 0 {
		where += " AND l.status_code=?"
		args = append(args, status)
	}
	if keyID > 0 {
		where += " AND l.api_key_id=?"
		args = append(args, keyID)
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM api_call_logs l " + where
	s.db.QueryRow(countSQL, args...).Scan(&total)

	selectSQL := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.ip, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s'), COALESCE(u.email,'') " +
		"FROM api_call_logs l " +
		"LEFT JOIN user_api_keys k ON l.api_key_id=k.id " +
		"LEFT JOIN users u ON l.user_id=u.id " +
		where +
		" ORDER BY l.id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(selectSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.IP, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt, &l.UserEmail) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, total, rows.Err()
}
```

- [ ] **Step 6: 新增 GetAPIStatsGlobal 方法（全站聚合统计）**

在 `server/internal/store/mysql_apilog.go` 文件末尾继续追加：

```go
// GetAPIStatsGlobal 全站 API 调用聚合统计。minutes 为最近 N 分钟窗口（0=最近5分钟）。
func (s *MySQLStore) GetAPIStatsGlobal(minutes int) (*model.APIStatsGlobal, error) {
	if minutes <= 0 {
		minutes = 5
	}
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)

	st := &model.APIStatsGlobal{
		ByEndpoint:  []model.APIUsageDimension{},
		ByStatus:    []model.APIStatsStatusDim{},
		TopUsers:    []model.APIStatsUserDim{},
		TrendMinutes: []model.APIStatsTrendMinute{},
	}

	// 概览
	s.db.QueryRow(`SELECT
		COUNT(*),
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(tokens_cost),0),
		COUNT(DISTINCT user_id),
		COUNT(DISTINCT api_key_id)
		FROM api_call_logs WHERE created_at >= ?`, since).
		Scan(&st.TotalCalls, &st.SuccessCalls, &st.FailedCalls, &st.RateLimited, &st.TotalTokens, &st.ActiveUsers, &st.ActiveKeys)

	// 按端点
	if rows, err := s.db.Query(`SELECT endpoint, COUNT(*), COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY endpoint ORDER BY COUNT(*) DESC LIMIT 20`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageDimension
			if rows.Scan(&d.Name, &d.Calls, &d.Tokens) == nil {
				st.ByEndpoint = append(st.ByEndpoint, d)
			}
		}
	}

	// 按状态码
	if rows, err := s.db.Query(`SELECT status_code, COUNT(*)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY status_code ORDER BY COUNT(*) DESC`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsStatusDim
			if rows.Scan(&d.Code, &d.Count) == nil {
				st.ByStatus = append(st.ByStatus, d)
			}
		}
	}

	// Top 用户（按调用量）
	if rows, err := s.db.Query(`SELECT l.user_id, COALESCE(u.email,''), COUNT(*), COALESCE(SUM(l.tokens_cost),0)
		FROM api_call_logs l LEFT JOIN users u ON l.user_id=u.id
		WHERE l.created_at >= ?
		GROUP BY l.user_id, u.email ORDER BY COUNT(*) DESC LIMIT 10`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsUserDim
			if rows.Scan(&d.UserID, &d.Email, &d.Calls, &d.Tokens) == nil {
				st.TopUsers = append(st.TopUsers, d)
			}
		}
	}

	// 按分钟趋势（最近 N 分钟）
	if rows, err := s.db.Query(`SELECT DATE_FORMAT(created_at,'%H:%i') AS m, COUNT(*),
		COALESCE(SUM(CASE WHEN status_code NOT BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY m ORDER BY m`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsTrendMinute
			if rows.Scan(&d.Minute, &d.Calls, &d.Errors) == nil {
				st.TrendMinutes = append(st.TrendMinutes, d)
			}
		}
	}

	return st, nil
}
```

- [ ] **Step 7: 新增 GetRecentAPICallLogs 方法（SSE 首帧用）**

在 `server/internal/store/mysql_apilog.go` 文件末尾继续追加：

```go
// GetRecentAPICallLogs 取最近 N 条全站调用日志（SSE 首帧历史用）。
func (s *MySQLStore) GetRecentAPICallLogs(limit int) ([]model.APICallLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(
		"SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.ip, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s'), COALESCE(u.email,'') "+
			"FROM api_call_logs l "+
			"LEFT JOIN user_api_keys k ON l.api_key_id=k.id "+
			"LEFT JOIN users u ON l.user_id=u.id "+
			"ORDER BY l.id DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.IP, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt, &l.UserEmail) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, rows.Err()
}
```

- [ ] **Step 8: 构建验证**

```bash
cd server && go build ./...
```

预期：编译通过。

- [ ] **Step 9: 提交**

```bash
git add server/internal/model/types.go server/internal/store/mysql.go server/internal/store/mysql_apilog.go
git commit -m "feat: api_call_logs 加 ip 列 + model 补全 + 全站查询/统计方法"
```

---

### Task 4: Admin API Handler + 路由注册

**Files:**
- Create: `server/internal/api/api_log_admin.go`
- Modify: `server/internal/api/router.go`

**Interfaces:**
- Consumes: `model.APICallLog` (Task 3 已补 IP/UserEmail), `model.APIStatsGlobal` (Task 3), `store.MySQLStore` methods (Task 3)
- Produces: `(h *Handler) AdminListAPILogs`, `(h *Handler) AdminAPIStats`, `(h *Handler) AdminAPILogEvents`

- [ ] **Step 1: 新建 Admin API handler 文件**

创建 `server/internal/api/api_log_admin.go`：

```go
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"chatgpt2api-pro/internal/apilog"
	"chatgpt2api-pro/internal/model"
)

// GET /api/admin/api-logs — 全站 API 调用明细（分页，跨用户筛选）
func (h *Handler) AdminListAPILogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	userID, _ := strconv.ParseInt(q.Get("user_id"), 10, 64)
	keyID, _ := strconv.ParseInt(q.Get("key_id"), 10, 64)
	status, _ := strconv.Atoi(q.Get("status"))
	endpoint := q.Get("endpoint")
	email := q.Get("email")

	items, total, err := h.MySQL.GetAllAPICallLogs(userID, email, page, pageSize, endpoint, status, keyID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "查询失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": items,
		"total": total,
	}})
}

// GET /api/admin/api-stats — 全站 API 调用聚合统计
func (h *Handler) AdminAPIStats(w http.ResponseWriter, r *http.Request) {
	minutes := 5
	if m := r.URL.Query().Get("minutes"); m != "" {
		if n, err := strconv.Atoi(m); err == nil && n >= 1 && n <= 1440 {
			minutes = n
		}
	}
	stats, err := h.MySQL.GetAPIStatsGlobal(minutes)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "统计失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}

// GET /api/admin/api-logs/events — SSE 实时推送 API 调用日志
func (h *Handler) AdminAPILogEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	// 首帧：最近 50 条历史
	recent, _ := h.MySQL.GetRecentAPICallLogs(50)
	for _, l := range recent {
		data, _ := json.Marshal(l)
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", data)
	}
	flusher.Flush()

	// 首帧 stats
	if stats, err := h.MySQL.GetAPIStatsGlobal(5); err == nil {
		data, _ := json.Marshal(stats)
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", data)
	}
	flusher.Flush()

	// 订阅实时广播
	ch := apilog.DefaultBroadcaster.Subscribe()
	defer apilog.DefaultBroadcaster.Unsubscribe(ch)

	// stats 更新定时器（每 30 秒）
	statsTicker := time.NewTicker(30 * time.Second)
	defer statsTicker.Stop()

	// 构建实时日志 event：需要附带用户邮箱（查缓存或实时查）
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case record, ok := <-ch:
			if !ok {
				return
			}
			// 构造 enriched log（与 APICallLog 结构一致）
			logData, _ := json.Marshal(map[string]any{
				"user_id":     record.UserID,
				"api_key_id":  record.APIKeyID,
				"endpoint":    record.Endpoint,
				"ip":          record.IP,
				"status_code": record.StatusCode,
				"tokens_cost": record.TokensCost,
				"count":       record.Count,
				"latency_ms":  record.LatencyMs,
				"created_at":  time.Now().Format("2006-01-02 15:04:05"),
			})
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", logData)
			flusher.Flush()
		case <-statsTicker.C:
			if stats, err := h.MySQL.GetAPIStatsGlobal(5); err == nil {
				data, _ := json.Marshal(stats)
				fmt.Fprintf(w, "event: stats\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}
```

- [ ] **Step 2: 注册路由**

编辑 `server/internal/api/router.go`，在 Admin 路由区域（约行 136 之后，与 `GET /api/admin/system/events` 同一区块）追加：

```go
	// API 调用日志（Admin 全局视角）
	mux.Handle("GET /api/admin/api-logs", adminAuth(http.HandlerFunc(h.AdminListAPILogs)))
	mux.Handle("GET /api/admin/api-stats", adminAuth(http.HandlerFunc(h.AdminAPIStats)))
	mux.Handle("GET /api/admin/api-logs/events", adminAuth(http.HandlerFunc(h.AdminAPILogEvents)))
```

- [ ] **Step 3: 构建验证**

```bash
cd server && go build ./...
```

预期：编译通过。

- [ ] **Step 4: 提交**

```bash
git add server/internal/api/api_log_admin.go server/internal/api/router.go
git commit -m "feat: Admin API 调用日志 handler（列表/统计/SSE 实时推送）+ 路由注册"
```

---

### Task 5: 前端 Admin API 调用日志页面

**Files:**
- Create: `web/src/app/admin/apilogs/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/api-logs`, `GET /api/admin/api-stats`, `GET /api/admin/api-logs/events`（SSE）
- Produces: Admin 日志页面组件

- [ ] **Step 1: 创建页面文件**

创建 `web/src/app/admin/apilogs/page.tsx`：

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Activity, CheckCircle2, AlertTriangle, Zap, ScrollText,
  Search, Pause, Play, Clock, Globe, Key, Hash, Timer,
} from "lucide-react";
import { BASE, getToken } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

const CARD = "rounded-2xl border bg-card";

// 端点标签
const EP_LABEL: Record<string, string> = {
  "images.generations": "生图",
  "images.query": "生图查询",
  "vector": "矢量生成",
  "image-to-text": "图生文",
  "image-enhance": "智能增强",
  "openai.images": "OpenAI 生图",
  "openai.models": "模型探测",
  "user.tokens": "令牌查询",
  "removebg": "背景移除",
};
const epLabel = (e: string) => EP_LABEL[e] || e;

// 状态码配色
function statusTone(code: number): string {
  if (code >= 200 && code < 300) return "text-emerald-600 dark:text-emerald-400";
  if (code === 429) return "text-amber-600 dark:text-amber-400";
  if (code >= 400) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
function statusBg(code: number): string {
  if (code >= 200 && code < 300) return "bg-emerald-500/10";
  if (code === 429) return "bg-amber-500/10";
  if (code >= 400) return "bg-red-500/10";
  return "bg-muted";
}

interface LogEntry {
  id: number;
  user_id?: number;
  user_email?: string;
  api_key_id: number;
  key_name: string;
  endpoint: string;
  ip: string;
  status_code: number;
  tokens_cost: number;
  latency_ms: number;
  created_at: string;
}
interface StatsData {
  total_calls: number; success_calls: number; failed_calls: number;
  rate_limited: number; total_tokens: number; active_users: number; active_keys: number;
}
interface HistoryPage {
  items: LogEntry[];
  total: number;
}

const PAGE_SIZE = 20;

export default function AdminAPILogsPage() {
  // ── 实时状态 ──
  const [connected, setConnected] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const pausedRef = useRef(false);
  const liveContainerRef = useRef<HTMLDivElement>(null);

  // ── 历史查询 ──
  const [tab, setTab] = useState<"live" | "history">("live");
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [filterEmail, setFilterEmail] = useState("");
  const [filterEndpoint, setFilterEndpoint] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // ── SSE 连接 ──
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${BASE}/api/admin/api-logs/events`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const reader = res.body?.getReader();
          if (!reader) break;
          setConnected(true);

          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              let eventType = "";
              let data = "";
              for (const line of part.split("\n")) {
                if (line.startsWith("event: ")) eventType = line.slice(7);
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (!data) continue;
              try {
                const parsed = JSON.parse(data);
                if (eventType === "stats") {
                  setStats(parsed);
                } else if (eventType === "log" && !pausedRef.current) {
                  setLiveLogs(prev => {
                    const next = [parsed, ...prev];
                    if (next.length > 200) next.length = 200; // 保留最近 200 条
                    return next;
                  });
                }
              } catch {}
            }
          }
        } catch {}
        setConnected(false);
        await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  // paused 同步到 ref（SSE 回调里读取）
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ── 历史查询 ──
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterEmail) params.set("email", filterEmail);
      if (filterEndpoint) params.set("endpoint", filterEndpoint);
      if (filterStatus) params.set("status", filterStatus);
      const token = getToken();
      const res = await fetch(`${BASE}/api/admin/api-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      setHistory(body.data?.items || []);
      setHistoryTotal(body.data?.total || 0);
    } catch {}
    finally { setLoadingHistory(false); }
  };
  useEffect(() => { if (tab === "history") fetchHistory(); }, [tab, page, filterEmail, filterEndpoint, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  // ── 自动滚动 ──
  useEffect(() => {
    if (tab === "live" && !paused && liveContainerRef.current) {
      liveContainerRef.current.scrollTop = 0;
    }
  }, [liveLogs, tab, paused]);

  // ── 共享日志行组件 ──
  const LogRow = ({ l, showUser }: { l: LogEntry; showUser?: boolean }) => (
    <div className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors text-[11px] sm:text-xs ${mono.className}`}>
      <span className="text-muted-foreground/70 shrink-0 w-12 sm:w-16 tabular-nums">{l.created_at?.slice(11) || l.created_at}</span>
      <span className="text-muted-foreground/80 shrink-0 w-16 sm:w-20 truncate" title={l.ip}>{l.ip || "—"}</span>
      {showUser && <span className="text-foreground/80 shrink-0 w-20 sm:w-28 truncate">{l.user_email || (l.user_id ? `#${l.user_id}` : "—")}</span>}
      <span className="text-foreground/70 shrink-0 w-16 sm:w-20 truncate">{epLabel(l.endpoint)}</span>
      <span className={`shrink-0 w-8 text-right font-semibold ${statusTone(l.status_code)}`}>
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] ${statusBg(l.status_code)}`}>{l.status_code}</span>
      </span>
      <span className="text-muted-foreground/70 shrink-0 w-12 text-right tabular-nums">{l.latency_ms}ms</span>
      <span className="text-muted-foreground/70 shrink-0 w-10 text-right tabular-nums">{l.tokens_cost || "—"}</span>
      <span className="text-muted-foreground/50 shrink-0 w-16 truncate text-right">{l.key_name}</span>
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight flex items-center gap-2`}>
              API 调用日志
              <span className={`inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full ${connected ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "text-muted-foreground bg-muted"}`}>
                <span className="relative flex size-1.5">
                  {connected && <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative rounded-full size-1.5 ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                </span>
                {connected ? "实时" : "连接中"}
              </span>
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              实时监控全站 API 调用 · 已捕获 {liveLogs.length} 条实时日志
              {stats ? ` · QPS ≈ ${stats.total_calls}` : ""}
            </p>
          </div>
        </div>

        <motion.div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-3 sm:space-y-4 max-w-[1600px]">
            {/* ═══ KPI 卡片 ═══ */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {[
                { icon: Activity, label: "窗口调用", v: stats?.total_calls ?? "—", tone: "text-foreground" },
                { icon: CheckCircle2, label: "成功", v: stats?.success_calls ?? "—", tone: "text-emerald-600 dark:text-emerald-400" },
                { icon: AlertTriangle, label: "失败", v: stats?.failed_calls ?? "—", tone: "text-red-600 dark:text-red-400" },
                { icon: AlertTriangle, label: "429 限流", v: stats?.rate_limited ?? "—", tone: "text-amber-600 dark:text-amber-400" },
                { icon: Zap, label: "活跃 Key", v: stats?.active_keys ?? "—", tone: "text-violet-600 dark:text-violet-400" },
                { icon: ScrollText, label: "活跃用户", v: stats?.active_users ?? "—", tone: "text-cyan-600 dark:text-cyan-400" },
              ].map(k => (
                <motion.div key={k.label} variants={fadeUp} className={`${CARD} p-3 sm:p-4`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <k.icon className="size-3.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{k.label}</span>
                  </div>
                  <div className={`${mono.className} text-lg sm:text-xl font-semibold tabular-nums ${k.tone}`}>{k.v}</div>
                </motion.div>
              ))}
            </div>

            {/* ═══ Tab 切换 ═══ */}
            <div className="flex items-center gap-1 p-1 rounded-xl border bg-card w-fit">
              {[
                { key: "live", label: "实时流", icon: Activity },
                { key: "history", label: "历史明细", icon: Search },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key as "live" | "history")}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <t.icon className="size-3.5" />{t.label}
                </button>
              ))}
            </div>

            {/* ═══ 实时流 Tab ═══ */}
            {tab === "live" && (
              <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Activity className="size-4 text-emerald-500" /></div>
                    <span className="text-sm font-semibold">实时调用流</span>
                    <Badge variant="outline" className="tabular-nums">{liveLogs.length}</Badge>
                  </div>
                  <button onClick={() => setPaused(!paused)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${paused ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/5" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {paused ? <><Play className="size-3" />继续</> : <><Pause className="size-3" />暂停</>}
                  </button>
                </div>
                {/* 表头 */}
                <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 border-b border-border/30 bg-muted/30 text-[10px] text-muted-foreground">
                  <span className="shrink-0 w-12 sm:w-16"><Clock className="size-3 inline mr-1" />时间</span>
                  <span className="shrink-0 w-16 sm:w-20"><Globe className="size-3 inline mr-1" />IP</span>
                  <span className="shrink-0 w-20 sm:w-28">用户</span>
                  <span className="shrink-0 w-16 sm:w-20">端点</span>
                  <span className="shrink-0 w-8 text-right"><Hash className="size-3 inline" /></span>
                  <span className="shrink-0 w-12 text-right"><Timer className="size-3 inline mr-0.5" />耗时</span>
                  <span className="shrink-0 w-10 text-right">令牌</span>
                  <span className="shrink-0 w-16 text-right"><Key className="size-3 inline mr-0.5" />Key</span>
                </div>
                <div ref={liveContainerRef} className="overflow-y-auto max-h-[50vh] scrollbar-thin">
                  {liveLogs.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <Activity className="size-8 opacity-30" />
                      <p className="text-sm">等待 API 调用…</p>
                      <p className="text-xs text-muted-foreground/70">有 API Key 调用时将实时显示在这里</p>
                    </div>
                  ) : (
                    liveLogs.map((l, i) => <LogRow key={l.id || i} l={l} showUser />)
                  )}
                </div>
              </motion.div>
            )}

            {/* ═══ 历史明细 Tab ═══ */}
            {tab === "history" && (
              <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center"><Search className="size-4 text-muted-foreground" /></div>
                    <span className="text-sm font-semibold">历史明细</span>
                    <Badge variant="outline" className="tabular-nums">{historyTotal}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input placeholder="用户邮箱搜索…" value={filterEmail} onChange={e => { setFilterEmail(e.target.value); setPage(1); }}
                      className="h-8 rounded-xl text-xs w-36 sm:w-44" />
                    <Select value={filterEndpoint} onValueChange={v => { setFilterEndpoint(v as string); setPage(1); }}>
                      <SelectTrigger className="h-8 rounded-xl text-xs w-24"><SelectValue placeholder="端点" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        {Object.keys(EP_LABEL).map(e => <SelectItem key={e} value={e}>{epLabel(e)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={v => { setFilterStatus(v as string); setPage(1); }}>
                      <SelectTrigger className="h-8 rounded-xl text-xs w-20"><SelectValue placeholder="状态" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                        <SelectItem value="429">429</SelectItem>
                        <SelectItem value="400">400</SelectItem>
                        <SelectItem value="401">401</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {loadingHistory ? (
                  <div className="py-20 flex items-center justify-center text-muted-foreground">
                    <div className="size-5 border-2 border-muted border-t-primary rounded-full animate-spin mr-2" /> 加载中…
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Clock className="size-8 opacity-30" />
                    <p className="text-sm">暂无记录</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      {history.map(l => <LogRow key={l.id} l={l} showUser />)}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t">
                        <span className="text-[11px] text-muted-foreground">第 {page} / {totalPages} 页</span>
                        <div className="flex items-center gap-1.5">
                          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                            className="px-3 py-1.5 rounded-lg text-xs border text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground transition-colors">上一页</button>
                          <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            className="px-3 py-1.5 rounded-lg text-xs border text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground transition-colors">下一页</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

```bash
cd web && npx next build 2>&1 | tail -20
```

预期：构建成功，无错误。

- [ ] **Step 3: 提交**

```bash
git add web/src/app/admin/apilogs/page.tsx
git commit -m "feat: Admin API 调用日志页面（实时流 + 历史明细 + KPI 卡片）"
```

---

### Task 6: 侧栏导航入口

**Files:**
- Modify: `web/src/components/admin-sidebar.tsx`

**Interfaces:**
- Produces: 侧栏「概览」分组下新增 `/admin/apilogs` 导航项

- [ ] **Step 1: 加图标导入**

编辑 `web/src/components/admin-sidebar.tsx`，在 lucide-react 导入行（约行 10-12）的 icon 列表中加入 `ScrollText`：

找到：
```tsx
  ShoppingCart, Tag, Database, Sun, Moon, Palette, Mail,
  Menu, X, Megaphone, ShieldCheck, Wallet, Activity, Shapes,
```

替换为：
```tsx
  ShoppingCart, Tag, Database, Sun, Moon, Palette, Mail,
  Menu, X, Megaphone, ShieldCheck, Wallet, Activity, Shapes, ScrollText,
```

- [ ] **Step 2: 加导航项**

编辑 `navGroups` 数组中的「概览」分组（约行 21-26），在「系统监控」之后追加：

```tsx
      { href: "/admin/apilogs", icon: ScrollText, label: "API 调用日志" },
```

完整效果：
```tsx
  {
    label: "概览",
    items: [
      { href: "/admin/stats", icon: BarChart3, label: "数据统计" },
      { href: "/admin/sysmonitor", icon: Activity, label: "系统监控" },
      { href: "/admin/apilogs", icon: ScrollText, label: "API 调用日志" },
    ],
  },
```

- [ ] **Step 3: 构建验证**

```bash
cd web && npx next build 2>&1 | tail -20
```

预期：构建成功。

- [ ] **Step 4: 提交**

```bash
git add web/src/components/admin-sidebar.tsx
git commit -m "feat: Admin 侧栏加 API 调用日志入口"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 后端编译 + 测试**

```bash
cd server && go build ./... && go vet ./... && go test ./internal/apilog/... -v
```

预期：全部 PASS。

- [ ] **Step 2: 前端构建**

```bash
cd web && npx next build 2>&1 | tail -20
```

预期：构建成功。

- [ ] **Step 3: 整体提交（如有遗漏文件）**

```bash
git status
git add -A
git commit -m "chore: 端到端验证通过，补遗漏文件"
```
