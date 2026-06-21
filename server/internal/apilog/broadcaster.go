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
