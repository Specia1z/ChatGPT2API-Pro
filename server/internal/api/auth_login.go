package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"

	"golang.org/x/crypto/bcrypt"
)

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
		if ec.RegLimitPerIP > 0 {
			limit = ec.RegLimitPerIP
		}
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
		if reason == "" {
			reason = "账号已被禁用"
		}
		writeJSON(w, 403, model.APIResponse{Code: 403, Message: reason})
		return
	}
	if err != nil || user == nil {
		newCount, _ := h.Redis.IncrLoginFail(ctx, email)
		msg := "邮箱或密码错误"
		if newCount >= 3 {
			ttl, _ := h.Redis.GetLoginFailTTL(ctx, email)
			secs := int(ttl.Seconds())
			if secs < 1 {
				secs = 1
			}
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
			if secs < 1 {
				secs = 1
			}
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

	// 标注是否为 superadmin（按 .env 邮箱实时判定，不入库），供前端显示后台入口
	user.IsSuperAdmin = middleware.IsSuperAdminEmail(user.Email)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"token":    token,
		"user":     user,
		"api_keys": keys,
	}})
}
