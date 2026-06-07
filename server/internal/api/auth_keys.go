package api

import (
	"encoding/json"
	"io"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
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
