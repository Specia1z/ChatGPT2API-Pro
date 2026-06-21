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

// GetDefaultUserRate 读取后台配置的默认限速（每分钟请求数）。0 表示未配置。
// 供风险评分器复用限流器的生效速率解析，保持量纲一致。
func GetDefaultUserRate() int {
	return int(atomic.LoadInt64(&defaultUserRate))
}

// riskLimitedUIDs 风险评分 ≥ limit_threshold 的用户集合。
// 由 RiskScorer 每轮评分后写入，UserRateLimit 读取。
var riskLimitedUIDs sync.Map

// SetRiskLimitedUIDs 更新风险限流用户列表。
func SetRiskLimitedUIDs(uids map[int64]bool) {
	// 重建 map（sync.Map 不支持 Clear）
	riskLimitedUIDs = sync.Map{}
	for uid := range uids {
		riskLimitedUIDs.Store(uid, true)
	}
}

// IsRiskLimited 判断用户是否被风险限流（≥ limit_threshold 且 < ban_threshold）。
func IsRiskLimited(uid int64) bool {
	_, ok := riskLimitedUIDs.Load(uid)
	return ok
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

// rateLimitBucket 通用 IP 固定窗口限流：每秒最多 perSec 个请求。
// scope 用于隔离不同接口的计数（key=ip:scope），避免图片接口消耗注册接口的额度。
func rateLimitBucket(scope string, perSec int, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := ClientIP(r) + ":" + scope
		limiter.mu.Lock()
		entry, ok := limiter.entries[key]
		now := time.Now()
		if !ok || now.After(entry.resetAt) {
			entry = &rateEntry{count: 0, resetAt: now.Add(time.Second)}
			limiter.entries[key] = entry
		}
		entry.count++
		count := entry.count
		limiter.mu.Unlock()

		if count > perSec {
			w.Header().Set("Retry-After", "1")
			http.Error(w, `{"code":429,"message":"请求过于频繁"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimit 简单 IP 限流 (10 req/s per IP)，用于注册/登录/验证码等敏感接口。
func RateLimit(next http.Handler) http.Handler {
	return rateLimitBucket("default", 10, next)
}

// RateLimitImage 图片代理限流 (60 req/s per IP)。比 RateLimit 宽松——
// 正常浏览画廊一屏会并发加载十几张图；同时挡住把图片 URL 当图床高频盗刷流量的滥用。
func RateLimitImage(next http.Handler) http.Handler {
	return rateLimitBucket("image", 60, next)
}

// RateLimitPublic 公开只读接口限流 (30 req/s per IP)，给 /api/settings 等匿名裸接口兜底。
func RateLimitPublic(next http.Handler) http.Handler {
	return rateLimitBucket("public", 30, next)
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
			// 风险限流降级
			if uid, ok := r.Context().Value(UserIDKey).(int64); ok && uid > 0 && IsRiskLimited(uid) {
				effLimit /= 2
				if effLimit < 5 {
					effLimit = 5
				}
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
// 注意：XFF 可被客户端伪造。生产部署于宝塔 Nginx 之后，Nginx 用 proxy_set_header
// X-Real-IP $remote_addr 强制写入真实客户端 IP（覆盖客户端伪造值），故优先信任 X-Real-IP。
// XFF 仅作兜底，且取最后一跳（最接近本服务的可信代理追加值），而非客户端可控的第一个。
func ClientIP(r *http.Request) string {
	// 1. 优先 X-Real-IP（Nginx 强制写入，不可被客户端伪造）
	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
		return xrip
	}
	// 2. 兜底 XFF：取最后一跳（反代追加），不取客户端可伪造的第一个
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); last != "" {
			return last
		}
	}
	// 3. 直连：RemoteAddr
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
