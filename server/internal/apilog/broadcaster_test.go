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
