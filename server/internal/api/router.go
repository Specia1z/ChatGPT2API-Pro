package api

import (
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/store"
)

func NewRouter(mysql *store.MySQLStore, redis *store.RedisStore, cleaner *service.StorageCleaner) http.Handler {
	h := &Handler{MySQL: mysql, Redis: redis, Cleaner: cleaner}
	adminAuth := middleware.AdminAuth(redis)
	userAuth := middleware.UserAuth(redis)
	apiKeyAuth := middleware.ApiKeyAuth(mysql)

	mux := http.NewServeMux()

	// 公开
	mux.HandleFunc("GET /api/plans", h.ListPlans)
	mux.HandleFunc("GET /api/public/stats", h.PublicStats)

	// 用户公开（限流）
	mux.Handle("POST /api/auth/register", middleware.RateLimit(http.HandlerFunc(h.UserRegister)))
	mux.Handle("POST /api/auth/login", middleware.RateLimit(http.HandlerFunc(h.UserLogin)))
	mux.Handle("POST /api/auth/send-code", middleware.RateLimit(http.HandlerFunc(h.SendEmailCode)))
	mux.Handle("POST /api/auth/verify-code", middleware.RateLimit(http.HandlerFunc(h.VerifyEmailCode)))

	// 用户鉴权
	mux.Handle("GET /api/user/profile", userAuth(http.HandlerFunc(h.UserProfile)))
	mux.Handle("GET /api/user/keys", userAuth(http.HandlerFunc(h.ListAPIKeys)))
	mux.Handle("POST /api/user/keys", userAuth(http.HandlerFunc(h.CreateAPIKey)))
	mux.Handle("DELETE /api/user/keys", userAuth(http.HandlerFunc(h.DeleteAPIKey)))

	// 生图
	mux.Handle("POST /api/generations", userAuth(http.HandlerFunc(h.CreateGeneration)))
	mux.Handle("DELETE /api/generations", userAuth(http.HandlerFunc(h.DeleteGeneration)))
	mux.Handle("POST /api/user/checkin", userAuth(http.HandlerFunc(h.Checkin)))
	mux.Handle("GET /api/user/checkin/status", userAuth(http.HandlerFunc(h.CheckinStatus)))
	mux.Handle("GET /api/user/tokens", userAuth(http.HandlerFunc(h.GetUserTokens)))
mux.Handle("GET /api/user/stats", userAuth(http.HandlerFunc(h.GetUserStats)))
mux.Handle("POST /api/user/change-password", userAuth(http.HandlerFunc(h.ChangePassword)))
mux.Handle("POST /api/user/points/exchange", userAuth(http.HandlerFunc(h.ExchangePoints)))
	mux.Handle("GET /api/generations", userAuth(http.HandlerFunc(h.GetUserGenerations)))
	mux.Handle("POST /api/generations/share", userAuth(http.HandlerFunc(h.ToggleShare)))
	mux.HandleFunc("GET /api/images/{id}", h.ServeGenerationImage)

	// 公开画廊
	mux.HandleFunc("GET /api/gallery", h.ListGallery)

	// API v1 (API Key 认证，带限流)
	mux.Handle("POST /api/v1/images/generations", middleware.RateLimit(apiKeyAuth(http.HandlerFunc(h.CreateGeneration))))
	mux.Handle("GET /api/v1/images/generations", apiKeyAuth(http.HandlerFunc(h.GetUserGenerations)))
	mux.Handle("GET /api/v1/user/tokens", apiKeyAuth(http.HandlerFunc(h.GetUserTokens)))

	// 管理员公开（IP限流 + 账号级锁定防刷）
	mux.Handle("POST /api/admin/login", middleware.RateLimit(http.HandlerFunc(h.Login)))

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
	mux.Handle("GET /api/admin/users", adminAuth(http.HandlerFunc(h.ListUsers)))
	mux.Handle("POST /api/admin/users/create", adminAuth(http.HandlerFunc(h.AdminCreateUser)))
	mux.Handle("POST /api/admin/users/update", adminAuth(http.HandlerFunc(h.UpdateUser)))
	mux.Handle("POST /api/admin/users/reset-password", adminAuth(http.HandlerFunc(h.ResetUserPassword)))
	mux.Handle("POST /api/admin/users/points", adminAuth(http.HandlerFunc(h.AdjustUserPoints)))
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
