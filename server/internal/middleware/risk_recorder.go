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
//
// ⚠ 必须嵌在 APILogger 之内层（APILogger 在外、RiskRecorder 在内），因为：
// auth 中间件用 r.WithContext 派生子 context 设置 UserIDKey，更外层的 r.Context()
// 读不到子 context 的值。故 uid 不能从 context.Value 读，而要从 APILogger 创建、
// auth 原地回填的 *APICallInfo holder 指针读（holder 跨父子 context 共享同一指针）。
// 同理 TokensCost 也走 holder。
func RiskRecorder(redis *store.RedisStore) func(http.Handler) http.Handler {
	ctx := context.Background()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r)

			info := apiCallInfo(r)
			// 优先从 holder 读 uid（auth 原地回填）；holder 缺失时回退 context（兼容旧布线）。
			var uid int64
			if info != nil {
				uid = info.UserID
			}
			if uid <= 0 {
				uid, _ = r.Context().Value(UserIDKey).(int64)
			}
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

			if info != nil && info.TokensCost > 0 {
				redis.IncrRiskBy(ctx, uid, "tokens", info.TokensCost, window)
			}
		})
	}
}
