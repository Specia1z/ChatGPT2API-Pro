package api

import (
	"net/http"

	"chatgpt2api-pro/internal/model"
)

// GET /api/admin/stats — 全站统计（含趋势+模型分布）
func (h *Handler) GetAdminStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.MySQL.GetAdminStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取统计失败"})
		return
	}

	trends, err := h.MySQL.GetStatsTrends(7)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取趋势失败"})
		return
	}

	breakdown, err := h.MySQL.GetModelBreakdown()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取模型分布失败"})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"stats":           stats,
		"trends":          trends,
		"model_breakdown": breakdown,
	}})
}
