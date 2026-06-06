package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"chatgpt2api-pro/internal/store"
)

type contextKey string

const AdminIDKey contextKey = "admin_id"
const UserIDKey contextKey = "user_id"

// allowedOrigins 启动时从环境变量 ALLOWED_ORIGINS（逗号分隔）读取，叠加默认的本地开发来源。
// 同源部署（Nginx 统一入口）下浏览器不发跨域请求，本配置仅用于跨域直连/调试场景。
var allowedOrigins = func() map[string]bool {
	m := map[string]bool{
		"http://localhost:3000":  true,
		"http://127.0.0.1:3000":  true,
	}
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			m[o] = true
		}
	}
	return m
}()

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// 空 Origin（同源/非浏览器）放行；否则需在白名单内
		if origin != "" && !allowedOrigins[origin] {
			origin = ""
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func AdminAuth(redis *store.RedisStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "请先登录"})
				return
			}
			token := strings.TrimPrefix(auth, "Bearer ")
			adminID, err := redis.GetToken(r.Context(), token)
			if err != nil || adminID == 0 {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "登录已过期"})
				return
			}
			redis.ExpireToken(r.Context(), token, 24*time.Hour)
			ctx := context.WithValue(r.Context(), AdminIDKey, adminID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserAuth(redis *store.RedisStore, mysql *store.MySQLStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "请先登录"})
				return
			}
			token := strings.TrimPrefix(auth, "Bearer ")
			userID, err := redis.GetToken(r.Context(), "user:"+token)
			if err != nil || userID == 0 {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "登录已过期"})
				return
			}
			// 封禁校验：用户被封后立即拒绝（即便 token 未过期），并清除其会话 token
			if mysql != nil && !mysql.IsUserActive(userID) {
				redis.DelToken(r.Context(), "user:"+token)
				writeJSON(w, http.StatusForbidden, map[string]any{"code": 403, "message": "账号已被禁用"})
				return
			}
			redis.ExpireToken(r.Context(), "user:"+token, 24*time.Hour)
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ApiKeyAuth 通过 API Key (sk-...) 认证用户
func ApiKeyAuth(mysql *store.MySQLStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "缺少 API Key"})
				return
			}
			key := strings.TrimPrefix(auth, "Bearer ")
			if !strings.HasPrefix(key, "sk-") {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "无效的 API Key 格式"})
				return
			}
			user, err := mysql.GetUserByAPIKey(key)
			if err != nil || user == nil {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 401, "message": "API Key 无效或已禁用"})
				return
			}
			// 更新最后使用时间
			mysql.UpdateAPIKeyLastUsed(key)
			ctx := context.WithValue(r.Context(), UserIDKey, user.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
