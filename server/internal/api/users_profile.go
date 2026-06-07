package api

import (
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// GET /api/admin/users/{id}/profile — 用户完整画像（聚合接口）
// 一次性返回账号概览 + 生图统计/趋势 + 消费/邀请 + API Key/优惠券/兑换/作品 + 令牌桶快照。
// 全部复用已有 store 方法拼装，管理员鉴权。
func (h *Handler) AdminUserProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	user, err := h.MySQL.GetUserByID(id)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	if user == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	user.IsSuperAdmin = middleware.IsSuperAdminEmail(user.Email)

	// 生图统计 + 趋势 + 今日成功率
	stats, _ := h.MySQL.GetUserStats(id)
	trends, _ := h.MySQL.GetUserTrends(int(id), 14)
	todayRate := h.MySQL.GetUserSuccessRate(id)

	// 消费
	spendAmount, spendCount := h.MySQL.GetUserSpend(id)

	// 邀请裂变
	inviteCount, inviteReward, _ := h.MySQL.InviteStats(id)
	invitees, _ := h.MySQL.ListInvitees(id, 20)

	// 最近订单（前 10）
	orders, orderTotal, _ := h.MySQL.GetUserOrders(id, 1, 10)
	if orders == nil {
		orders = []model.Order{}
	}

	// 最近生图作品（前 12）
	gens, genTotal, _ := h.MySQL.GetUserGenerations(id, 1, 12)
	if gens == nil {
		gens = []model.Generation{}
	}

	// API Key / 优惠券 / 兑换记录
	keys, _ := h.MySQL.ListAPIKeys(id)
	coupons, _ := h.MySQL.ListUserCoupons(id)
	redeems, _ := h.MySQL.GetRedeemLogsByUser(id)

	// 令牌桶快照（普通余额 + 突发令牌），用 GetUserByID 解析出的有效套餐参数
	normal, burst := h.Redis.GetBucketDetail(id, user.TokenCapacity, user.TokenRefillPerHour)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"user":             user,
		"stats":            stats,
		"trends":           trends,
		"today_rate":       todayRate,
		"spend_amount":     spendAmount,
		"spend_count":      spendCount,
		"invite_count":     inviteCount,
		"invite_reward":    inviteReward,
		"invitees":         invitees,
		"orders":           orders,
		"order_total":      orderTotal,
		"generations":      gens,
		"generation_total": genTotal,
		"api_keys":         keys,
		"coupons":          coupons,
		"redeems":          redeems,
		"token_normal":     normal,
		"token_burst":      burst,
	}})
}
