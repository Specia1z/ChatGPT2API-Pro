package middleware

import (
	"context"
	"net/http"
	"time"

	"chatgpt2api-pro/internal/store"
)

// RiskRecorder 在 API 调用后累加 Redis 风险计数器（QPS/错误/IP/令牌）。
// 嵌在 APILogger 之后、RateLimit 之前即可。
func RiskRecorder(redis *store.RedisStore) func(http.Handler) http.Handler {
	ctx := context.Background()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r)

			uid, _ := r.Context().Value(UserIDKey).(int64)
			if uid <= 0 {
				return
			}
			ip := ClientIP(r)
			redis.IncrRisk(ctx, uid, "qps", 5*time.Minute)
			redis.AddRiskIP(ctx, uid, ip, time.Hour)

			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			if status < 200 || status >= 300 {
				redis.IncrRiskBy(ctx, uid, "errors", 1, 5*time.Minute)
			}

			if info := APICallInfoFromContext(r); info != nil && info.TokensCost > 0 {
				redis.IncrRiskBy(ctx, uid, "tokens", info.TokensCost, 5*time.Minute)
			}
		})
	}
}

// APICallInfoFromContext 从 context 取 holder 指针。
func APICallInfoFromContext(r *http.Request) *APICallInfo {
	return apiCallInfo(r)
}
