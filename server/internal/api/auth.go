package api

import (
	"encoding/json"
	"net/mail"
	"strings"

	"chatgpt2api-pro/internal/model"
)

// validEmail 校验邮箱格式：必须可被 net/mail 解析且包含单个 @ 与非空域名。
// 防止后续 strings.LastIndex(email, "@") 切片越界 panic。
func validEmail(email string) bool {
	if email == "" || strings.Count(email, "@") != 1 {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return false
	}
	at := strings.LastIndex(email, "@")
	return at > 0 && at < len(email)-1
}

/* ── 公开路由 ────────────────────────────────────────── */

// normalizeEmail 应用影响验证码存储 key 的标准化：小写化由调用方保证，
// 这里按配置处理 Gmail 点号/+ 别名。发码与验码必须使用相同规则，否则 key 不匹配。
func normalizeEmail(email string, ec *model.EmailConfig) string {
	at := strings.LastIndex(email, "@")
	if at <= 0 || at >= len(email)-1 {
		return email
	}
	local := email[:at]
	domain := email[at+1:]
	if ec != nil && ec.NormalizeGmail && (strings.EqualFold(domain, "gmail.com") || strings.EqualFold(domain, "googlemail.com")) {
		local = strings.Split(local, "+")[0]       // foo+tag → foo
		local = strings.ReplaceAll(local, ".", "") // foo.bar → foobar
		return local + "@gmail.com"
	}
	return email
}

// loadEmailConfig 读取站点设置中的邮箱配置。
func (h *Handler) loadEmailConfig() (model.Settings, model.EmailConfig) {
	settings, _ := h.MySQL.GetSettings()
	var ec model.EmailConfig
	if settings != nil && settings.EmailConfig != "" {
		json.Unmarshal([]byte(settings.EmailConfig), &ec)
	}
	if settings == nil {
		settings = &model.Settings{}
	}
	return *settings, ec
}

// normalizeEmail 包装：读取配置并标准化（供 verify-code 端点使用）。
func (h *Handler) normalizeEmail(email string) string {
	_, ec := h.loadEmailConfig()
	return normalizeEmail(email, &ec)
}
