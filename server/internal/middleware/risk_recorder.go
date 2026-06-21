package middleware

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"

	"chatgpt2api-pro/internal/store"
)

// riskWindowSec 风险高频信号的采集窗口（秒），由 RiskScorer 按后台配置热更新。
// 原子读写，每请求路径无锁。默认 300s（5min），与评分窗口共用同一值。
var riskWindowSec int64 = 300

// SetRiskWindow 热更新风险采集窗口（分钟）。<=0 视为默认 5 分钟。
func SetRiskWindow(minutes int) {
	if minutes <= 0 {
		minutes = 5
	}
	atomic.StoreInt64(&riskWindowSec, int64(minutes)*60)
}

func riskWindow() time.Duration {
	return time.Duration(atomic.LoadInt64(&riskWindowSec)) * time.Second
}

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
			window := riskWindow()
			ip := ClientIP(r)
			redis.IncrRisk(ctx, uid, "qps", window)
			redis.AddRiskIP(ctx, uid, ip, time.Hour)

			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			// 仅统计可归因于用户的客户端错误（4xx）。
			// 排除：5xx（服务端/上游号池故障，非用户过错，避免事故期批量误封）、
			// 402（余额/令牌不足）、429（已被限流，不再二次计分）。
			if status >= 400 && status < 500 &&
				status != http.StatusPaymentRequired &&
				status != http.StatusTooManyRequests {
				redis.IncrRiskBy(ctx, uid, "errors", 1, window)
			}

			if info := APICallInfoFromContext(r); info != nil && info.TokensCost > 0 {
				redis.IncrRiskBy(ctx, uid, "tokens", info.TokensCost, window)
			}
		})
	}
}

// APICallInfoFromContext 从 context 取 holder 指针。
func APICallInfoFromContext(r *http.Request) *APICallInfo {
	return apiCallInfo(r)
}
