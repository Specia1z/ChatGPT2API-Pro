# API 用量 & 计费仪表盘 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 API 开发者提供独立用量仪表盘——按 Key/端点拆分调用量、令牌消耗、429 限流、逐次调用明细，数据由最外层采集中间件异步写入专用日志表。

**Architecture:** 在所有 `apiKeyAuth` 路由的**最外层**包一个 `apiLogger` 中间件，创建一个可变 holder 结构塞进 context；内层的 `apiKeyAuth` 写入 `user_id/api_key_id`，handler 写入 `tokens_cost/count`，中间件在 handler 返回后读 holder + status + latency，**非阻塞**投递到带缓冲 channel，由后台 goroutine 批量 INSERT 到 `api_call_logs`。保留期清理复用 StorageCleaner 的定时器思路。

**Tech Stack:** Go 1.2x（标准库 net/http + database/sql）、MySQL、Next.js 15 + React + recharts + framer-motion + Tailwind。

---

## 关键设计约束（实现者必读）

**context 父子隔离是本设计的核心陷阱。** `context.WithValue` 在 `apiKeyAuth` 内创建的是**子 context**，通过 `next.ServeHTTP(w, r.WithContext(ctx))` 传给内层。最外层的 `apiLogger` 持有的是**父 context**，handler 返回后 `apiLogger` 读 `r.Context()` **看不到**内层新增的值。

因此 `tokens_cost / api_key_id` **不能**用普通 context value 往上传。解法：**holder 指针模式**——`apiLogger`（最外层）创建一个 `*APICallInfo` 结构塞进 context，子 context 继承同一个指针，内层中间件/handler 通过指针**原地修改**字段，`apiLogger` 事后读同一指针。这是唯一能让最外层读到内层写入数据的方式。

**中间件包裹顺序（务必照此）：**
```
apiLogged(endpoint, RateLimit( apiKeyAuth( apiUserRL( handler ))))
```
- `apiLogged` 最外 → 能记录 RateLimit 提前拒绝的 IP-429（此时 api_key_id=0）
- `apiKeyAuth` 在 RateLimit 之内 → 它写 holder 的 key id；UserRateLimit(apiUserRL) 触发的 429 在 auth 之后，holder 已有 key id，能归属到 Key

**令牌退款语义：** `generations.go:350` 部分失败退令牌、上游失败异步 goroutine 退令牌（在 HTTP 响应之后）。holder 记的是**下单时的毛额**，非退款后净额。这是「按下单计费」语义，前端文案需说明，不与实时令牌桶精确对账。

---

## File Structure

**新建：**
- `server/internal/apilog/writer.go` — 异步批量 writer（Record 结构 + channel + goroutine + flush）
- `server/internal/apilog/writer_test.go` — writer 纯逻辑单测
- `server/internal/store/mysql_apilog.go` — api_call_logs 的 CRUD + 聚合查询
- `server/internal/store/mysql_apilog_test.go` — 聚合/清理 MySQL 测试（连不上 t.Skip）
- `server/internal/api/api_usage.go` — summary/logs 两个 HTTP handler
- `web/src/app/user/api-usage/page.tsx` — 前端仪表盘页

**修改：**
- `server/internal/store/mysql.go:88` autoMigrate — 建表 + 保留期列
- `server/internal/model/types.go:284` Settings struct — 加 `APILogRetentionDays`
- `server/internal/store/mysql_settings.go:106,130` getSettingsRaw/SaveSettings — 读写新列
- `server/internal/store/mysql_users.go:384` GetUserByAPIKey — SELECT 加 `k.id`
- `server/internal/model/types.go` User struct — 加 `APIKeyID int64`
- `server/internal/middleware/middleware.go` — holder 结构 + 辅助函数 + apiKeyAuth 写 holder
- `server/internal/middleware/apilogger.go`（新建于 middleware 包）— apiLogger 中间件 + statusWriter
- `server/internal/api/generations.go`, `openai_compat.go`, `image_api_v1.go`, `image_to_text.go`, `image_enhance*.go` — handler 写 holder
- `server/internal/api/router.go` — apiLogged 包裹 + writer 注入
- `server/main.go` — writer 生命周期 + 保留清理启动
- `web/src/app/admin/settings/page.tsx` — 保留期配置项

## Task 1: 数据表 + 保留期配置项

