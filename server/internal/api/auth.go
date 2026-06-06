package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"

	"golang.org/x/crypto/bcrypt"
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

// POST /api/auth/register
// POST /api/auth/send-code — 发送邮箱验证码
func (h *Handler) SendEmailCode(w http.ResponseWriter, r *http.Request) {
	var req struct{ Email string `json:"email"` }
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
		if alias, ok := ec.DomainAliases[domain]; ok { domain = alias }
	}
	if len(ec.DomainWhitelist) > 0 {
		allowed := false
		for _, d := range ec.DomainWhitelist { if strings.EqualFold(domain, d) { allowed = true; break } }
		if !allowed { writeJSON(w, 403, model.APIResponse{Code: 403, Message: "该邮箱域名不在允许列表中"}); return }
	}
	if len(ec.DomainBlacklist) > 0 {
		for _, d := range ec.DomainBlacklist { if strings.EqualFold(domain, d) { writeJSON(w, 403, model.APIResponse{Code: 403, Message: "该邮箱域名已被禁止"}); return } }
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
	var req struct{ Email string `json:"email"`; Code string `json:"code"` }
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

func (h *Handler) UserRegister(w http.ResponseWriter, r *http.Request) {
	var req model.UserRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱和密码不能为空"})
		return
	}
	if !validEmail(req.Email) {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱格式不正确"})
		return
	}
	if len(req.Password) < 6 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "密码至少 6 位"})
		return
	}
	// 标准化 Gmail 别名（忽略点号 + 后缀）
	_, ec := h.loadEmailConfig()
	req.Email = normalizeEmail(req.Email, &ec)

	// 邮箱验证码校验（SMTP 开启时强制）
	if ec.SMTPEnabled {
		if req.Code == "" {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请输入邮箱验证码"})
			return
		}
		ok, err := h.Redis.VerifyEmailCode(req.Email, req.Code)
		if err != nil || !ok {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "验证码错误或已过期"})
			return
		}
	}

	// 临时邮箱域名黑名单
	disposable := []string{
		"mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
		"throwaway.email", "yopmail.com", "sharklasers.com", "trashmail.com",
		"mailnator.com", "temp-mail.org", "fakeinbox.com", "dispostable.com",
		"getairmail.com", "emailondeck.com", "spamgourmet.com", "mailcatch.com",
	}
	domain := req.Email[strings.LastIndex(req.Email, "@")+1:]
	for _, d := range disposable {
		if strings.EqualFold(domain, d) {
			writeJSON(w, 403, model.APIResponse{Code: 403, Message: "不支持临时邮箱，请使用真实邮箱注册"})
			return
		}
	}

	// IP 注册频率限制（Redis 基于 IP 每天最多 5 个账号）
	ip := middleware.ClientIP(r)
	if h.Redis != nil {
		regCount, _ := h.Redis.GetRegisterCount(ip)
		limit := 5
		if ec.RegLimitPerIP > 0 { limit = ec.RegLimitPerIP }
		if regCount >= limit {
			writeJSON(w, 429, model.APIResponse{Code: 429, Message: "该 IP 今日注册已达上限"})
			return
		}
	}

	// Turnstile 验证
	settings, _ := h.MySQL.GetSettings()
	if settings.CFTurnstileEnabled {
		ok, vErr := service.VerifyTurnstileToken(req.CfTurnstileToken, settings.CFTurnstileSecretKey)
		if vErr != nil {
			log.Printf("[auth] turnstile verify error: %v", vErr)
			writeJSON(w, 500, model.APIResponse{Code: 500, Message: "验证码服务异常"})
			return
		}
		if !ok {
			writeJSON(w, 403, model.APIResponse{Code: 403, Message: "验证码验证失败，请重试"})
			return
		}
	}

	existing, _ := h.MySQL.GetUserByEmail(req.Email)
	if existing != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "该邮箱已注册"})
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	id, err := h.MySQL.CreateUser(req.Email, string(hash), req.Name)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "注册失败"})
		return
	}

	// 注册成功，增加 IP 计数
	if h.Redis != nil {
		h.Redis.IncrRegisterCount(ip)
	}

	// 自动创建默认 API Key
	h.MySQL.CreateAPIKey(id, "Default")

	// 邀请绑定 + 注册奖励（开启且带有效邀请码时）
	if ic := h.loadInviteConfig(); ic.Enabled && req.InviteCode != "" {
		inviterID := h.MySQL.GetUserIDByInviteCode(strings.ToUpper(strings.TrimSpace(req.InviteCode)))
		if inviterID > 0 && inviterID != id {
			h.MySQL.BindInviteAndReward(inviterID, id, ic.RewardRegInviter, ic.RewardRegInvitee)
		}
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "注册成功", Data: map[string]any{"id": id}})
}

