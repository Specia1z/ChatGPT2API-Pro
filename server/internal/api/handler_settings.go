package api

import (
	"encoding/json"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// ── Settings ─────────────────────────────────────────

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetSettings()
	// 公开接口不返回敏感字段
	cfg.CFTurnstileSecretKey = ""
	cfg.AlipayAppPrivateKey = ""
	cfg.AlipayPublicKey = ""
	cfg.EmailConfig = redactEmailConfig(cfg.EmailConfig)
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

// GetDefaultStylePresets 返回内置风格预设种子，供后台「恢复默认」使用。
// data 为 StylePreset 数组的 JSON 字符串（与 settings.style_presets 同格式）。
func (h *Handler) GetDefaultStylePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: h.MySQL.DefaultStylePresets()})
}

// redactEmailConfig 抹掉 email_config 中的 SMTP 密码，供公开接口返回。
// 保留 smtp_enabled/host/user/from 等字段以便前端展示与管理端回填，
// 仅隐藏可被直接利用的密码（与 Turnstile secret 同级处理）。
func redactEmailConfig(raw string) string {
	if raw == "" {
		return ""
	}
	var ec model.EmailConfig
	if err := json.Unmarshal([]byte(raw), &ec); err != nil {
		return "" // 无法解析则不外泄任何内容
	}
	ec.SMTPPass = ""
	b, err := json.Marshal(ec)
	if err != nil {
		return ""
	}
	return string(b)
}

func (h *Handler) SaveSettings(w http.ResponseWriter, r *http.Request) {
	var cfg model.Settings
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	h.MySQL.SaveSettings(&cfg)

	// 热更新：API Key 默认限速（套餐未配时回退此值），免重启即时生效
	middleware.SetDefaultUserRate(cfg.DefaultRateLimitPerMin)
	// 热更新：last_used 写节流间隔、DB 连接池上限、公开接口缓存 TTL（配置缓存 TTL 已在 store.SaveSettings 内应用）
	h.MySQL.SetAPIKeyLastUsedThrottle(cfg.APIKeyLastUsedThrottleSeconds)
	h.MySQL.ApplyDBPoolConfig(cfg.DBMaxOpenConns)
	setPublicCacheTTL(cfg.PublicCacheTTLSeconds)

	// 热更新：StorageCleanupDays 变化时启停本地清理定时器
	if cfg.StorageCleanupDays > 0 {
		h.Cleaner.Start()
	} else {
		h.Cleaner.Stop()
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}
