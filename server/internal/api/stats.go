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

	points, err := h.MySQL.GetPointsStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取积分统计失败"})
		return
	}

	failures, err := h.MySQL.GetFailureReasons(7)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败原因失败"})
		return
	}

	accountProd, err := h.MySQL.GetAccountProductivity(8)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取账号产能失败"})
		return
	}

	retention, err := h.MySQL.GetRetentionStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取留存统计失败"})
		return
	}

	acctEvents, err := h.MySQL.GetAccountEventStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取账号事件统计失败"})
		return
	}

	acctEventTrends, err := h.MySQL.GetAccountEventTrends(7)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取账号事件趋势失败"})
		return
	}

	hourlyHeat, err := h.MySQL.GetHourlyHeat()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取时段分布失败"})
		return
	}

	planDist, err := h.MySQL.GetPlanDistribution()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取套餐分布失败"})
		return
	}

	revComp, err := h.MySQL.GetRevenueComposition()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取营收构成失败"})
		return
	}

	inviteBoard, err := h.MySQL.GetInviteLeaderboard(8)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取邀请榜失败"})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"stats":                stats,
		"trends":               trends,
		"model_breakdown":      breakdown,
		"points":               points,
		"failure_reasons":      failures,
		"account_prod":         accountProd,
		"retention":            retention,
		"account_events":       acctEvents,
		"account_event_trends": acctEventTrends,
		"hourly_heat":          hourlyHeat,
		"plan_distribution":    planDist,
		"revenue_composition":  revComp,
		"invite_leaderboard":   inviteBoard,
	}})
}
