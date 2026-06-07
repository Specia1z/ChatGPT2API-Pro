package api

import (
	"net/http"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/store"
)

func NewRouter(mysql *store.MySQLStore, redis *store.RedisStore, cleaner *service.StorageCleaner) http.Handler {
	h := &Handler{MySQL: mysql, Redis: redis, Cleaner: cleaner}
	adminAuth := middleware.AdminAuth(redis, mysql)
	userAuth := middleware.UserAuth(redis, mysql)
	apiKeyAuth := middleware.ApiKeyAuth(mysql)

	// 启动时载入后台可调的「API Key 默认限速」（套餐未配时回退此值）
	if cfg, err := mysql.GetSettings(); err == nil && cfg != nil {
		middleware.SetDefaultUserRate(cfg.DefaultRateLimitPerMin)
		setPublicCacheTTL(cfg.PublicCacheTTLSeconds)
	}

	mux := http.NewServeMux()

	// 公开（带短 TTL 缓存，TTL=0 时直通；后台 public_cache_ttl_seconds 可调）
	mux.HandleFunc("GET /api/plans", publicCached("plans", h.ListPlans))
	mux.HandleFunc("GET /api/public/stats", publicCached("pubstats", h.PublicStats))

	// 用户公开（限流）
	mux.Handle("POST /api/auth/register", middleware.RateLimit(http.HandlerFunc(h.UserRegister)))
	mux.Handle("POST /api/auth/login", middleware.RateLimit(http.HandlerFunc(h.UserLogin)))
	mux.Handle("POST /api/auth/send-code", middleware.RateLimit(http.HandlerFunc(h.SendEmailCode)))
	mux.Handle("POST /api/auth/verify-code", middleware.RateLimit(http.HandlerFunc(h.VerifyEmailCode)))
	mux.Handle("POST /api/auth/reset-password", middleware.RateLimit(http.HandlerFunc(h.ResetPassword)))

	// 用户鉴权
	mux.Handle("GET /api/user/profile", userAuth(http.HandlerFunc(h.UserProfile)))
	mux.Handle("GET /api/user/keys", userAuth(http.HandlerFunc(h.ListAPIKeys)))
	mux.Handle("POST /api/user/keys", userAuth(http.HandlerFunc(h.CreateAPIKey)))
	mux.Handle("DELETE /api/user/keys", userAuth(http.HandlerFunc(h.DeleteAPIKey)))
	mux.Handle("POST /api/user/keys/toggle", userAuth(http.HandlerFunc(h.ToggleAPIKey)))

	// 生图
	mux.Handle("POST /api/generations", userAuth(http.HandlerFunc(h.CreateGeneration)))
	mux.Handle("DELETE /api/generations", userAuth(http.HandlerFunc(h.DeleteGeneration)))
	mux.Handle("POST /api/user/checkin", userAuth(http.HandlerFunc(h.Checkin)))
	mux.Handle("GET /api/user/checkin/status", userAuth(http.HandlerFunc(h.CheckinStatus)))
	mux.Handle("GET /api/user/tokens", userAuth(http.HandlerFunc(h.GetUserTokens)))
mux.Handle("GET /api/user/stats", userAuth(http.HandlerFunc(h.GetUserStats)))
mux.Handle("POST /api/user/change-password", userAuth(http.HandlerFunc(h.ChangePassword)))
mux.Handle("POST /api/user/points/exchange", middleware.RateLimit(userAuth(http.HandlerFunc(h.ExchangePoints))))
	mux.Handle("GET /api/user/invite", userAuth(http.HandlerFunc(h.GetInviteInfo)))
	mux.Handle("GET /api/generations", userAuth(http.HandlerFunc(h.GetUserGenerations)))
	mux.Handle("POST /api/generations/share", userAuth(http.HandlerFunc(h.ToggleShare)))
	mux.HandleFunc("GET /api/images/{id}", h.ServeGenerationImage)

	// 公开画廊
	mux.HandleFunc("GET /api/gallery", publicCached("gallery", h.ListGallery))

	// 公开公告（顶部 Banner）
	mux.HandleFunc("GET /api/announcements", publicCached("announce", h.ListActiveAnnouncements))

	// API v1 (API Key 认证)：IP 粗限流 + 按 uid 精确限流（防多 IP 绕过）。
	// 内置兜底 30/min；后台「默认限速」与套餐 rate_limit_per_min 可逐级覆盖（见 UserRateLimit）。
	apiUserRL := func(h http.Handler) http.Handler { return middleware.UserRateLimit(redis, 30, time.Minute)(h) }
	mux.Handle("POST /api/v1/images/generations", middleware.RateLimit(apiKeyAuth(apiUserRL(http.HandlerFunc(h.CreateGeneration)))))
	mux.Handle("GET /api/v1/images/generations", apiKeyAuth(apiUserRL(http.HandlerFunc(h.GetUserGenerations))))
	mux.Handle("GET /api/v1/user/tokens", apiKeyAuth(apiUserRL(http.HandlerFunc(h.GetUserTokens))))

	// OpenAI 兼容接口（同步返回，标准 /v1 路径，API Key 认证 + IP/uid 双限流）
	mux.Handle("POST /v1/images/generations", middleware.RateLimit(apiKeyAuth(apiUserRL(http.HandlerFunc(h.CreateImageOpenAI)))))

	// 注：管理员登录已统一到 /api/auth/login（按 users.role / .env SUPERADMIN_EMAIL 鉴权），
	// 旧的独立 /api/admin/login 已废弃移除。

	// Admin 鉴权
	mux.Handle("GET /api/accounts", adminAuth(http.HandlerFunc(h.ListAccounts)))
	mux.Handle("POST /api/accounts", adminAuth(http.HandlerFunc(h.AddAccounts)))
	mux.Handle("DELETE /api/accounts", adminAuth(http.HandlerFunc(h.DeleteAccounts)))
	mux.Handle("GET /api/accounts/stats", adminAuth(http.HandlerFunc(h.AccountStats)))
	mux.Handle("POST /api/accounts/refresh", adminAuth(http.HandlerFunc(h.RefreshAccounts)))

	// 注册机
	mux.Handle("GET /api/register", adminAuth(http.HandlerFunc(h.GetRegisterConfig)))
	mux.Handle("POST /api/register", adminAuth(http.HandlerFunc(h.SaveRegisterConfig)))
	mux.Handle("GET /api/register/events", adminAuth(http.HandlerFunc(h.RegisterEvents)))

	// 用户管理（管理员）
	mux.Handle("GET /api/admin/generations", adminAuth(http.HandlerFunc(h.GetAllGenerations)))
	mux.Handle("DELETE /api/admin/generations", adminAuth(http.HandlerFunc(h.AdminDeleteGeneration)))
	mux.Handle("GET /api/admin/scheduler/stats", adminAuth(http.HandlerFunc(h.GetSchedulerStats)))
	mux.Handle("GET /api/admin/scheduler/config", adminAuth(http.HandlerFunc(h.GetSchedulerConfig)))
	mux.Handle("POST /api/admin/scheduler/config", adminAuth(http.HandlerFunc(h.SetSchedulerConfig)))

	// 套餐管理
	mux.Handle("GET /api/admin/plans", adminAuth(http.HandlerFunc(h.AdminListPlans)))
	mux.Handle("POST /api/admin/plans", adminAuth(http.HandlerFunc(h.CreatePlan)))
	mux.Handle("PUT /api/admin/plans", adminAuth(http.HandlerFunc(h.UpdatePlan)))
	mux.Handle("DELETE /api/admin/plans", adminAuth(http.HandlerFunc(h.DeletePlan)))

	// 公告管理
	mux.Handle("GET /api/admin/announcements", adminAuth(http.HandlerFunc(h.AdminListAnnouncements)))
	mux.Handle("POST /api/admin/announcements", adminAuth(http.HandlerFunc(h.CreateAnnouncement)))
	mux.Handle("PUT /api/admin/announcements", adminAuth(http.HandlerFunc(h.UpdateAnnouncement)))
	mux.Handle("DELETE /api/admin/announcements", adminAuth(http.HandlerFunc(h.DeleteAnnouncement)))
	mux.Handle("GET /api/admin/users", adminAuth(http.HandlerFunc(h.ListUsers)))
	mux.Handle("POST /api/admin/users/create", adminAuth(http.HandlerFunc(h.AdminCreateUser)))
	mux.Handle("POST /api/admin/users/update", adminAuth(http.HandlerFunc(h.UpdateUser)))
	mux.Handle("POST /api/admin/users/reset-password", adminAuth(http.HandlerFunc(h.ResetUserPassword)))
	mux.Handle("POST /api/admin/users/points", adminAuth(http.HandlerFunc(h.AdjustUserPoints)))
	mux.Handle("POST /api/admin/users/subscription", adminAuth(http.HandlerFunc(h.AdminSetUserSubscription)))
	// 授予/撤销管理员：仅 superadmin
	mux.Handle("POST /api/admin/users/set-role", adminAuth(middleware.SuperAdminOnly(http.HandlerFunc(h.AdminSetUserRole))))
	mux.Handle("POST /api/admin/users/toggle-status", adminAuth(http.HandlerFunc(h.ToggleUserStatus)))

	// 系统设置（GET 公开，POST 需管理员）
	mux.HandleFunc("GET /api/settings", h.GetSettings)
	mux.Handle("POST /api/settings", adminAuth(http.HandlerFunc(h.SaveSettings)))
	mux.Handle("GET /api/admin/style-presets/defaults", adminAuth(http.HandlerFunc(h.GetDefaultStylePresets)))

	// 监控
	mux.Handle("GET /api/monitor", adminAuth(http.HandlerFunc(h.GetMonitorConfig)))
	mux.Handle("POST /api/monitor", adminAuth(http.HandlerFunc(h.SaveMonitorConfig)))
	mux.Handle("POST /api/monitor/trigger", adminAuth(http.HandlerFunc(h.TriggerMonitor)))
	mux.Handle("GET /api/monitor/events", adminAuth(http.HandlerFunc(h.MonitorEvents)))

	// 兑换码
	mux.Handle("GET /api/admin/redeem", adminAuth(http.HandlerFunc(h.ListRedeemCodes)))
	mux.Handle("GET /api/admin/stats", adminAuth(http.HandlerFunc(h.GetAdminStats)))
	mux.Handle("POST /api/admin/redeem/generate", adminAuth(http.HandlerFunc(h.GenerateRedeemCodes)))
	mux.Handle("DELETE /api/admin/redeem", adminAuth(http.HandlerFunc(h.DisableRedeemCode)))
	mux.Handle("DELETE /api/admin/gallery", adminAuth(http.HandlerFunc(h.AdminUnshare)))
	mux.Handle("GET /api/admin/shares/pending", adminAuth(http.HandlerFunc(h.AdminListPendingShares)))
	mux.Handle("POST /api/admin/shares/review", adminAuth(http.HandlerFunc(h.AdminReviewShare)))
	mux.Handle("GET /api/admin/coupons", adminAuth(http.HandlerFunc(h.AdminListCoupons)))
	mux.Handle("POST /api/admin/coupons", adminAuth(http.HandlerFunc(h.AdminCreateCoupon)))
	mux.Handle("DELETE /api/admin/coupons", adminAuth(http.HandlerFunc(h.AdminDisableCoupon)))
	mux.Handle("GET /api/admin/storage-config", adminAuth(http.HandlerFunc(h.GetStorageConfig)))
	mux.Handle("POST /api/admin/storage-config", adminAuth(http.HandlerFunc(h.SaveStorageConfig)))
	mux.Handle("GET /api/admin/orders", adminAuth(http.HandlerFunc(h.AdminListOrders)))
	mux.Handle("GET /api/admin/redeem/logs", adminAuth(http.HandlerFunc(h.GetRedeemLogs)))
	mux.Handle("GET /api/user/coupons", userAuth(http.HandlerFunc(h.ListUserCoupons)))
	mux.Handle("POST /api/user/coupons/claim", middleware.RateLimit(userAuth(http.HandlerFunc(h.ClaimCoupon))))
	mux.Handle("POST /api/user/coupons/use", userAuth(http.HandlerFunc(h.UseUserCoupon)))
	mux.Handle("POST /api/user/redeem", middleware.RateLimit(userAuth(http.HandlerFunc(h.RedeemCode))))
	mux.Handle("GET /api/user/redeem/history", userAuth(http.HandlerFunc(h.UserRedeemHistory)))
	mux.Handle("POST /api/orders", middleware.RateLimit(userAuth(http.HandlerFunc(h.CreateOrder))))
	mux.Handle("POST /api/orders/upgrade", middleware.RateLimit(userAuth(http.HandlerFunc(h.UpgradeOrder))))
	mux.Handle("POST /api/orders/coupon/validate", middleware.RateLimit(userAuth(http.HandlerFunc(h.ValidateCoupon))))
	mux.Handle("GET /api/orders", userAuth(http.HandlerFunc(h.GetUserOrders)))
	mux.Handle("GET /api/orders/{orderNo}", userAuth(http.HandlerFunc(h.GetOrderStatus)))
	mux.HandleFunc("POST /api/orders/alipay/notify", h.AlipayNotify)

	// 本地存储图片统一经 GET /api/images/{id} 代理读取（按 object key 实时定位文件），
	// 不再挂载 /uploads/ 静态目录——避免热切换存储路径需重启，也不暴露真实目录结构。

	return middleware.CORS(mux)
}
