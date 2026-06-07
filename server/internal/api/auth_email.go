package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"

	"golang.org/x/crypto/bcrypt"
)

// POST /api/user/change-password — 用户自行修改密码
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.OldPassword == "" || req.NewPassword == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "密码不能为空"})
		return
	}
	if len(req.NewPassword) < 6 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "新密码至少 6 位"})
		return
	}
	user, _ := h.MySQL.GetUserByID(uid)
	if user == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.OldPassword)) != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "旧密码错误"})
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err := h.MySQL.ResetUserPassword(uid, string(hash)); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "修改失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "密码已修改"})
}

// POST /api/auth/send-code — 发送邮箱验证码
func (h *Handler) SendEmailCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱不能为空"})
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if !validEmail(email) {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱格式不正确"})
		return
	}

	settings, ec := h.loadEmailConfig()
	if !ec.SMTPEnabled {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱验证未开启"})
		return
	}

	// 标准化 Gmail 别名（忽略点号 + 后缀），并解析用于黑白名单的域名
	email = normalizeEmail(email, &ec)
	domain := email[strings.LastIndex(email, "@")+1:]
	if ec.DomainAliases != nil {
		if alias, ok := ec.DomainAliases[domain]; ok {
			domain = alias
		}
	}
	if len(ec.DomainWhitelist) > 0 {
		allowed := false
		for _, d := range ec.DomainWhitelist {
			if strings.EqualFold(domain, d) {
				allowed = true
				break
			}
		}
		if !allowed {
			writeJSON(w, 403, model.APIResponse{Code: 403, Message: "该邮箱域名不在允许列表中"})
			return
		}
	}
	if len(ec.DomainBlacklist) > 0 {
		for _, d := range ec.DomainBlacklist {
			if strings.EqualFold(domain, d) {
				writeJSON(w, 403, model.APIResponse{Code: 403, Message: "该邮箱域名已被禁止"})
				return
			}
		}
	}

	// 发送冷却：同一邮箱 60 秒内不可重复发码（防邮件轰炸）
	if h.Redis != nil {
		if cd, _ := h.Redis.EmailCodeCooldown(email); cd > 0 {
			writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("请 %d 秒后再获取验证码", int(cd.Seconds())+1)})
			return
		}
	}

	// 生成验证码并发送
	code := service.RandomCode(6)
	if err := h.Redis.SetEmailCode(email, code); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "发送失败"})
		return
	}
	if err := service.SendVerificationEmail(&ec, email, code, settings.SiteTitle); err != nil {
		log.Printf("[email] send to %s failed: %v", email, err)
		// 发送失败：清除验证码与冷却，允许用户立即重试
		h.Redis.ClearEmailCode(email)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "邮件发送失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "验证码已发送"})
}

// POST /api/auth/verify-code — 验证邮箱验证码
func (h *Handler) VerifyEmailCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Code == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	// 与发码时一致的标准化（小写 + Gmail 别名），否则查不到验证码
	email := h.normalizeEmail(strings.TrimSpace(strings.ToLower(req.Email)))
	ok, _ := h.Redis.VerifyEmailCode(email, req.Code)
	if !ok {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "验证码错误或已过期"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "验证成功"})
}

// POST /api/auth/reset-password — 凭邮箱验证码重置密码（忘记密码）
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Code == "" || req.Password == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if len(req.Password) < 6 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "新密码至少 6 位"})
		return
	}
	// 与发码一致的标准化，否则验证码 key 不匹配
	email := h.normalizeEmail(strings.TrimSpace(strings.ToLower(req.Email)))

	// 校验验证码（复用注册/发码的防爆破体系）
	ok, _ := h.Redis.VerifyEmailCode(email, req.Code)
	if !ok {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "验证码错误或已过期"})
		return
	}

	// 查用户（不存在也返回成功文案，避免邮箱枚举）
	user, _ := h.MySQL.GetUserByEmail(email)
	if user == nil {
		writeJSON(w, 200, model.APIResponse{Code: 200, Message: "密码已重置，请用新密码登录"})
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err := h.MySQL.ResetUserPassword(user.ID, string(hash)); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "重置失败，请重试"})
		return
	}
	// 重置成功：清除验证码 + 踢掉该用户所有活跃会话（强制用新密码重登）
	h.Redis.ClearEmailCode(email)
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "密码已重置，请用新密码登录"})
}
