package api

import (
	"net/http"

	"chatgpt2api-pro/internal/model"
)

// GET /api/public/stats — 落地页公开统计
func (h *Handler) PublicStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.MySQL.GetAdminStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取统计失败"})
		return
	}

	// 可用率 = 今日成功率
	total := stats.TodaySuccess + stats.TodayFailed
	successRate := 100.0
	if total > 0 {
		successRate = float64(stats.TodaySuccess) / float64(total) * 100
	}

	// 平均每日生成量（基于总记录数和最早记录的天数）
	avgDaily := float64(stats.TotalGenerations)
	if days := h.MySQL.GetGenerationsAgeDays(); days > 0 {
		avgDaily = float64(stats.TotalGenerations) / float64(days)
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"total_generations": stats.TotalGenerations,
		"success_rate":      successRate,
		"avg_daily":         avgDaily,
	}})
}

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
