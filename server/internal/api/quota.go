package api

import (
	"context"

	"chatgpt2api-pro/internal/model"
)

// quotaEffectiveRefill 计算考虑「月配额降速」后的令牌桶恢复速率。
// 当用户套餐设了月配额(>0)、后台开启撞额降速、且本月已用 >= 配额时，
// 把恢复速率砍到 QuotaThrottleRefill（转卖产能归零，正常用户温和退化）。
// 其余情况返回原始 baseRefill 不变。riskConfigJSON 来自 settings.RiskConfigJSON。
func (h *Handler) quotaEffectiveRefill(ctx context.Context, userID int64, monthlyQuota, baseRefill int, riskConfigJSON string) int {
	if monthlyQuota <= 0 {
		return baseRefill
	}
	rc := model.ParseRiskConfig(riskConfigJSON)
	if !rc.QuotaThrottleEnabled {
		return baseRefill
	}
	if h.Redis.GetMonthlyUsage(ctx, userID) >= monthlyQuota {
		// percent 模式：按套餐速率百分比降速（高套餐降后仍较快）；fixed 模式：统一固定速率。
		if rc.QuotaThrottleMode == "percent" {
			pct := rc.QuotaThrottlePercent
			if pct <= 0 || pct >= 100 {
				pct = 10
			}
			throttled := baseRefill * pct / 100
			if throttled < 1 {
				throttled = 1 // 至少保底 1/h，避免完全停滞
			}
			return throttled
		}
		return rc.QuotaThrottleRefill
	}
	return baseRefill
}

// recordMonthlyUsage 在成功扣令牌后累加本月配额计量（monthlyQuota<=0 时空操作）。
func (h *Handler) recordMonthlyUsage(ctx context.Context, userID int64, monthlyQuota, cost int) {
	if monthlyQuota > 0 {
		h.Redis.AddMonthlyUsage(ctx, userID, cost)
	}
}

// refundMonthlyUsage 退还本月配额计量（生图建记录失败等场景，monthlyQuota<=0 时空操作）。
func (h *Handler) refundMonthlyUsage(ctx context.Context, userID int64, monthlyQuota, cost int) {
	if monthlyQuota > 0 {
		h.Redis.RefundMonthlyUsage(ctx, userID, cost)
	}
}
