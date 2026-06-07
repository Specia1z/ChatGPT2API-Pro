// Package metrics 提供进程级运行时指标采集：全站 QPS 滑动窗口 + 后台定时器执行状态。
// 独立成包以避免 middleware / service / api 间的循环依赖。所有读写无锁（原子/RWMutex），
// 对每请求热路径友好。
package metrics

import (
	"sync"
	"sync/atomic"
	"time"
)

// ── 全站 QPS 滑动窗口 ──────────────────────────────
// 以"秒"为桶，环形保存最近 60 秒每秒的请求数。每个请求落到当前秒的桶里（原子自增）。

const qpsWindow = 60

var (
	qpsBuckets [qpsWindow]int64 // 环形：索引 = unixSec % 60
	qpsSecs    [qpsWindow]int64 // 每个桶当前归属的 unix 秒，用于判断是否过期需清零
)

// IncRequest 记录一次请求，落到当前秒的桶。热路径，纯原子操作。
func IncRequest() {
	sec := time.Now().Unix()
	idx := sec % qpsWindow
	// 若该桶归属的秒数不是当前秒，说明是 60 秒前的陈旧桶，先重置。
	// CAS 保证只有一个 goroutine 完成重置，其余正常自增。
	if atomic.LoadInt64(&qpsSecs[idx]) != sec {
		if atomic.SwapInt64(&qpsSecs[idx], sec) != sec {
			atomic.StoreInt64(&qpsBuckets[idx], 0)
		}
	}
	atomic.AddInt64(&qpsBuckets[idx], 1)
}

// QPSSnapshot 返回 (当前秒 QPS, 近 60 秒每秒曲线[旧→新])。
// 当前秒尚未结束，取上一秒作为"当前 QPS"更稳定。
func QPSSnapshot() (current int64, series []int64) {
	now := time.Now().Unix()
	series = make([]int64, qpsWindow)
	for i := 0; i < qpsWindow; i++ {
		// 倒序填充：series[qpsWindow-1] 是最新一秒
		sec := now - int64(qpsWindow-1-i)
		idx := sec % qpsWindow
		if atomic.LoadInt64(&qpsSecs[idx]) == sec {
			series[i] = atomic.LoadInt64(&qpsBuckets[idx])
		} else {
			series[i] = 0
		}
	}
	// 当前 QPS 取上一秒（已结束、计数完整）
	prevSec := now - 1
	pidx := prevSec % qpsWindow
	if atomic.LoadInt64(&qpsSecs[pidx]) == prevSec {
		current = atomic.LoadInt64(&qpsBuckets[pidx])
	}
	return current, series
}

// ── 后台定时器执行状态 ──────────────────────────────

// TimerStatus 单个后台定时任务的运行快照。
type TimerStatus struct {
	Name      string `json:"name"`
	Running   bool   `json:"running"`     // 当前是否正在执行一轮
	LastRunAt string `json:"last_run_at"` // 上次开始执行时间（空=从未执行）
	LastMs    int64  `json:"last_ms"`     // 上次执行耗时（毫秒）
	LastOK    bool   `json:"last_ok"`     // 上次是否成功
	LastNote  string `json:"last_note"`   // 上次结果备注（如"删除3个异常号"）
	Runs      int64  `json:"runs"`        // 累计执行轮次
}

type timerState struct {
	mu        sync.RWMutex
	running   bool
	lastStart time.Time
	lastMs    int64
	lastOK    bool
	lastNote  string
	runs      int64
}

var (
	timersMu sync.RWMutex
	timers   = map[string]*timerState{}
)

func getTimer(name string) *timerState {
	timersMu.RLock()
	t := timers[name]
	timersMu.RUnlock()
	if t != nil {
		return t
	}
	timersMu.Lock()
	defer timersMu.Unlock()
	if t = timers[name]; t == nil {
		t = &timerState{}
		timers[name] = t
	}
	return t
}

// TimerStart 标记某定时器开始一轮执行，返回开始时间供 TimerDone 计算耗时。
func TimerStart(name string) time.Time {
	t := getTimer(name)
	now := time.Now()
	t.mu.Lock()
	t.running = true
	t.lastStart = now
	t.runs++
	t.mu.Unlock()
	return now
}

// TimerDone 标记某定时器一轮执行结束，记录耗时/结果。
func TimerDone(name string, start time.Time, ok bool, note string) {
	t := getTimer(name)
	t.mu.Lock()
	t.running = false
	t.lastMs = time.Since(start).Milliseconds()
	t.lastOK = ok
	t.lastNote = note
	t.mu.Unlock()
}

// TimersSnapshot 返回所有已注册定时器的状态快照。
func TimersSnapshot() []TimerStatus {
	timersMu.RLock()
	names := make([]string, 0, len(timers))
	for n := range timers {
		names = append(names, n)
	}
	snap := make([]TimerStatus, 0, len(timers))
	for _, n := range names {
		t := timers[n]
		t.mu.RLock()
		st := TimerStatus{
			Name:     n,
			Running:  t.running,
			LastMs:   t.lastMs,
			LastOK:   t.lastOK,
			LastNote: t.lastNote,
			Runs:     t.runs,
		}
		if !t.lastStart.IsZero() {
			st.LastRunAt = t.lastStart.Format("2006-01-02 15:04:05")
		}
		t.mu.RUnlock()
		snap = append(snap, st)
	}
	timersMu.RUnlock()
	return snap
}
