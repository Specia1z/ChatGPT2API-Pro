package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/model"

	"golang.org/x/crypto/bcrypt"
)

// GET /api/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := q.Get("search")
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 { page = 1 }
	if pageSize < 1 || pageSize > 100 { pageSize = 20 }

	users, total, err := h.MySQL.ListUsers(search, page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": users, "total": total, "page": page, "page_size": pageSize,
	}})
}

// POST /api/admin/users/update
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	json.Unmarshal(body, &req)
	if err := h.MySQL.UpdateUser(req.ID, req.Name); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已更新"})
}

// POST /api/admin/users/reset-password
func (h *Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID       int64  `json:"id"`
		Password string `json:"password"`
	}
	json.Unmarshal(body, &req)
	if req.Password == "" {
		b := make([]byte, 8)
		rand.Read(b)
		req.Password = fmt.Sprintf("%x", b)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err := h.MySQL.ResetUserPassword(req.ID, string(hash)); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "密码已重置"})
}

// POST /api/admin/users/points
func (h *Handler) AdjustUserPoints(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID    int64 `json:"id"`
		Delta int   `json:"delta"`
	}
	json.Unmarshal(body, &req)
	pts, err := h.MySQL.AddUserPoints(req.ID, req.Delta)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"points": pts,
		"delta":  req.Delta,
		"action": fmt.Sprintf("%+d", req.Delta),
	}})
}

// POST /api/admin/users/toggle-status
func (h *Handler) ToggleUserStatus(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct{ ID int64 `json:"id"` }
	json.Unmarshal(body, &req)
	if err := h.MySQL.ToggleUserStatus(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已切换"})
}
