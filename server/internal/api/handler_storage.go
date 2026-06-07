package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/model"
)

func (h *Handler) GetStorageConfig(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetStorageConfig()
	// 不返回密钥明文（管理端回填保存时空值会被 SaveStorageConfig 保留）
	cfg.S3SecretKey = ""
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) SaveStorageConfig(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var cfg model.StorageConfig
	json.Unmarshal(body, &cfg)
	if cfg.Type == "" {
		cfg.Type = "database"
	}

	// 必填项校验：错误配置应在保存时拒绝，而非等到生图时后台 panic
	switch cfg.Type {
	case "s3":
		var missing []string
		if cfg.S3Endpoint == "" {
			missing = append(missing, "Endpoint")
		}
		if cfg.S3Bucket == "" {
			missing = append(missing, "Bucket")
		}
		if cfg.S3AccessKey == "" {
			missing = append(missing, "Access Key")
		}
		// SecretKey 允许为空：表示沿用已保存的密钥（由 SaveStorageConfig 回填）
		if cfg.S3SecretKey == "" {
			if existing, _ := h.MySQL.GetStorageConfig(); existing == nil || existing.S3SecretKey == "" {
				missing = append(missing, "Secret Key")
			}
		}
		if len(missing) > 0 {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "S3 配置缺少必填项：" + strings.Join(missing, "、")})
			return
		}
		if cfg.S3Region == "" {
			cfg.S3Region = "us-east-1"
		}
	case "local":
		// 图片经 /api/images/{id} 代理读取，LocalURL 仅作可选标记，不再必填。
		if cfg.LocalPath == "" {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "本地存储需填写存储路径"})
			return
		}
	}

	if err := h.MySQL.SaveStorageConfig(&cfg); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	cfg.S3SecretKey = "" // 返回时不回显密钥
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

// resolveUserID 尝试从请求中提取用户 ID
