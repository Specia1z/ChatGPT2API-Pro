package api

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

/* ── 用户鉴权路由 ──────────────────────────────────────── */

// GET /api/user/profile
func (h *Handler) UserProfile(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	user, _ := h.MySQL.GetUserByID(userID)
	if user == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	user.IsSuperAdmin = middleware.IsSuperAdminEmail(user.Email)
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
	var req struct {
		Name string `json:"name"`
	}
	json.Unmarshal(body, &req)
	if req.Name == "" {
		req.Name = "Default"
	}
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
	var req struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(body, &req)
	h.MySQL.DeleteAPIKey(req.ID, userID)
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}

// POST /api/user/keys/toggle — 启用/禁用单个 API Key
func (h *Handler) ToggleAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID      int64 `json:"id"`
		Enabled bool  `json:"enabled"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.SetAPIKeyEnabled(req.ID, userID, req.Enabled); err != nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "密钥不存在或无权操作"})
		return
	}
	msg := "已启用"
	if !req.Enabled {
		msg = "已禁用"
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: msg})
}

/* ── Webhook 配置（每用户一个全局回调） ──────────────────── */

// GET /api/user/webhook — 取当前用户的 webhook 配置（抹除 secret 明文，只回显 has_secret）
func (h *Handler) GetWebhook(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	wh, err := h.MySQL.GetUserWebhook(userID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "读取失败"})
		return
	}
	if wh == nil {
		// 未配置：返回空壳，前端据此显示「未设置」
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: &model.UserWebhook{UserID: userID, Enabled: true}})
		return
	}
	wh.Secret = "" // 不外泄明文，仅 has_secret 标记是否已设置
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: wh})
}

// POST /api/user/webhook — 保存 webhook 配置（url/secret/enabled）
func (h *Handler) SaveWebhook(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	body, _ := io.ReadAll(r.Body)
	var req struct {
		URL     string `json:"url"`
		Secret  string `json:"secret"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL != "" {
		// 仅允许 http/https，且不能是内网/环回地址（与投递时的 SSRF 防护一致，提前在保存时拦截给出明确反馈）
		if msg := validateWebhookURL(req.URL); msg != "" {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: msg})
			return
		}
	}
	if len(req.Secret) > 128 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "secret 过长（最多 128 字符）"})
		return
	}
	if err := h.MySQL.SaveUserWebhook(userID, req.URL, req.Secret, req.Enabled); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "保存失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已保存"})
}

// DELETE /api/user/webhook — 删除 webhook 配置
func (h *Handler) DeleteWebhook(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	if err := h.MySQL.DeleteUserWebhook(userID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "删除失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}

// validateWebhookURL 校验 webhook URL 协议与主机（保存时的前置 SSRF 防护，返回错误信息，空=通过）。
// 实际投递时 service 层的 dialer 还会在连接前对解析出的 IP 二次校验（防 DNS rebinding）。
func validateWebhookURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "URL 格式错误"
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "仅支持 http/https 协议"
	}
	host := u.Hostname()
	if host == "" {
		return "URL 缺少主机名"
	}
	// 字面 IP 直接校验；域名留给投递时 dialer 解析后校验
	if ip := net.ParseIP(host); ip != nil && service.IsBlockedWebhookIP(ip) {
		return "不允许指向内网/环回地址"
	}
	if strings.EqualFold(host, "localhost") {
		return "不允许指向内网/环回地址"
	}
	return ""
}
