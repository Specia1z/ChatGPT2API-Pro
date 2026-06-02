package storage

import (
	"strings"

	"chatgpt2api-pro/internal/model"
)

func FromConfig(cfg *model.StorageConfig) Storage {
	switch cfg.Type {
	case "local":
		return NewLocalStore(cfg.LocalPath, cfg.LocalURL)
	case "s3":
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