**Files:**
- Modify: `server/internal/store/mysql.go`（autoMigrate，约 :88-90 区域内追加建表）
- Modify: `server/internal/model/types.go:284`（Settings struct 末尾加字段）
- Modify: `server/internal/store/mysql_settings.go:106`（getSettingsRaw SELECT/Scan）
- Modify: `server/internal/store/mysql_settings.go:130`（SaveSettings UPDATE）

- [ ] **Step 1: 在 autoMigrate 末尾建表**

在 `server/internal/store/mysql.go` 的 `autoMigrate()` 函数体内（找到最后一个 `s.db.Exec(...)` 建表语句之后、函数闭合 `}` 之前）追加：

```go
	s.db.Exec(`CREATE TABLE IF NOT EXISTS api_call_logs (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		user_id BIGINT NOT NULL,
		api_key_id BIGINT NOT NULL DEFAULT 0,
		endpoint VARCHAR(48) NOT NULL DEFAULT '',
		status_code INT NOT NULL DEFAULT 0,
		tokens_cost INT NOT NULL DEFAULT 0,
		count INT NOT NULL DEFAULT 0,
		latency_ms INT NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_user_created (user_id, created_at),
		INDEX idx_user_key_created (user_id, api_key_id, created_at)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
```

- [ ] **Step 2: Settings struct 加字段**

`server/internal/model/types.go`，在 `APIImageTTLMin` 字段下方（struct 闭合 `}` 之前，约 :284）加：

```go
	APILogRetentionDays int `json:"api_log_retention_days"` // API 调用日志保留天数（0=用内置默认 30）
```

- [ ] **Step 3: getSettingsRaw 读新列**

`server/internal/store/mysql_settings.go` 的 `getSettingsRaw()`：SELECT 字符串末尾（`COALESCE(api_image_ttl_min,30)` 之后）追加 `, COALESCE(api_log_retention_days,0)`；Scan 参数末尾（`&cfg.APIImageTTLMin` 之后）追加 `, &cfg.APILogRetentionDays`。

- [ ] **Step 4: SaveSettings 写新列**

同文件 `SaveSettings()`：UPDATE 语句 SET 列表末尾（`api_image_ttl_min=?` 之后）追加 `, api_log_retention_days=?`；Exec 参数末尾（`cfg.APIImageTTLMin` 之后）追加 `, cfg.APILogRetentionDays`。

- [ ] **Step 5: 编译验证**

Run: `cd server && go build ./...`
Expected: 编译通过，无错误。

- [ ] **Step 6: 提交**

```bash
git add server/internal/store/mysql.go server/internal/model/types.go server/internal/store/mysql_settings.go
git commit -m "feat(apilog): api_call_logs 表 + 保留期可配项"
```

---

## Task 2: 异步批量 writer（纯逻辑，TDD）

writer 不直接依赖 MySQLStore，而是接受一个 `flush func([]Record) error` 回调，这样单测可以注入假回调验证批量/丢弃/flush 逻辑，不需要数据库。

**Files:**
- Create: `server/internal/apilog/writer.go`
- Test: `server/internal/apilog/writer_test.go`

- [ ] **Step 1: 写失败测试**

创建 `server/internal/apilog/writer_test.go`：

```go
package apilog

import (
	"sync"
	"testing"
	"time"
)

// 收集 flush 收到的所有记录（线程安全）
type sink struct {
	mu   sync.Mutex
	recs []Record
}

func (s *sink) flush(batch []Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recs = append(s.recs, batch...)
	return nil
}

func (s *sink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.recs)
}

func TestWriterFlushesOnInterval(t *testing.T) {
	s := &sink{}
	w := NewWriter(Config{BufSize: 100, BatchSize: 1000, Interval: 50 * time.Millisecond}, s.flush)
	w.Start()
	defer w.Stop()

	for i := 0; i < 5; i++ {
		w.Submit(Record{UserID: 1, Endpoint: "images.generations", StatusCode: 200})
	}
	// 未达 BatchSize，应由 interval 触发
	time.Sleep(150 * time.Millisecond)
	if got := s.count(); got != 5 {
		t.Fatalf("expected 5 flushed by interval, got %d", got)
	}
}

