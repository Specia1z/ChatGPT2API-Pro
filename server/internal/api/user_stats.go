package api

import (
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// GET /api/user/stats — 用户用量统计（趋势 + 概览 + 配额 + 突发令牌 + 兑换比例）
func (h *Handler) GetUserStats(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)

	user, _ := h.MySQL.GetUserByID(userID)

	// 统计概览
	stats, err := h.MySQL.GetUserStats(userID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取统计失败"})
		return
	}

	// 近 7 天趋势
	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n >= 1 && n <= 90 {
			days = n
		}
	}
	trends, err := h.MySQL.GetUserTrends(int(userID), days)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取趋势失败"})
		return
	}

	// 令牌桶信息
	capacity := 50
	refill := 3
	if user != nil {
		if user.TokenCapacity > 0 {
			capacity = user.TokenCapacity
		}
		if user.TokenRefillPerHour > 0 {
			refill = user.TokenRefillPerHour
		}
	}

	normal := float64(capacity)
	burst := float64(0)
	if h.Redis != nil {
		normal, burst = h.Redis.GetBucketDetail(userID, capacity, refill)
	}

	// 今日成功率
	successRate := h.MySQL.GetUserSuccessRate(userID)

	// 兑换配置
	settings, _ := h.MySQL.GetSettings()
	exchangeRate := 10
	exchangeBonus := 0
	if settings != nil {
		if settings.PointsExchangeRate > 0 {
			exchangeRate = settings.PointsExchangeRate
		}
		exchangeBonus = settings.PointsExchangeBonus
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"stats":          stats,
		"trends":         trends,
		"tokens":         normal + burst,
		"normal":         normal,
		"burst":          burst,
		"capacity":       capacity,
		"refill":         refill,
		"success_rate":   successRate,
		"plan_name":      user.PlanName,
		"points":         user.Points,
		"exchange_rate":  exchangeRate,
		"exchange_bonus": exchangeBonus,
	}})
}
