package storage

import (
	"log"
	"strings"

	"chatgpt2api-pro/internal/model"
)

func FromConfig(cfg *model.StorageConfig) Storage {
	switch cfg.Type {
	case "local":
		if cfg.LocalPath == "" {
			log.Printf("[storage] local 配置不完整（LocalPath 为空），回退到 database 存储")
			return NewDatabaseStore()
		}
		return NewLocalStore(cfg.LocalPath, cfg.LocalURL)
	case "s3":
		// 必填项缺失时回退到 database，避免后台 goroutine 因 NewS3Store panic 而崩溃
		if cfg.S3Endpoint == "" || cfg.S3Bucket == "" {
			log.Printf("[storage] S3 配置不完整（endpoint/bucket 为空），回退到 database 存储")
			return NewDatabaseStore()
		}
		// S3 兼容服务几乎都要求 HTTPS，默认启用
		useSSL := true
		if strings.HasPrefix(cfg.S3Endpoint, "http://") {
			useSSL = false
		} else if cfg.S3UseSSL {
			useSSL = true
		}
		return NewS3Store(cfg.S3Endpoint, cfg.S3Bucket, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Region, useSSL)
	default:
		return NewDatabaseStore()
	}
}
