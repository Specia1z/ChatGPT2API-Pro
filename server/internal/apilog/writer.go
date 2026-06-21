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
	Source     string // 调用来源：api=开发者 API Key 接口，web=站内 Web UI（默认 api）
	IP         string // 调用方 IP（X-Real-IP / X-Forwarded-For / RemoteAddr）
	Prompt     string // 生图提示词（handler 回填，截断 512）
	ImageURL   string // 代理中转后图片地址（同步端点回填，截断 1024）
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

// Writer 异步批量写入器。
type Writer struct {
	ch     chan Record
	flush  FlushFunc
	cfg    Config
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewWriter 创建一个 writer。零值 cfg 字段用内置默认。
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

// Start 启动后台消费 goroutine。
func (w *Writer) Start() {
	go w.loop()
}

// Stop 停止后台 goroutine 并 flush 剩余缓冲（仅调一次）。
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
