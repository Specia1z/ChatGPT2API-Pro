package middleware

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"chatgpt2api-pro/internal/store"
)

// defaultUserRate 后台可调的「API Key 默认每分钟请求上限」（套餐未单独配置时回退此值）。
// 启动时由 SetDefaultUserRate 从 settings 写入，保存设置时热更新。0 表示未配置，
// 此时 UserRateLimit 用传入的内置兜底基线。原子读写，无锁、对每请求路径友好。
var defaultUserRate int64

// SetDefaultUserRate 热更新后台配置的默认限速（每分钟请求数）。n<=0 视为「未配置」。
func SetDefaultUserRate(n int) {
	if n < 0 {
		n = 0
	}
	atomic.StoreInt64(&defaultUserRate, int64(n))
}

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

// RateLimit 简单令牌桶限流 (10 req/s per IP)
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ClientIP(r)
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

// UserRateLimit 按用户维度限流（用于 API Key 认证的接口）。
// 必须在 ApiKeyAuth/UserAuth 之后，从 context 取 uid；取不到则回退按 IP。
// 解决 IP 限流被同一 Key 多 IP 绕过的问题。
//
// limit 为内置兜底基线（每 window 的请求数）。生效限速按优先级解析：
//  1. 套餐 RateLimitKey(>0) — 让高需求用户买更高套餐获得更高限速；
//  2. 后台可调默认 defaultUserRate(>0) — 未单独配置的套餐统一回退此值；
//  3. 传入的内置兜底 limit — 前两者都未配置时。
func UserRateLimit(redis *store.RedisStore, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var key string
			if uid, ok := r.Context().Value(UserIDKey).(int64); ok && uid > 0 {
				key = "uid:" + strconv.FormatInt(uid, 10)
			} else {
				key = "ip:" + ClientIP(r)
			}
			// 解析生效限速：套餐 > 后台默认 > 内置兜底
			effLimit := limit
			if d := int(atomic.LoadInt64(&defaultUserRate)); d > 0 {
				effLimit = d
			}
			if pl, ok := r.Context().Value(RateLimitKey).(int); ok && pl > 0 {
				effLimit = pl
			}
			if redis != nil && !redis.AllowRate(key, effLimit, window) {
				w.Header().Set("Retry-After", "1")
				http.Error(w, `{"code":429,"message":"请求过于频繁，请稍后再试"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientIP 提取请求的客户端 IP（剥离端口）。
// 优先取反向代理设置的 X-Forwarded-For / X-Real-IP；否则回退到 RemoteAddr。
// 注意：XFF 可被客户端伪造，仅在部署于可信反向代理之后时可靠。
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// 取链路中第一个地址（最初的客户端）
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
		return xrip
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
