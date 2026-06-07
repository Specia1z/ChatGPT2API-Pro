package main

import (
	"log"
	"net/http"

	"chatgpt2api-pro/internal/api"
	"chatgpt2api-pro/internal/config"
	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/store"
)

func main() {
	cfg := config.Load()

	log.Println("[db] 连接 MySQL...")
	mysql, err := store.NewMySQLStore(cfg.MySQLDSN)
	if err != nil {
		log.Fatalf("[db] MySQL 连接失败: %v", err)
	}
	defer mysql.Close()
	log.Println("[db] MySQL 连接成功")

	log.Println("[redis] 连接 Redis...")
	redis, err := store.NewRedisStore(cfg.RedisAddr, cfg.RedisPass)
	if err != nil {
		log.Fatalf("[redis] Redis 连接失败: %v", err)
	}
	defer redis.Close()
	log.Println("[redis] Redis 连接成功")

	log.Println("[scheduler] 初始化调度器...")
	service.InitScheduler(mysql)

	// 注入 superadmin 邮箱（.env SUPERADMIN_EMAIL）：该用户登录后强制获得最高权限
	middleware.InitAuth(cfg.SuperAdminEmail)
	if cfg.SuperAdminEmail != "" {
		log.Printf("[auth] superadmin = %s", cfg.SuperAdminEmail)
	} else {
		log.Println("[auth] 警告：未配置 SUPERADMIN_EMAIL，无人拥有超级管理员权限")
	}

	cleaner := service.NewStorageCleaner(mysql)
	router := api.NewRouter(mysql, redis, cleaner)

	// 启动账号健康监控
	service.GetMonitor(mysql).Start()

	// 本地储存定时清理
	settings, _ := mysql.GetSettings()
	if settings.StorageCleanupDays > 0 {
		cleaner.Start()
	}

	log.Printf("[http] 监听 :%s", cfg.Port)
	log.Printf("[http] http://localhost:%s", cfg.Port)

	// 显式 http.Server：设 ReadHeaderTimeout/IdleTimeout 防慢连接堆积吃内存。
	// 不设 WriteTimeout——否则会掐断 SSE 长连接（账号监控/注册机实时日志）。
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[http] 启动失败: %v", err)
	}
}
