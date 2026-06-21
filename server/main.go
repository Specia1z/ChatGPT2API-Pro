package main

import (
	"log"
	"net/http"
	"time"

	"chatgpt2api-pro/internal/api"
	"chatgpt2api-pro/internal/apilog"
	"chatgpt2api-pro/internal/config"
	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/store"
)

func main() {
	cfg := config.Load()

	log.Println("🗄️  正在连接 MySQL 数据库…")
	mysql, err := store.NewMySQLStore(cfg.MySQLDSN)
	if err != nil {
		log.Fatalf("❌ MySQL 连接失败：%v", err)
	}
	defer mysql.Close()
	log.Println("✅ MySQL 连接成功")

	log.Println("⚡ 正在连接 Redis 缓存…")
	redis, err := store.NewRedisStore(cfg.RedisAddr, cfg.RedisPass)
	if err != nil {
		log.Fatalf("❌ Redis 连接失败：%v", err)
	}
	defer redis.Close()
	log.Println("✅ Redis 连接成功")

	log.Println("🧭 正在初始化生图调度器…")
	service.InitScheduler(mysql)

	// 注入 superadmin 邮箱（.env SUPERADMIN_EMAIL）：该用户登录后强制获得最高权限
	middleware.InitAuth(cfg.SuperAdminEmail)
	if cfg.SuperAdminEmail != "" {
		log.Printf("👑 超级管理员已配置：%s", cfg.SuperAdminEmail)
	} else {
		log.Println("⚠️  未配置 SUPERADMIN_EMAIL，当前无人拥有超级管理员权限")
	}

	cleaner := service.NewStorageCleaner(mysql)

	// API 调用日志异步 writer：请求路径非阻塞投递，后台批量落库
	apiLogWriter := apilog.NewWriter(apilog.Config{}, mysql.BatchInsertAPICallLogs)
	apiLogWriter.Start()
	defer apiLogWriter.Stop()

	router := api.NewRouter(mysql, redis, cleaner, apiLogWriter)
	// 全局中间件链：安全头 + QPS 采集，包裹整个路由
	handler := middleware.SecurityHeaders(middleware.MetricsCount(router))

	// 启动账号健康监控
	service.GetMonitor(mysql).Start()

	// 启动用户风险评分定时器（每 5 分钟）
	service.NewRiskScorer(mysql, redis).Start()

	// 本地储存定时清理
	settings, _ := mysql.GetSettings()
	if settings.StorageCleanupDays > 0 {
		cleaner.Start()
	}

	// API 调用日志保留期清理（每日一轮，按 settings.api_log_retention_days，0=默认 30）
	go func() {
		runCleanup := func() {
			cfg, _ := mysql.GetSettings()
			days := 30
			if cfg != nil && cfg.APILogRetentionDays > 0 {
				days = cfg.APILogRetentionDays
			}
			if n, err := mysql.DeleteAPICallLogsBefore(days); err != nil {
				log.Printf("[apilog] retention cleanup fail: %v", err)
			} else if n > 0 {
				log.Printf("[apilog] retention cleanup: 删除 %d 条 (保留 %d 天)", n, days)
			}
		}
		runCleanup()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runCleanup()
		}
	}()

	// 待支付订单超时关闭（每分钟检查，阈值由 settings.order_timeout_minutes 控制）
	service.NewOrderExpirer(mysql).Start()

	log.Printf("🚀 服务已启动，正在监听 :%s", cfg.Port)
	log.Printf("🌐 访问地址：http://localhost:%s", cfg.Port)

	// 显式 http.Server：设 ReadHeaderTimeout/IdleTimeout 防慢连接堆积吃内存。
	// 不设 WriteTimeout——否则会掐断 SSE 长连接（账号监控/注册机实时日志）。
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("❌ HTTP 服务启动失败：%v", err)
	}
}
