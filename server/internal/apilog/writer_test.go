package apilog

import (
	"sync"
	"testing"
	"time"
)

// sink 收集 flush 收到的所有记录（线程安全）。
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