func TestWriterFlushesOnBatchSize(t *testing.T) {
	s := &sink{}
	// Interval 设很长，确保是 BatchSize 触发而非 interval
	w := NewWriter(Config{BufSize: 1000, BatchSize: 10, Interval: 10 * time.Second}, s.flush)
	w.Start()
	defer w.Stop()

	for i := 0; i < 10; i++ {
		w.Submit(Record{UserID: 1})
	}
	// 给 goroutine 一点时间消费
	deadline := time.Now().Add(2 * time.Second)
	for s.count() < 10 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := s.count(); got != 10 {
		t.Fatalf("expected 10 flushed by batch size, got %d", got)
	}
}

func TestWriterDropsWhenFull_NeverBlocks(t *testing.T) {
	// flush 阻塞，channel 必满；Submit 必须立即返回（非阻塞），不得死锁
	block := make(chan struct{})
	blockingFlush := func(batch []Record) error {
		<-block // 永久阻塞直到测试放行
		return nil
	}
	w := NewWriter(Config{BufSize: 2, BatchSize: 1, Interval: time.Hour}, blockingFlush)
	w.Start()

	done := make(chan struct{})
	go func() {
		for i := 0; i < 10000; i++ {
			w.Submit(Record{UserID: 1}) // 必须不阻塞
		}
		close(done)
	}()
	select {
	case <-done:
		// 成功：大量投递在 channel 满时被丢弃而非阻塞
	case <-time.After(2 * time.Second):
		t.Fatal("Submit blocked when buffer full — must drop, not block")
	}
	close(block)
	w.Stop()
}

