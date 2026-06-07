package api

import (
	"log"
)

// fulfillOrder 订单支付成功后的统一开通流程（收敛原先散落在异步通知/主动查询的重复逻辑）：
//  1. 幂等标记订单已支付（MarkOrderPaid 内部保证只成功一次）
//  2. 按订单套餐续期/设置用户订阅（未过期累加，过期从现在起；duration<=0 视为永久）
//  3. 核销订单关联的优惠券
//  4. 发放邀请首充奖励（幂等）
//
// 所有支付渠道支付成功后都调用此方法，确保各渠道开通行为一致。
// 返回 true 表示本次调用真正完成了开通（订单此前为 pending）；false 表示订单已处理过或失败。
func (h *Handler) fulfillOrder(orderNo, tradeNo string) bool {
	order, err := h.MySQL.GetOrderByOrderNo(orderNo)
	if err != nil || order == nil {
		return false
	}
	if order.Status != "pending" {
		return false // 幂等：已处理
	}

	ok, err := h.MySQL.MarkOrderPaid(orderNo, tradeNo)
	if err != nil || !ok {
		return false // 标记失败或被并发抢先（非 pending→paid）
	}

	// 开通/续期套餐
	if p, _ := h.MySQL.GetPlanByID(order.PlanID); p != nil {
		d := order.DurationDays
		if d <= 0 {
			d = p.DurationDays
		}
		if d > 0 {
			h.MySQL.RawExec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`, order.PlanID, d, order.UserID)
		} else {
			h.MySQL.RawExec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", order.PlanID, order.UserID)
		}
		// 核销优惠券（仅在套餐有效时）
		if order.CouponCode != "" {
			h.MySQL.AtomicUseCoupon(order.CouponCode, order.Amount)
		}
	} else {
		log.Printf("[payment] fulfillOrder: plan %d not found for order %s", order.PlanID, orderNo)
	}

	// 邀请首充奖励（幂等，仅被邀请用户首笔付费触发）
	h.grantInviteRecharge(order.UserID)
	return true
}
