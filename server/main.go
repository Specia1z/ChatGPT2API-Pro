package main

import (
	"log"
	"net/http"

	"chatgpt2api-pro/internal/api"
	"chatgpt2api-pro/internal/config"
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

	if err := http.ListenAndServe(":"+cfg.Port, router); err != nil {
		log.Fatalf("[http] 启动失败: %v", err)
	}
}
