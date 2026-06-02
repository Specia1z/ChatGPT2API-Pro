package config

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	Port      string
	MySQLDSN  string
	RedisAddr string
	RedisPass string
	JWTSecret string
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
	}
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
