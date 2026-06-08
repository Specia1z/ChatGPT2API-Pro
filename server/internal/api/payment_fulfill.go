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

	// 计算续期天数：订单指定优先，否则取套餐默认。plan 不存在则只标记已付不开通。
	planID := order.PlanID
	days := order.DurationDays
	if p, _ := h.MySQL.GetPlanByID(order.PlanID); p != nil {
		if days <= 0 {
			days = p.DurationDays
		}
	} else {
		log.Printf("[payment] fulfillOrder: plan %d not found for order %s", order.PlanID, orderNo)
		planID = 0 // 标记已付但不开通
	}

	// 标记已付 + 开通套餐 + 核销优惠券，三步在同一事务内原子完成
	fulfilled, err := h.MySQL.FulfillOrderTx(orderNo, tradeNo, order.UserID, planID, days, order.CouponCode, order.Amount)
	if err != nil {
		log.Printf("[payment] fulfillOrder tx 失败 order=%s: %v", orderNo, err)
		return false
	}
	if !fulfilled {
		return false // 已被处理过或并发抢先
	}

	// 邀请首充奖励（幂等，仅被邀请用户首笔付费触发）。
	// 放在事务外：它自带幂等且失败不应回滚已完成的支付开通。
	h.grantInviteRecharge(order.UserID)
	return true
}