func TestWriterFlushesRemainingOnStop(t *testing.T) {
	s := &sink{}
	w := NewWriter(Config{BufSize: 100, BatchSize: 1000, Interval: time.Hour}, s.flush)
	w.Start()
	for i := 0; i < 7; i++ {
		w.Submit(Record{UserID: 1})
	}
	w.Stop() // Stop 应 flush 剩余缓冲
	if got := s.count(); got != 7 {
		t.Fatalf("expected 7 flushed on stop, got %d", got)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/apilog/ -run TestWriter -v`
Expected: 编译失败（`NewWriter`/`Record`/`Config` 未定义）。

- [ ] **Step 3: 实现 writer**

创建 `server/internal/apilog/writer.go`：

```go
// Package apilog 提供 API 调用日志的异步批量落库。
// 设计目标：请求路径零阻塞、零额外延迟——中间件非阻塞投递，channel 满即丢弃；
// 后台 goroutine 按 时间/条数 双触发批量 INSERT，进程退出时 flush 剩余。
package apilog

import (
	"log"
	"time"
)

// Record 一条 API 调用日志（对应 api_call_logs 一行）。
type Record struct {
	UserID     int64
	APIKeyID   int64
	Endpoint   string
	StatusCode int
	TokensCost int
	Count      int
	LatencyMs  int
}

// Config writer 调参。零值字段由 NewWriter 用默认值填充。
type Config struct {
	BufSize   int           // channel 容量（默认 1024）
	BatchSize int           // 累积多少条触发一次 flush（默认 200）
	Interval  time.Duration // 多久强制 flush 一次（默认 2s）
}

// FlushFunc 批量落库回调。writer 不直接依赖存储层，便于测试与解耦。
type FlushFunc func(batch []Record) error

type Writer struct {
	ch     chan Record
	flush  FlushFunc
	cfg    Config
	stopCh chan struct{}
	doneCh chan struct{}
}

func NewWriter(cfg Config, flush FlushFunc) *Writer {
	if cfg.BufSize <= 0 {
		cfg.BufSize = 1024
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 200
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 2 * time.Second
	}
	return &Writer{
		ch:     make(chan Record, cfg.BufSize),
		flush:  flush,
		cfg:    cfg,
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

// Submit 非阻塞投递。channel 满则丢弃（用量统计容忍少量丢失，绝不阻塞请求）。
func (w *Writer) Submit(r Record) {
	select {
	case w.ch <- r:
	default:
		// 满即丢弃
	}
}

func (w *Writer) Start() {
	go w.loop()
}

// Stop 停止后台 goroutine 并 flush 剩余缓冲（幂等性由调用方保证，仅调一次）。
func (w *Writer) Stop() {
	close(w.stopCh)
	<-w.doneCh
}

func (w *Writer) loop() {
	defer close(w.doneCh)
	ticker := time.NewTicker(w.cfg.Interval)
	defer ticker.Stop()

	buf := make([]Record, 0, w.cfg.BatchSize)
	flushBuf := func() {
		if len(buf) == 0 {
			return
		}
		if err := w.flush(buf); err != nil {
			log.Printf("[apilog] flush %d records fail: %v", len(buf), err)
		}
		buf = buf[:0]
	}

	for {
		select {
		case r := <-w.ch:
			buf = append(buf, r)
			if len(buf) >= w.cfg.BatchSize {
				flushBuf()
			}
		case <-ticker.C:
			flushBuf()
		case <-w.stopCh:
			// 排空 channel 后 flush，保证退出不丢已投递数据
			for {
				select {
				case r := <-w.ch:
					buf = append(buf, r)
				default:
					flushBuf()
					return
				}
			}
		}
	}
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && go test ./internal/apilog/ -run TestWriter -v`
Expected: 4 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/internal/apilog/
git commit -m "feat(apilog): 异步批量 writer（非阻塞投递+双触发flush+退出flush）"
```

## Task 3: 存储层 — 批量写入 + 聚合查询 + 保留清理

聚合查询的返回类型先在本任务定义；handler（Task 6）直接复用。

**Files:**
- Create: `server/internal/store/mysql_apilog.go`
- Modify: `server/internal/model/types.go`（追加 DTO 结构）

- [ ] **Step 1: 加 DTO 结构**

`server/internal/model/types.go` 文件末尾追加：

```go
// --- API 用量仪表盘 DTO ---

// APIUsageSummary API 调用用量概览（GET /api/user/api-usage/summary 返回）。
type APIUsageSummary struct {
	TotalCalls  int                  `json:"total_calls"`
	SuccessCalls int                 `json:"success_calls"`
	FailedCalls int                  `json:"failed_calls"`
	RateLimited int                  `json:"rate_limited"` // 429 次数
	TotalTokens int                  `json:"total_tokens"`
	ByEndpoint  []APIUsageDimension  `json:"by_endpoint"`
	ByKey       []APIUsageKeyDim     `json:"by_key"`
	Trend       []APIUsageTrendPoint `json:"trend"`
}

// APIUsageDimension 按某维度（端点）聚合的调用量与令牌消耗。
type APIUsageDimension struct {
	Name   string `json:"name"`
	Calls  int    `json:"calls"`
	Tokens int    `json:"tokens"`
}

// APIUsageKeyDim 按 API Key 聚合（带 Key 名，未解析的归到 id=0）。
type APIUsageKeyDim struct {
	KeyID   int64  `json:"key_id"`
	KeyName string `json:"key_name"`
	Calls   int    `json:"calls"`
	Tokens  int    `json:"tokens"`
}

// APIUsageTrendPoint 每日调用趋势（成功 vs 失败）。
type APIUsageTrendPoint struct {
	Date    string `json:"date"`
	Success int    `json:"success"`
	Failed  int    `json:"failed"`
}

// APICallLog 单条调用明细（GET /api/user/api-usage/logs 返回）。
type APICallLog struct {
	ID         int64  `json:"id"`
	APIKeyID   int64  `json:"api_key_id"`
	KeyName    string `json:"key_name"`
	Endpoint   string `json:"endpoint"`
	StatusCode int    `json:"status_code"`
	TokensCost int    `json:"tokens_cost"`
	Count      int    `json:"count"`
	LatencyMs  int    `json:"latency_ms"`
	CreatedAt  string `json:"created_at"`
}
```

- [ ] **Step 2: 实现存储层**

创建 `server/internal/store/mysql_apilog.go`：

```go
package store

import (
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/apilog"
	"chatgpt2api-pro/internal/model"
)

// BatchInsertAPICallLogs 多行 INSERT 一批调用日志。供 apilog.Writer 的 flush 回调使用。
func (s *MySQLStore) BatchInsertAPICallLogs(batch []apilog.Record) error {
	if len(batch) == 0 {
		return nil
	}
	var sb strings.Builder
	sb.WriteString("INSERT INTO api_call_logs (user_id, api_key_id, endpoint, status_code, tokens_cost, count, latency_ms) VALUES ")
	args := make([]any, 0, len(batch)*7)
	for i, r := range batch {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("(?,?,?,?,?,?,?)")
		args = append(args, r.UserID, r.APIKeyID, r.Endpoint, r.StatusCode, r.TokensCost, r.Count, r.LatencyMs)
	}
	_, err := s.db.Exec(sb.String(), args...)
	return err
}

// DeleteAPICallLogsBefore 删除 retentionDays 天前的调用日志，返回删除行数。
func (s *MySQLStore) DeleteAPICallLogsBefore(retentionDays int) (int64, error) {
	res, err := s.db.Exec("DELETE FROM api_call_logs WHERE created_at < NOW() - INTERVAL ? DAY", retentionDays)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// GetAPIUsageSummary 聚合指定用户近 days 天的 API 调用用量。
func (s *MySQLStore) GetAPIUsageSummary(userID int64, days int) (*model.APIUsageSummary, error) {
	sum := &model.APIUsageSummary{
		ByEndpoint: []model.APIUsageDimension{},
		ByKey:      []model.APIUsageKeyDim{},
		Trend:      []model.APIUsageTrendPoint{},
	}
	since := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	// 概览：总数/成功(2xx)/失败/429/令牌
	s.db.QueryRow(`SELECT
		COUNT(*),
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?`, userID, since).
		Scan(&sum.TotalCalls, &sum.SuccessCalls, &sum.FailedCalls, &sum.RateLimited, &sum.TotalTokens)

	// 按端点
	if rows, err := s.db.Query(`SELECT endpoint, COUNT(*), COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?
		GROUP BY endpoint ORDER BY COUNT(*) DESC`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageDimension
			if rows.Scan(&d.Name, &d.Calls, &d.Tokens) == nil {
				sum.ByEndpoint = append(sum.ByEndpoint, d)
			}
		}
	}

	// 按 Key（LEFT JOIN 取 Key 名；未解析 api_key_id=0 显示「未知」）
	if rows, err := s.db.Query(`SELECT l.api_key_id, COALESCE(k.name,''), COUNT(*), COALESCE(SUM(l.tokens_cost),0)
		FROM api_call_logs l LEFT JOIN user_api_keys k ON l.api_key_id=k.id
		WHERE l.user_id=? AND l.created_at >= ?
		GROUP BY l.api_key_id, k.name ORDER BY COUNT(*) DESC`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageKeyDim
			if rows.Scan(&d.KeyID, &d.KeyName, &d.Calls, &d.Tokens) == nil {
				if d.KeyName == "" {
					d.KeyName = "未知"
				}
				sum.ByKey = append(sum.ByKey, d)
			}
		}
	}

	// 每日趋势（成功 vs 失败），补零并归一化为 MM-DD
	trendMap := map[string][2]int{} // date -> [success, failed]
	if rows, err := s.db.Query(`SELECT DATE(created_at) AS d,
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?
		GROUP BY d ORDER BY d`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d string
			var ok, fail int
			if rows.Scan(&d, &ok, &fail) == nil {
				if len(d) >= 10 {
					d = d[5:10]
				}
				trendMap[d] = [2]int{ok, fail}
			}
		}
	}
	now := time.Now()
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("01-02")
		v := trendMap[d]
		sum.Trend = append(sum.Trend, model.APIUsageTrendPoint{Date: d, Success: v[0], Failed: v[1]})
	}

	return sum, nil
}

// GetAPICallLogs 分页查询调用明细，支持按 Key/端点/状态筛选。返回 (items, total)。
func (s *MySQLStore) GetAPICallLogs(userID int64, page, pageSize int, keyID int64, endpoint string, status int) ([]model.APICallLog, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	where := "WHERE l.user_id=?"
	args := []any{userID}
	if keyID > 0 {
		where += " AND l.api_key_id=?"
		args = append(args, keyID)
	}
	if endpoint != "" {
		where += " AND l.endpoint=?"
		args = append(args, endpoint)
	}
	if status > 0 {
		where += " AND l.status_code=?"
		args = append(args, status)
	}

	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM api_call_logs l "+where, args...).Scan(&total)

	q := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') " +
		"FROM api_call_logs l LEFT JOIN user_api_keys k ON l.api_key_id=k.id " + where +
		" ORDER BY l.id DESC LIMIT " + strconv.Itoa(pageSize) + " OFFSET " + strconv.Itoa((page-1)*pageSize)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, total, rows.Err()
}
```

> 注：`page-1)*pageSize` 与 `pageSize` 用 `strconv.Itoa` 直接拼接是安全的——二者已被 clamp 为整数，非用户原始字符串，无注入风险（其余值仍走参数化 `?`）。

- [ ] **Step 3: 编译验证**

Run: `cd server && go build ./...`
Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
git add server/internal/store/mysql_apilog.go server/internal/model/types.go
git commit -m "feat(apilog): 批量写入 + summary/logs 聚合 + 保留清理查询"
```

---

## Task 4: 存储层聚合的 MySQL 集成测试

**Files:**
- Create: `server/internal/store/mysql_apilog_test.go`

- [ ] **Step 1: 写测试**

创建 `server/internal/store/mysql_apilog_test.go`：

```go
package store

import (
	"testing"

	"chatgpt2api-pro/internal/apilog"
)

// 连不上 MySQL 则 Skip（沿用 admin_login_test 模式）
func apilogTestStore(t *testing.T) *MySQLStore {
	s, err := NewMySQLStore("root:@tcp(127.0.0.1:3306)/chatgpt2api_pro?parseTime=true")
	if err != nil {
		t.Skipf("MySQL not available: %v", err)
	}
	return s
}

func TestAPICallLogsAggregation(t *testing.T) {
	s := apilogTestStore(t)
	defer s.Close()

	const uid = 999999001 // 测试专用 user_id，避免污染真实数据
	s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)

	// 喂种子：2 成功 (1×images.generations 扣10 token, 1×vector 扣5)、1 失败 4xx、1×429
	seed := []apilog.Record{
		{UserID: uid, Endpoint: "images.generations", StatusCode: 200, TokensCost: 10, Count: 1},
		{UserID: uid, Endpoint: "vector", StatusCode: 200, TokensCost: 5, Count: 1},
		{UserID: uid, Endpoint: "images.generations", StatusCode: 400, TokensCost: 0},
		{UserID: uid, Endpoint: "images.generations", StatusCode: 429, TokensCost: 0},
	}
	if err := s.BatchInsertAPICallLogs(seed); err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)

	sum, err := s.GetAPIUsageSummary(uid, 7)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if sum.TotalCalls != 4 {
		t.Errorf("TotalCalls = %d, want 4", sum.TotalCalls)
	}
	if sum.SuccessCalls != 2 {
		t.Errorf("SuccessCalls = %d, want 2", sum.SuccessCalls)
	}
	if sum.FailedCalls != 2 {
		t.Errorf("FailedCalls = %d, want 2", sum.FailedCalls)
	}
	if sum.RateLimited != 1 {
		t.Errorf("RateLimited = %d, want 1", sum.RateLimited)
	}
	if sum.TotalTokens != 15 {
		t.Errorf("TotalTokens = %d, want 15", sum.TotalTokens)
	}
	if len(sum.Trend) != 7 {
		t.Errorf("Trend len = %d, want 7", len(sum.Trend))
	}

	items, total, err := s.GetAPICallLogs(uid, 1, 20, 0, "", 0)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if total != 4 {
		t.Errorf("logs total = %d, want 4", total)
	}
	if len(items) != 4 {
		t.Errorf("logs items = %d, want 4", len(items))
	}

	// 按端点筛选
	_, totalVec, _ := s.GetAPICallLogs(uid, 1, 20, 0, "vector", 0)
	if totalVec != 1 {
		t.Errorf("vector logs total = %d, want 1", totalVec)
	}
	// 按状态筛选
	_, total429, _ := s.GetAPICallLogs(uid, 1, 20, 0, "", 429)
	if total429 != 1 {
		t.Errorf("429 logs total = %d, want 1", total429)
	}
}

func TestDeleteAPICallLogsBefore(t *testing.T) {
	s := apilogTestStore(t)
	defer s.Close()

	const uid = 999999002
	s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)
	defer s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)

	// 一条「现在」、一条「40 天前」
	s.db.Exec("INSERT INTO api_call_logs (user_id, endpoint, status_code, created_at) VALUES (?, 'x', 200, NOW())", uid)
	s.db.Exec("INSERT INTO api_call_logs (user_id, endpoint, status_code, created_at) VALUES (?, 'x', 200, NOW() - INTERVAL 40 DAY)", uid)

	n, err := s.DeleteAPICallLogsBefore(30)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n < 1 {
		t.Errorf("deleted = %d, want >= 1 (the 40-day-old row)", n)
	}
	var remain int
	s.db.QueryRow("SELECT COUNT(*) FROM api_call_logs WHERE user_id=?", uid).Scan(&remain)
	if remain != 1 {
		t.Errorf("remaining = %d, want 1 (the fresh row)", remain)
	}
}
```

- [ ] **Step 2: 运行测试**

Run: `cd server && go test ./internal/store/ -run "TestAPICallLogs|TestDeleteAPICallLogs" -v`
Expected: 本机有 MySQL 则 PASS；无则 SKIP（皆为合格收尾，参见 standard-verify）。

- [ ] **Step 3: 提交**

```bash
git add server/internal/store/mysql_apilog_test.go
git commit -m "test(apilog): 聚合查询与保留清理的 MySQL 集成测试"
```

## Task 5: 采集中间件 + holder（技术核心）

**Files:**
- Create: `server/internal/middleware/apilogger.go`
- Modify: `server/internal/middleware/middleware.go`（context key + holder 辅助 + apiKeyAuth 写 holder）
- Modify: `server/internal/store/mysql_users.go:386-387`（GetUserByAPIKey 返回 key id）
- Modify: `server/internal/model/types.go:154`（User struct 加 APIKeyID）

- [ ] **Step 1: GetUserByAPIKey 顺带返回 key id**

`server/internal/model/types.go` 的 `User` struct，在 `RateLimitPerMin` 字段下方加：

```go
	APIKeyID             int64      `json:"-"` // 本次认证命中的 API Key 行 id（仅请求内用，不返回前端）
```

`server/internal/store/mysql_users.go` 的 `GetUserByAPIKey`（:386-387）：在 SELECT 列表把 `k.api_key=?` 之前的字段列表里、`u.id` 之后加 `k.id`，并在 Scan 把 `&u.ID` 之后加 `&u.APIKeyID`。改后两行：

```go
	err := s.db.QueryRow(`SELECT u.id, k.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),NULLIF(st.free_concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),NULLIF(st.free_token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),NULLIF(st.free_token_refill_per_hour,0),3), COALESCE(p2.rate_limit_per_min,0), COALESCE(p2.name,''), u.created_at FROM users u JOIN user_api_keys k ON u.id=k.user_id LEFT JOIN plans p2 ON u.plan_id=p2.id LEFT JOIN settings st ON st.id=1 WHERE k.api_key=? AND k.enabled=1 AND u.status=1 AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())`,
		apiKey).Scan(&u.ID, &u.APIKeyID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.RateLimitPerMin, &u.PlanName, &u.CreatedAt)
```

- [ ] **Step 2: middleware.go 加 holder 与 context key**

`server/internal/middleware/middleware.go`，在 `RateLimitKey` 常量定义（约 :38）下方追加：

```go
// APICallInfoKey 携带 *APICallInfo holder 指针。
// 关键：holder 由最外层 apiLogger 创建并塞入「父」context，apiKeyAuth/handler 拿到的虽是「子」
// context，但继承的是同一个指针——内层通过指针原地写字段，最外层事后能读到。
// 这是 context value 父子隔离下，让外层读到内层数据的唯一可靠方式。
const APICallInfoKey contextKey = "api_call_info"

// APICallInfo 一次 API 调用的可变采集信息（指针塞 context，各层原地填充）。
type APICallInfo struct {
	APIKeyID   int64
	TokensCost int
	Count      int
}

// apiCallInfo 从 context 取 holder 指针；无则返回 nil（非 API Key 路由）。
func apiCallInfo(r *http.Request) *APICallInfo {
	if info, ok := r.Context().Value(APICallInfoKey).(*APICallInfo); ok {
		return info
	}
	return nil
}

// SetAPICallCost 供 handler 回填本次令牌消耗与图片数（下单时的毛额，不计事后退款）。
// 非 API Key 调用（holder 不存在）时安全空操作。
func SetAPICallCost(r *http.Request, tokens, count int) {
	if info := apiCallInfo(r); info != nil {
		info.TokensCost = tokens
		info.Count = count
	}
}
```

- [ ] **Step 3: apiKeyAuth 写 holder 的 key id**

同文件 `ApiKeyAuth`（约 :174-179），在 `mysql.UpdateAPIKeyLastUsed(key)` 之后、`ctx := context.WithValue(...)` 之前插入（注意：写的是 holder 指针字段，不是新 context value）：

```go
			// 把命中的 Key id 回填到最外层 apiLogger 创建的 holder（若存在）
			if info, ok := r.Context().Value(APICallInfoKey).(*APICallInfo); ok && info != nil {
				info.APIKeyID = user.APIKeyID
			}
```

- [ ] **Step 4: 创建 apiLogger 中间件**

创建 `server/internal/middleware/apilogger.go`：

```go
package middleware

import (
	"context"
	"net/http"
	"time"

	"chatgpt2api-pro/internal/apilog"
)

// statusWriter 包装 ResponseWriter 捕获最终写出的 HTTP 状态码。
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// 未显式 WriteHeader 直接 Write 的情况，状态码默认为 200。
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Flush 透传，保证 SSE/流式响应不被包装层破坏。
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// APILogger 返回一个「最外层」采集中间件工厂，绑定固定 endpoint 标签。
// 包裹顺序：APILogger(ep)( RateLimit( apiKeyAuth( apiUserRL( handler )))) 。
// 因在最外层，限流提前拒绝的 429 也会被记录（此时 holder.APIKeyID 仍为 0）。
// writer 为 nil 时退化为透传（不采集），便于测试/降级。
func APILogger(writer *apilog.Writer, endpoint string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if writer == nil {
				next.ServeHTTP(w, r)
				return
			}
			info := &APICallInfo{}
			ctx := context.WithValue(r.Context(), APICallInfoKey, info)
			sw := &statusWriter{ResponseWriter: w}
			start := time.Now()

			next.ServeHTTP(sw, r.WithContext(ctx))

			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			// 非 2xx 一律不计令牌消耗（429/4xx/5xx 即便 handler 误填也归零，保证语义干净）
			tokens := info.TokensCost
			if status < 200 || status >= 300 {
				tokens = 0
			}
			writer.Submit(apilog.Record{
				UserID:     userIDFromCtx(ctx),
				APIKeyID:   info.APIKeyID,
				Endpoint:   endpoint,
				StatusCode: status,
				TokensCost: tokens,
				Count:      info.Count,
				LatencyMs:  int(time.Since(start).Milliseconds()),
			})
		})
	}
}