// POST /api/auth/login
func (h *Handler) UserLogin(w http.ResponseWriter, r *http.Request) {
	var req model.UserLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	ctx := r.Context()

	// Turnstile 验证
	settings, _ := h.MySQL.GetSettings()
	if settings.CFTurnstileEnabled {
		ok, vErr := service.VerifyTurnstileToken(req.CfTurnstileToken, settings.CFTurnstileSecretKey)
		if vErr != nil {
			log.Printf("[auth] turnstile verify error: %v", vErr)
			writeJSON(w, 500, model.APIResponse{Code: 500, Message: "验证码服务异常"})
			return
		}
		if !ok {
			writeJSON(w, 403, model.APIResponse{Code: 403, Message: "验证码验证失败，请重试"})
			return
		}
	}

	user, err := h.MySQL.GetUserByEmail(email)
	if err == nil && user != nil && !user.Status {
		reason := user.BanReason
		if reason == "" { reason = "账号已被禁用" }
		writeJSON(w, 403, model.APIResponse{Code: 403, Message: reason})
		return
	}
	if err != nil || user == nil {
		newCount, _ := h.Redis.IncrLoginFail(ctx, email)
		msg := "邮箱或密码错误"
		if newCount >= 3 {
			ttl, _ := h.Redis.GetLoginFailTTL(ctx, email)
			secs := int(ttl.Seconds())
			if secs < 1 { secs = 1 }
			msg = fmt.Sprintf("登录失败次数过多，请在 %ds 后重试", secs)
			if newCount >= 5 {
				time.Sleep(30 * time.Second)
			} else {
				time.Sleep(5 * time.Second)
			}
		}
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: msg})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		newCount, _ := h.Redis.IncrLoginFail(ctx, email)
		msg := "邮箱或密码错误"
		if newCount >= 3 {
			ttl, _ := h.Redis.GetLoginFailTTL(ctx, email)
			secs := int(ttl.Seconds())
			if secs < 1 { secs = 1 }
			msg = fmt.Sprintf("登录失败次数过多，请在 %ds 后重试", secs)
			if newCount >= 5 {
				time.Sleep(30 * time.Second)
			} else {
				time.Sleep(5 * time.Second)
			}
		}
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: msg})
		return
	}

	// 登录成功：重置失败计数
	h.Redis.ResetLoginFail(ctx, email)

	tokenBytes := make([]byte, 32)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	h.Redis.SetToken(r.Context(), "user:"+token, user.ID, 24*time.Hour)

	keys, _ := h.MySQL.ListAPIKeys(user.ID)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"token":     token,
		"user":      user,
		"api_keys":  keys,
	}})
}

/* ── 用户鉴权路由 ──────────────────────────────────────── */

// GET /api/user/profile
func (h *Handler) UserProfile(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	user, _ := h.MySQL.GetUserByID(userID)
	if user == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: user})
}

// GET /api/user/keys
func (h *Handler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	keys, _ := h.MySQL.ListAPIKeys(userID)
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: keys})
}

// POST /api/user/keys
func (h *Handler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	body, _ := io.ReadAll(r.Body)
	var req struct{ Name string `json:"name"` }
	json.Unmarshal(body, &req)
	if req.Name == "" { req.Name = "Default" }
	key, err := h.MySQL.CreateAPIKey(userID, req.Name)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: key})
}

// DELETE /api/user/keys
func (h *Handler) DeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	body, _ := io.ReadAll(r.Body)
	var req struct{ ID int64 `json:"id"` }
	json.Unmarshal(body, &req)
	h.MySQL.DeleteAPIKey(req.ID, userID)
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}
