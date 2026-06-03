package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

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

/* ── 公开路由 ────────────────────────────────────────── */

// POST /api/auth/register
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

	// 自动创建默认 API Key
	h.MySQL.CreateAPIKey(id, "Default")

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
