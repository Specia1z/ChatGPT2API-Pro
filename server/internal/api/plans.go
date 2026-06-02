package api

import (
	"encoding/json"
	"io"
	"net/http"

	"chatgpt2api-pro/internal/model"
)

// GET /api/plans — 公开获取套餐列表
func (h *Handler) ListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.MySQL.ListPlans(true)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: plans})
}

// GET /api/admin/plans — 管理获取所有套餐
func (h *Handler) AdminListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.MySQL.ListPlans(false)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: plans})
}

// POST /api/admin/plans — 新建套餐
func (h *Handler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var p model.Plan
	json.Unmarshal(body, &p)
	id, err := h.MySQL.CreatePlan(&p)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	p.ID = int(id)
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: p})
}

// PUT /api/admin/plans — 更新套餐
func (h *Handler) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var p model.Plan
	json.Unmarshal(body, &p)
	if err := h.MySQL.UpdatePlan(&p); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: p})
}

// DELETE /api/admin/plans — 删除套餐
func (h *Handler) DeletePlan(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct{ ID int `json:"id"` }
	json.Unmarshal(body, &req)
	if err := h.MySQL.DeletePlan(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}
