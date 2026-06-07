package middleware

import (
	"net/http"

	"chatgpt2api-pro/internal/metrics"
)

// MetricsCount 全局请求计数中间件：每个进入的 HTTP 请求计一次数，喂给 QPS 滑动窗口。
// 纯原子自增，开销极小；包裹整个 router 以覆盖全部端点。
func MetricsCount(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		metrics.IncRequest()
		next.ServeHTTP(w, r)
	})
}
