package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"sort"
	"time"

	"chatgpt2api-pro/internal/metrics"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// systemSnapshot 系统监控一次采样的完整快照。
type systemSnapshot struct {
	Time       string                 `json:"time"`
	QPS        int64                  `json:"qps"`          // 当前每秒请求数
	QPSSeries  []int64                `json:"qps_series"`   // 近 60 秒曲线
	Perf       perfStat               `json:"perf"`         // 运行时性能
	Scheduler  map[string]any         `json:"scheduler"`    // 生图调度器状态
	Timers     []metrics.TimerStatus  `json:"timers"`       // 后台定时器
	Pool       poolUsage              `json:"pool"`         // 号池占用
}

type perfStat struct {
	Goroutines  int     `json:"goroutines"`
	HeapAllocMB float64 `json:"heap_alloc_mb"` // 当前堆占用
	SysMB       float64 `json:"sys_mb"`        // 向 OS 申请的总内存
	NumGC       uint32  `json:"num_gc"`        // 累计 GC 次数
	GCPauseMs   float64 `json:"gc_pause_ms"`   // 最近一次 GC 暂停
}

type poolBusyItem struct {
	AccountID int64  `json:"account_id"`
	Email     string `json:"email"`
	Slots     int    `json:"slots"`
}

type poolUsage struct {
	TotalAccounts int            `json:"total_accounts"`
	BusyAccounts  int            `json:"busy_accounts"` // 当前有占用的账号数
	TotalSlots    int            `json:"total_slots"`   // 全站当前占用的槽位总数
	Top           []poolBusyItem `json:"top"`           // 占用最高的账号（Top 10）
}

// collectSnapshot 采集一次系统监控快照。
func (h *Handler) collectSnapshot() systemSnapshot {
	qps, series := metrics.QPSSnapshot()

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	perf := perfStat{
		Goroutines:  runtime.NumGoroutine(),
		HeapAllocMB: float64(ms.HeapAlloc) / 1024 / 1024,
		SysMB:       float64(ms.Sys) / 1024 / 1024,
		NumGC:       ms.NumGC,
		GCPauseMs:   float64(ms.PauseNs[(ms.NumGC+255)%256]) / 1e6,
	}

	var sched map[string]any
	if s := service.GetScheduler(); s != nil {
		sched = s.Stats()
	}

	// 号池占用：查所有账号 → 批量读 Redis 槽位
	pool := poolUsage{Top: []poolBusyItem{}}
	if infos, err := h.MySQL.ListAccountSlotInfo(); err == nil {
		pool.TotalAccounts = len(infos)
		ids := make([]int64, len(infos))
		emailByID := make(map[int64]string, len(infos))
		for i, a := range infos {
			ids[i] = a.ID
			emailByID[a.ID] = a.Email
		}
		slots := h.Redis.GetImageSlots(context.Background(), ids)
		for id, n := range slots {
			pool.BusyAccounts++
			pool.TotalSlots += n
			pool.Top = append(pool.Top, poolBusyItem{AccountID: id, Email: emailByID[id], Slots: n})
		}
		sort.Slice(pool.Top, func(i, j int) bool { return pool.Top[i].Slots > pool.Top[j].Slots })
		if len(pool.Top) > 10 {
			pool.Top = pool.Top[:10]
		}
	}

	return systemSnapshot{
		Time:      time.Now().Format("15:04:05"),
		QPS:       qps,
		QPSSeries: series,
		Perf:      perf,
		Scheduler: sched,
		Timers:    metrics.TimersSnapshot(),
		Pool:      pool,
	}
}

// GET /api/admin/system/snapshot — 单次系统监控快照（非 SSE，供首屏/降级用）
func (h *Handler) GetSystemSnapshot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: h.collectSnapshot()})
}

// GET /api/admin/system/events — 系统监控 SSE，每 2 秒推一次快照
func (h *Handler) SystemEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	send := func() {
		data, _ := json.Marshal(h.collectSnapshot())
		fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", data)
		flusher.Flush()
	}

	send() // 首帧立即推
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send()
		}
	}
}
