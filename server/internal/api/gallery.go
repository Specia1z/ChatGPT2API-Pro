package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// POST /api/generations/share — 切换自己生图的分享状态
func (h *Handler) ToggleShare(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}

	var req struct {
		ID     int64 `json:"id"`
		Shared bool  `json:"shared"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	if err := h.MySQL.ToggleShare(req.ID, uid, req.Shared); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, 404, model.APIResponse{Code: 404, Message: "不存在或无权操作"})
			return
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "操作失败"})
		return
	}

	msg := "已取消分享"
	if req.Shared {
		msg = "已提交审核，通过后将展示到广场"
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: msg})
}

// GET /api/gallery — 公开画廊（无需登录）
func (h *Handler) ListGallery(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	gens, total, err := h.MySQL.ListSharedGalleries(page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if gens == nil {
		gens = []model.Generation{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items":     gens,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	}})
}

// DELETE /api/admin/gallery — 管理员下架分享
func (h *Handler) AdminUnshare(w http.ResponseWriter, r *http.Request) {
	var req struct{ ID int64 `json:"id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.AdminUnshare(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "操作失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已下架"})
}

// GET /api/admin/shares/pending — 待审分享队列（管理员）
func (h *Handler) AdminListPendingShares(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}
	gens, total, err := h.MySQL.ListPendingShares(page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if gens == nil {
		gens = []model.Generation{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items":     gens,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	}})
}

// POST /api/admin/shares/review — 审核分享：通过/拒绝（管理员）
func (h *Handler) AdminReviewShare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID      int64  `json:"id"`
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if len(req.Reason) > 255 {
		req.Reason = req.Reason[:255]
	}
	if err := h.MySQL.AdminReviewShare(req.ID, req.Approve, req.Reason); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "操作失败"})
		return
	}
	msg := "已通过并展示到广场"
	if !req.Approve {
		msg = "已拒绝"
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: msg})
}
