package api

import (
	"encoding/json"
	"net/http"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// GET /api/admin/scheduler/stats — 调度器状态
func (h *Handler) GetSchedulerStats(w http.ResponseWriter, r *http.Request) {
	stats := service.GetScheduler().Stats()
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}

// POST /api/admin/scheduler/config — 更新调度器配置
func (h *Handler) SetSchedulerConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MaxGlobal     int `json:"max_global"`
		MaxPerUser    int `json:"max_per_user"`
		MaxPerAccount int `json:"max_per_account"`
		MaxAttempts   int `json:"max_attempts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.MaxGlobal < 1 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "全局并发上限必须 ≥ 1"})
		return
	}
	if req.MaxPerUser < 1 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "单用户并发上限必须 ≥ 1"})
		return
	}
	if req.MaxPerUser > req.MaxGlobal {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "单用户并发上限不能超过全局并发上限"})
		return
	}
	// 兼容未传 max_per_account 的旧前端：保持当前值不变
	if req.MaxPerAccount == 0 {
		req.MaxPerAccount = service.GetScheduler().MaxPerAccount()
	}
	if req.MaxPerAccount < 1 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "单账号并发上限必须 ≥ 1"})
		return
	}

	// max_attempts 允许为 0（=自动按号池大小），负数钳为 0
	if req.MaxAttempts < 0 {
		req.MaxAttempts = 0
	}

	service.GetScheduler().SetMax(req.MaxGlobal, req.MaxPerUser, req.MaxPerAccount, req.MaxAttempts)
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: service.GetScheduler().Stats()})
}

// GET /api/admin/scheduler/config — 获取调度器配置
func (h *Handler) GetSchedulerConfig(w http.ResponseWriter, r *http.Request) {
	stats := service.GetScheduler().Stats()
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}
