package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

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
	// 大额兑换（>= 阈值）享受额外赠送，阈值后台可调（0=默认 50）
	bonusThreshold := settings.PointsExchangeBonusThreshold
	if bonusThreshold <= 0 {
		bonusThreshold = 50
	}
	bonus := 0
	pointsCost := req.Tokens * rate
	if settings.PointsExchangeBonus > 0 && req.Tokens >= bonusThreshold {
		bonus = settings.PointsExchangeBonus * (req.Tokens / bonusThreshold)
		pointsCost = req.Tokens * rate // 额外赠送不额外扣积分
	}

	// 检查积分是否足够
	if user.Points < pointsCost {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("积分不足，需要 %d 积分（当前 %d）", pointsCost, user.Points)})
		return
	}

	// 令牌桶参数（用户套餐优先，否则取默认）
	totalTokens := req.Tokens + bonus
	capacity := 50
	refill := 3
	if user.TokenCapacity > 0 {
		capacity = user.TokenCapacity
	}
	if user.TokenRefillPerHour > 0 {
		refill = user.TokenRefillPerHour
	}

	// 突发令牌囤积上限预检：防积分兑换无限囤生图额度（绕过 capacity）
	burstCap := settings.BurstTokenCap
	if burstCap > 0 {
		_, curBurst := h.Redis.GetBucketDetail(userID, capacity, refill)
		room := burstCap - int(curBurst)
		if room <= 0 {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("突发令牌已达上限 %d，无法继续兑换", burstCap)})
			return
		}
		if totalTokens > room {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("超过突发令牌上限，本次最多还能兑换 %d 个（含赠送，上限 %d）", room, burstCap)})
			return
		}
	}

	// 扣积分（原子条件更新 points>=cost 才扣，防并发 TOCTOU 超扣）
	remaining, ok, err := h.MySQL.DeductUserPoints(userID, pointsCost, "exchange_token", "积分兑换突发令牌")
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "扣除积分失败"})
		return
	}
	if !ok {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("积分不足，需要 %d 积分（当前 %d）", pointsCost, remaining)})
		return
	}

	// 加突发令牌（脚本按 burstCap 原子封顶，兜底并发场景下的预检竞争）
	burst, added, err := h.Redis.AddBurstToken(userID, capacity, refill, totalTokens, burstCap)
	if err != nil {
		// Redis 失败回滚积分
		h.MySQL.AddUserPoints(userID, pointsCost, "exchange_token", "兑换令牌失败退回")
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "兑换令牌失败，积分已退回"})
		return
	}

	// 触顶兜底：实际新增不足请求量（并发抢占了余量），按缺口退还积分
	if int(added) < totalTokens {
		shortfall := totalTokens - int(added)
		refundPoints := shortfall * rate
		if refundPoints > pointsCost {
			refundPoints = pointsCost
		}
		if refundPoints > 0 {
			remaining, _ = h.MySQL.AddUserPoints(userID, refundPoints, "exchange_token", "突发令牌触顶退回")
			pointsCost -= refundPoints
		}
	}

	normal, _ := h.Redis.GetBucketDetail(userID, capacity, refill)
	total := normal + burst

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"burst":          burst,
		"normal":         normal,
		"total":          total,
		"points_used":    pointsCost,
		"points_remain":  remaining,
		"tokens_added":   int(added),
		"bonus":          bonus,
	}})
}

// GET /api/user/points/logs — 用户积分流水（分页，倒序）
func (h *Handler) GetPointsLogs(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)

	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	logs, total, err := h.MySQL.GetUserPointsLogs(userID, page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	if logs == nil {
		logs = []model.PointsLog{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": logs, "total": total, "page": page, "page_size": pageSize,
	}})
}
