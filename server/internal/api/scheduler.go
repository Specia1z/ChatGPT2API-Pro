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
		MaxGlobal  int `json:"max_global"`
		MaxPerUser int `json:"max_per_user"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.MaxGlobal < 1 || req.MaxGlobal > 200 { req.MaxGlobal = 20 }
	if req.MaxPerUser < 1 || req.MaxPerUser > 50 { req.MaxPerUser = 5 }

	service.GetScheduler().SetMax(req.MaxGlobal, req.MaxPerUser)
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: service.GetScheduler().Stats()})
}

// GET /api/admin/scheduler/config — 获取调度器配置
func (h *Handler) GetSchedulerConfig(w http.ResponseWriter, r *http.Request) {
	stats := service.GetScheduler().Stats()
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}
