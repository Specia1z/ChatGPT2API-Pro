package middleware

import (
	"net/http"
	"sync"
	"time"
)

type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateEntry
}

type rateEntry struct {
	count    int
	resetAt  time.Time
}

func init() {
	go func() {
		for {
			time.Sleep(1 * time.Minute)
			limiter.mu.Lock()
			now := time.Now()
			for ip, entry := range limiter.entries {
				if now.After(entry.resetAt.Add(time.Minute)) {
					delete(limiter.entries, ip)
				}
			}
			limiter.mu.Unlock()
		}
	}()
}

var limiter = &rateLimiter{entries: make(map[string]*rateEntry)}

// RateLimit 简单令牌桶限流 (5 req/s per IP)
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		limiter.mu.Lock()
		entry, ok := limiter.entries[ip]
		now := time.Now()
		if !ok || now.After(entry.resetAt) {
			entry = &rateEntry{count: 0, resetAt: now.Add(time.Second)}
			limiter.entries[ip] = entry
		}
		entry.count++
		count := entry.count
		limiter.mu.Unlock()

		if count > 10 {
			w.Header().Set("Retry-After", "1")
			http.Error(w, `{"code":429,"message":"请求过于频繁"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
