package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// POST /api/user/points/exchange — 积分兑换突发令牌
func (h *Handler) ExchangePoints(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)

	body, _ := io.ReadAll(r.Body)
	var req struct {
		Tokens int `json:"tokens"` // 要兑换的令牌数
	}
	json.Unmarshal(body, &req)
	if req.Tokens <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "兑换数量必须大于 0"})
		return
	}

	// 读取当前用户信息和兑换比例
	user, _ := h.MySQL.GetUserByID(userID)
	if user == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}

	settings, err := h.MySQL.GetSettings()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "读取配置失败"})
		return
	}

	rate := settings.PointsExchangeRate
	if rate <= 0 {
		rate = 10 // 默认 10 积分 = 1 令牌
	}

	// 计算所需积分
	// 大额兑换（>= 50 令牌）享受额外赠送
	bonus := 0
	pointsCost := req.Tokens * rate
	if settings.PointsExchangeBonus > 0 && req.Tokens >= 50 {
		bonus = settings.PointsExchangeBonus * (req.Tokens / 50)
		pointsCost = req.Tokens * rate // 额外赠送不额外扣积分
	}

	// 检查积分是否足够
	if user.Points < pointsCost {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("积分不足，需要 %d 积分（当前 %d）", pointsCost, user.Points)})
		return
	}

	// 扣积分（原子条件更新防并发超扣）
	remaining, err := h.MySQL.AddUserPoints(userID, -pointsCost)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "扣除积分失败"})
		return
	}

	// 加突发令牌
	totalTokens := req.Tokens + bonus
	capacity := 50
	refill := 3
	if user.TokenCapacity > 0 {
		capacity = user.TokenCapacity
	}
	if user.TokenRefillPerHour > 0 {
		refill = user.TokenRefillPerHour
	}
	burst, err := h.Redis.AddBurstToken(userID, capacity, refill, totalTokens)
	if err != nil {
		// Redis 失败回滚积分
		h.MySQL.AddUserPoints(userID, pointsCost)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "兑换令牌失败，积分已退回"})
		return
	}

	normal, _ := h.Redis.GetBucketDetail(userID, capacity, refill)
	total := normal + burst

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"burst":          burst,
		"normal":         normal,
		"total":          total,
		"points_used":    pointsCost,
		"points_remain":  remaining,
		"tokens_added":   totalTokens,
		"bonus":          bonus,
	}})
}
