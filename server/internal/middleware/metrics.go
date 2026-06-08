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

// SecurityHeaders 给后端响应加基础安全头。后端主要返回 JSON / 图片，
// 核心是防嗅探(nosniff)与防被嵌入(点击劫持)；页面级 CSP 由前端 next.config 负责。
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}
