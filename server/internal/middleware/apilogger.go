package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/apilog"
)

// clientIP 从请求提取真实客户端 IP。
// 信任链：X-Real-IP > X-Forwarded-For 第一个 > RemoteAddr。
// X-Real-IP 由前端 Nginx/Caddy 设置（已有信任基础）。
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// 取逗号分隔的第一个 IP
		if idx := strings.IndexByte(fwd, ','); idx >= 0 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// statusWriter 包装 ResponseWriter 捕获最终写出的 HTTP 状态码。
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Write 未显式 WriteHeader 直接 Write 时，状态码默认为 200。
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Flush 透传，保证 SSE/流式响应不被包装层破坏。
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// APILogger 返回一个「最外层」采集中间件工厂，绑定固定 endpoint 标签与来源 source。
// 包裹顺序：APILogger(ep)( RateLimit( apiKeyAuth( apiUserRL( handler )))) 。
// 因在最外层，限流提前拒绝的 429 也会被记录（此时 holder.APIKeyID/UserID 仍为 0）。
// source 标识调用来源：'api'=开发者 API Key 接口，'web'=站内 Web UI；空值按 'api' 兜底。
// writer 为 nil 时退化为透传（不采集），便于测试/降级。
func APILogger(writer *apilog.Writer, endpoint, source string) func(http.Handler) http.Handler {
	if source == "" {
		source = "api"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if writer == nil {
				next.ServeHTTP(w, r)
				return
			}
			info := &APICallInfo{}
			ctx := context.WithValue(r.Context(), APICallInfoKey, info)
			sw := &statusWriter{ResponseWriter: w}
			start := time.Now()

			next.ServeHTTP(sw, r.WithContext(ctx))

			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			// 非 2xx 一律不计令牌消耗（429/4xx/5xx 即便 handler 误填也归零，保证语义干净）
			tokens := info.TokensCost
			if status < 200 || status >= 300 {
				tokens = 0
			}
			record := apilog.Record{
				UserID:     info.UserID,
				APIKeyID:   info.APIKeyID,
				Endpoint:   endpoint,
				Source:     source,
				IP:         clientIP(r),
				Prompt:     info.Prompt,
				ImageURL:   info.ImageURL,
				StatusCode: status,
				TokensCost: tokens,
				Count:      info.Count,
				LatencyMs:  int(time.Since(start).Milliseconds()),
			}
			writer.Submit(record)
			apilog.DefaultBroadcaster.Broadcast(record)
		})
	}
}
