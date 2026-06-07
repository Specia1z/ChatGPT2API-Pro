package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port      string
	MySQLDSN  string
	RedisAddr string
	RedisPass string
	JWTSecret string

	// HTTP server 超时（高并发健壮性，防慢连接堆积吃内存）。
	// 注意：不设 WriteTimeout——会掐断 SSE 长连接（账号监控/注册机实时日志）。
	ReadHeaderTimeout time.Duration
	IdleTimeout       time.Duration
}

func Load() *Config {
	loadDotEnv()

	mysqlHost := env("MYSQL_HOST", "127.0.0.1")
	mysqlPort := env("MYSQL_PORT", "3306")
	mysqlUser := env("MYSQL_USER", "root")
	mysqlPass := env("MYSQL_PASS", "")
	mysqlDB := env("MYSQL_DB", "chatgpt2api_pro")
	redisHost := env("REDIS_HOST", "127.0.0.1")
	redisPort := env("REDIS_PORT", "6379")

	println("[config] MySQL: " + mysqlUser + "@" + mysqlHost + ":" + mysqlPort + "/" + mysqlDB)
	println("[config] Redis: " + redisHost + ":" + redisPort)

	dsn := mysqlUser + ":" + mysqlPass + "@tcp(" + mysqlHost + ":" + mysqlPort + ")/" + mysqlDB + "?charset=utf8mb4&parseTime=true"
	if v := env("MYSQL_DSN", ""); v != "" {
		dsn = v
	}

	return &Config{
		Port:      env("PORT", "8080"),
		MySQLDSN:  dsn,
		RedisAddr: redisHost + ":" + redisPort,
		RedisPass: env("REDIS_PASS", ""),
		JWTSecret: env("JWT_SECRET", "change-me"),
		// 默认：读头 15s（防 slowloris），空闲 120s 回收。0 可显式关闭。
		ReadHeaderTimeout: time.Duration(envInt("HTTP_READ_HEADER_TIMEOUT_SEC", 15)) * time.Second,
		IdleTimeout:       time.Duration(envInt("HTTP_IDLE_TIMEOUT_SEC", 120)) * time.Second,
	}
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return fallback
}

func loadDotEnv() {
	f, err := os.Open(".env")
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
