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
const IsSuperAdminKey contextKey = "is_super_admin"

// IsAPIKey 标记本次请求是否通过 API Key（sk-）认证（而非网页 token）。
// 供生图 handler 区分来源：API Key 调用可走「不永久落地、短时缓存」策略。
const IsAPIKey contextKey = "is_api_key"

// superAdminEmail 由 InitAuth 在启动时注入（来自 .env SUPERADMIN_EMAIL，已小写）。
// 该邮箱用户登录后强制拥有最高权限，不依赖 DB role，是可靠的权限 bootstrap。
var superAdminEmail string

// InitAuth 注入 superadmin 邮箱（启动时调用一次）。
func InitAuth(email string) { superAdminEmail = email }

// IsSuperAdminEmail 判断邮箱是否为配置的 superadmin（供 handler 标注用户角色）。
func IsSuperAdminEmail(email string) bool {
	return superAdminEmail != "" && strings.EqualFold(strings.TrimSpace(email), superAdminEmail)
}

// RateLimitKey 携带当前用户套餐的 API 每分钟请求上限（0=用默认）。
// 由 ApiKeyAuth 从已查出的用户套餐写入，供 UserRateLimit 取用，避免限流中间件二次查库。
const RateLimitKey contextKey = "rate_limit_per_min"

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

// AdminAuth 管理后台鉴权：复用统一的 user token（token:user:<t>），
// 每请求从 DB 复核用户角色——superadmin（.env 邮箱）或 role>=1（admin）才放行。
// 不再依赖独立 admin token，授/撤权即时生效，封禁用户立即失去后台权限。
func AdminAuth(redis *store.RedisStore, mysql *store.MySQLStore) func(http.Handler) http.Handler {
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
			email, status, role, ok := mysql.GetUserAuthInfo(userID)
			if !ok || !status {
				// 用户不存在或已被封禁：清除会话
				redis.DelToken(r.Context(), "user:"+token)
				writeJSON(w, http.StatusForbidden, map[string]any{"code": 403, "message": "账号不可用"})
				return
			}
			isSuper := superAdminEmail != "" && strings.EqualFold(email, superAdminEmail)
			if !isSuper && role < 1 {
				writeJSON(w, http.StatusForbidden, map[string]any{"code": 403, "message": "无管理员权限"})
				return
			}
			redis.ExpireToken(r.Context(), "user:"+token, 24*time.Hour)
			ctx := context.WithValue(r.Context(), AdminIDKey, userID)
			ctx = context.WithValue(ctx, UserIDKey, userID)
			ctx = context.WithValue(ctx, IsSuperAdminKey, isSuper)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SuperAdminOnly 在 AdminAuth 之后使用，仅放行 superadmin（.env 邮箱用户）。
// 用于授予/撤销 admin 角色等高危操作。
func SuperAdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSuper, _ := r.Context().Value(IsSuperAdminKey).(bool); !isSuper {
			writeJSON(w, http.StatusForbidden, map[string]any{"code": 403, "message": "仅超级管理员可操作"})
			return
		}
		next.ServeHTTP(w, r)
	})
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
			// 把套餐限速带入 context，供 UserRateLimit 取用（0=默认）
			ctx = context.WithValue(ctx, RateLimitKey, user.RateLimitPerMin)
			// 标记 API Key 来源，供生图 handler 走「不永久落地」策略
			ctx = context.WithValue(ctx, IsAPIKey, true)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