// userIDFromCtx 从 context 取 user id（apiKeyAuth 成功时写入；未认证为 0）。
func userIDFromCtx(ctx context.Context) int64 {
	if uid, ok := ctx.Value(UserIDKey).(int64); ok {
		return uid
	}
	return 0
}
```

> 注：`UserIDKey` 由 `apiKeyAuth` 写入的是**子** context，但 `userIDFromCtx` 读的也是这个子 context（`r.WithContext(ctx)` 传下去后，handler 在其基础上再 WithValue，子 context 链回溯可见父链所有值——但反向不可见）。这里 apiLogger 读的是它**自己创建**的 `ctx`，而 apiKeyAuth 的 `next.ServeHTTP(w, r.WithContext(authCtx))` 中 authCtx 是基于 apiLogger 的 ctx 派生的——**user id 写在更深层，apiLogger 读不到**。因此 user id 也必须走 holder。**见 Step 5 修正**。

- [ ] **Step 5: 修正——user_id 也走 holder**

上面 Step 4 的 `userIDFromCtx(ctx)` 有 context 父子隔离问题（与 tokens 同理）。修正：在 holder 加 UserID 字段，由 apiKeyAuth 回填。

改 `middleware.go` 的 `APICallInfo`（Step 2）加字段：

```go
type APICallInfo struct {
	UserID     int64
	APIKeyID   int64
	TokensCost int
	Count      int
}
```

改 `apiKeyAuth` 写 holder（Step 3）那段，连 UserID 一起回填：

```go
			if info, ok := r.Context().Value(APICallInfoKey).(*APICallInfo); ok && info != nil {
				info.UserID = user.ID
				info.APIKeyID = user.APIKeyID
			}
```

改 `apilogger.go`（Step 4）的 Submit，把 `UserID: userIDFromCtx(ctx)` 改成 `UserID: info.UserID`，并**删除** `userIDFromCtx` 函数及其 `context` 用途中不再需要的部分（`context` 仍用于 `context.WithValue`，保留 import）。

- [ ] **Step 6: 编译验证**

Run: `cd server && go build ./...`
Expected: 编译通过。

- [ ] **Step 7: 提交**

```bash
git add server/internal/middleware/ server/internal/store/mysql_users.go server/internal/model/types.go
git commit -m "feat(apilog): holder 指针采集 + apiLogger 最外层中间件 + key id 解析"
```

<!-- TASKS_PLACEHOLDER_2 -->
