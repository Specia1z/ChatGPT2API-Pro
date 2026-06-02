package service

import (
	"encoding/json"
	"sync"
	"time"
)

// RegisterLogEntry 注册日志条目
type RegisterLogEntry struct {
	Time    string `json:"time"`
	Text    string `json:"text"`
	Level   string `json:"level"`
	Email   string `json:"email,omitempty"`
	Index   int    `json:"index"`
}

// RegisterBroker SSE 广播器
type RegisterStats struct {
	Success int `json:"success"`
	Fail    int `json:"fail"`
	Done    int `json:"done"`
	Running int `json:"running"`
}

type RegisterBroker struct {
	mu          sync.RWMutex
	subscribers map[chan RegisterLogEntry]struct{}
	logs        []RegisterLogEntry
	stats       RegisterStats
}

var broker = &RegisterBroker{
	subscribers: make(map[chan RegisterLogEntry]struct{}),
}

func GetRegisterBroker() *RegisterBroker { return broker }

func (b *RegisterBroker) Subscribe() chan RegisterLogEntry {
	ch := make(chan RegisterLogEntry, 100)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *RegisterBroker) Unsubscribe(ch chan RegisterLogEntry) {
	b.mu.Lock()
	delete(b.subscribers, ch)
	close(ch)
	b.mu.Unlock()
}

func (b *RegisterBroker) Log(text, level string, email string, index int) {
	entry := RegisterLogEntry{
		Time:  time.Now().Format("15:04:05"),
		Text:  text,
		Level: level,
		Email: email,
		Index: index,
	}
	b.mu.Lock()
	b.logs = append(b.logs, entry)
	if len(b.logs) > 500 {
		b.logs = b.logs[len(b.logs)-500:]
	}
	for ch := range b.subscribers {
		select {
		case ch <- entry:
		default:
		}
	}
	b.mu.Unlock()
}

func (b *RegisterBroker) UpdateStats(success, fail, done, running int) {
	b.mu.Lock()
	b.stats = RegisterStats{Success: success, Fail: fail, Done: done, Running: running}
	// 广播 stats 更新给所有订阅者
	statsData, _ := json.Marshal(b.stats)
	for ch := range b.subscribers {
		select {
		case ch <- RegisterLogEntry{Time: "stats", Text: string(statsData), Level: "__stats__"}:
		default:
		}
	}
	b.mu.Unlock()
}

func (b *RegisterBroker) GetStats() RegisterStats {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.stats
}

func (b *RegisterBroker) GetLogs() []RegisterLogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()
	result := make([]RegisterLogEntry, len(b.logs))
	copy(result, b.logs)
	return result
}
