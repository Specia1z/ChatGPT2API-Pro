package api

import (
	"encoding/json"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// loadInviteConfig 读取邀请裂变配置。
func (h *Handler) loadInviteConfig() model.InviteConfig {
	var ic model.InviteConfig
	settings, _ := h.MySQL.GetSettings()
	if settings != nil && settings.InviteConfig != "" {
		json.Unmarshal([]byte(settings.InviteConfig), &ic)
	}
	return ic
}

// grantInviteRecharge 被邀请用户首笔付费成功时发放首充奖励（幂等，无邀请记录则无操作）。
func (h *Handler) grantInviteRecharge(inviteeID int64) {
	ic := h.loadInviteConfig()
	if !ic.Enabled {
		return
	}
	if ic.RewardRechargeInviter == 0 && ic.RewardRechargeInvitee == 0 {
		return
	}
	h.MySQL.RewardInviteRecharge(inviteeID, ic.RewardRechargeInviter, ic.RewardRechargeInvitee)
}

// GET /api/user/invite — 我的邀请码 + 战绩
func (h *Handler) GetInviteInfo(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	ic := h.loadInviteConfig()
	if !ic.Enabled {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"enabled": false}})
		return
	}
	code, err := h.MySQL.GetOrCreateInviteCode(uid)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取邀请码失败"})
		return
	}
	count, totalReward, _ := h.MySQL.InviteStats(uid)
	invitees, _ := h.MySQL.ListInvitees(uid, 50)
	if invitees == nil {
		invitees = []model.InviteeItem{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"enabled":               true,
		"invite_code":           code,
		"invited_count":         count,
		"total_reward":          totalReward,
		"reward_reg_invitee":    ic.RewardRegInvitee,
		"reward_recharge_invitee": ic.RewardRechargeInvitee,
		"invitees":              invitees,
	}})
}
