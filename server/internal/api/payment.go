package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}

func generateOrderNo() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	ts := time.Now().UnixMilli()
	return fmt.Sprintf("ORD%d%x", ts, b)
}

// POST /api/orders — 创建订单
func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	var req model.CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	plan, err := h.MySQL.GetPlanByID(req.PlanID)
	if err != nil || plan == nil || !plan.Enabled {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐无效"})
		return
	}
	if plan.PriceMonthly <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "免费套餐无需购买"})
		return
	}

	billing := req.Billing
	if billing != "yearly" {
		billing = "monthly"
	}

	// 计算原价
	originalAmount := round2(plan.PriceMonthly * float64(plan.DurationDays) / 30)
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			originalAmount = round2(plan.PriceYearly * 12 * float64(plan.DurationDaysYearly) / 365)
		} else {
			originalAmount = round2(plan.PriceYearly * 12)
		}
	}

	couponCode := req.CouponCode

	orderNo := generateOrderNo()
	order, err := h.MySQL.CreateOrder(uid, plan, orderNo, billing)
	if err != nil {
		log.Printf("[payment] CreateOrder err: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建订单失败"})
		return
	}

	// 校验优惠码（只读），计算折扣后更新订单金额，支付成功后才消耗
	discount := 0.0
	if couponCode != "" {
		if coupon, cErr := h.MySQL.ValidateCoupon(couponCode, originalAmount); cErr == nil && coupon != nil {
			if coupon.DiscountType == "percent" {
				discount = round2(originalAmount * coupon.DiscountValue / 100)
			} else {
				discount = coupon.DiscountValue
			}
			if discount > originalAmount {
				discount = originalAmount
			}
		}
	}
	if discount > 0 {
		order.Amount = round2(originalAmount - discount)
		h.MySQL.UpdateOrderAmount(orderNo, order.Amount, couponCode)
	}

	// 使用订单金额
	amount := order.Amount
	subject := plan.Name
	if billing == "yearly" {
		subject = plan.Name + "(年付)"
	}

	settings, _ := h.MySQL.GetSettings()
	gw := firstEnabledGateway(settings)
	if gw == nil {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "alipay": nil, "message": "支付未配置"}})
		return
	}
	pay, qrErr := gw.CreatePayment(settings, orderNo, subject, amount)
	if qrErr != nil {
		log.Printf("[payment] %s create err: %v", gw.Name(), qrErr)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": nil, "alipay_app_id": "", "message": "支付服务暂不可用"}})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": pay.QRCode, "gateway": gw.Name(), "alipay_app_id": settings.AlipayAppID}})
}

// GET /api/orders — 用户订单列表
func (h *Handler) UpgradeOrder(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	var req model.UpgradeOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	billing := req.Billing
	if billing != "yearly" {
		billing = "monthly"
	}

	newPlan, err := h.MySQL.GetPlanByID(req.PlanID)
	if err != nil || newPlan == nil || !newPlan.Enabled {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐无效"})
		return
	}

	// 计算新套餐总价（与 CreateOrder 保持一致的按比例算法）
	originalPrice := newPlan.PriceMonthly
	if newPlan.DurationDays > 0 {
		originalPrice = round2(newPlan.PriceMonthly * float64(newPlan.DurationDays) / 30)
	}
	if billing == "yearly" {
		if newPlan.DurationDaysYearly > 0 {
			originalPrice = round2(newPlan.PriceYearly * 12 * float64(newPlan.DurationDaysYearly) / 365)
		} else {
			originalPrice = round2(newPlan.PriceYearly * 12)
		}
	}

	user, _ := h.MySQL.GetUserByID(uid)

	// 只允许升级到更高价位（不允许降级、同级或续费）
	if user != nil && user.PlanID > 0 {
		currentPlan, _ := h.MySQL.GetPlanByID(user.PlanID)
		if currentPlan != nil {
			if currentPlan.ID == newPlan.ID {
				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "续费请使用购买功能"})
				return
			}
			if (billing == "yearly" && newPlan.PriceYearly <= currentPlan.PriceYearly) ||
				(billing != "yearly" && newPlan.PriceMonthly <= currentPlan.PriceMonthly) {
				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "只能升级到更高价位的套餐"})
				return
			}
		}
	}

	// 剩余价值：基于当前套餐的单价按比例计算，不依赖历史订单
	remainingValue := 0.0
	if user != nil && user.SubscriptionExpiresAt != nil && user.SubscriptionExpiresAt.After(time.Now()) && user.PlanID > 0 {
		currentPlan, _ := h.MySQL.GetPlanByID(user.PlanID)
		if currentPlan != nil && currentPlan.PriceMonthly > 0 && currentPlan.DurationDays > 0 {
			remainingHours := time.Until(*user.SubscriptionExpiresAt).Hours()
			if remainingHours > 0 {
				remainingValue = round2(currentPlan.PriceMonthly * float64(remainingHours) / (float64(currentPlan.DurationDays) * 24))
			}
		}
	}

	upgradePrice := originalPrice - remainingValue
	if upgradePrice < 0 {
		upgradePrice = 0
	}
	upgradePrice = float64(int(upgradePrice*100+0.5)) / 100

	if upgradePrice == 0 {
		duration := newPlan.DurationDays
		if billing == "yearly" {
			if newPlan.DurationDaysYearly > 0 {
				duration = newPlan.DurationDaysYearly
			} else {
				duration = 0
			}
		}
		h.MySQL.RawExec("UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?", newPlan.ID, duration, uid)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
			"free": true, "message": "已升级", "plan": newPlan.Name,
		}})
		return
	}

	orderNo := generateOrderNo()
	order, err := h.MySQL.CreateUpgradeOrder(uid, newPlan, orderNo, billing, upgradePrice)
	if err != nil {
		log.Printf("[payment] UpgradeOrder err: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建订单失败"})
		return
	}

	subject := newPlan.Name + "(" + billing + ")"
	settings, _ := h.MySQL.GetSettings()
	gw := firstEnabledGateway(settings)
	if gw == nil {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "alipay": nil, "message": "支付未配置"}})
		return
	}
	pay, qrErr := gw.CreatePayment(settings, orderNo, subject, upgradePrice)
	if qrErr != nil {
		log.Printf("[payment] %s upgrade create err: %v", gw.Name(), qrErr)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": nil, "alipay_app_id": "", "message": "支付服务暂不可用"}})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": pay.QRCode, "gateway": gw.Name(), "alipay_app_id": settings.AlipayAppID, "original_price": originalPrice, "remaining_value": remainingValue}})
}

func (h *Handler) GetUserOrders(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}
	orders, total, err := h.MySQL.GetUserOrders(uid, page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if orders == nil {
		orders = []model.Order{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": orders, "total": total}})
}

// GET /api/orders/{orderNo} — 查询订单状态（含支付宝主动查询）
func (h *Handler) GetOrderStatus(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(middleware.UserIDKey).(int64)
	orderNo := r.PathValue("orderNo")
	if orderNo == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	order, err := h.MySQL.GetOrderByOrderNo(orderNo)
	if err != nil || order == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "订单不存在"})
		return
	}
	if order.UserID != uid {
		writeJSON(w, 403, model.APIResponse{Code: 403, Message: "无权访问"})
		return
	}
	// 主动查询渠道（异步通知的补充/备选方案）
	if order.Status == "pending" {
		settings, _ := h.MySQL.GetSettings()
		if gw := firstEnabledGateway(settings); gw != nil {
			paid, tradeNo, qErr := gw.Query(settings, orderNo)
			if qErr == nil && paid {
				if h.fulfillOrder(orderNo, tradeNo) {
					order.Status = "paid"
				}
			}
		}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: order})
}

// GET /api/admin/orders — 管理员订单列表
func (h *Handler) AdminListOrders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	status := q.Get("status")
	search := strings.TrimSpace(q.Get("search"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	orders, total, err := h.MySQL.GetAllOrders(page, pageSize, status, search)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取订单失败"})
		return
	}
	if orders == nil {
		orders = []model.Order{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": orders, "total": total}})
}

// PaymentCallback 通用支付异步通知入口：POST /api/orders/{gateway}/notify。
// 按 {gateway} 分发到对应适配器验签解析，成功则走统一的 fulfillOrder 开通流程。
func (h *Handler) PaymentCallback(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("gateway")
	gw := getGateway(name)
	if gw == nil {
		http.Error(w, "fail", 400)
		return
	}
	settings, _ := h.MySQL.GetSettings()
	res, err := gw.HandleCallback(settings, r)
	if err != nil || res == nil || !res.Verified {
		http.Error(w, "fail", 400)
		return
	}
	if !res.Paid {
		// 验签通过但非成功状态：应答成功避免渠道重复回调
		http.Error(w, res.Ack, 200)
		return
	}

	order, err := h.MySQL.GetOrderByOrderNo(res.OrderNo)
	if err != nil || order == nil {
		http.Error(w, res.AckFail, 400)
		return
	}
	if order.Status != "pending" {
		http.Error(w, res.Ack, 200) // 幂等
		return
	}
	// 金额一致性校验（渠道提供金额时）
	if res.Amount > 0 && res.Amount != order.Amount {
		log.Printf("[payment] %s amount mismatch: notify=%.2f order=%.2f", name, res.Amount, order.Amount)
		http.Error(w, res.AckFail, 400)
		return
	}
	if !h.fulfillOrder(res.OrderNo, res.TradeNo) {
		http.Error(w, res.AckFail, 500)
		return
	}
	http.Error(w, res.Ack, 200)
}

// AlipayNotify 兼容旧路由 /api/orders/alipay/notify，转发到通用回调处理。
// Deprecated: 新渠道走 PaymentCallback（/api/orders/{gateway}/notify）。
func (h *Handler) AlipayNotify(w http.ResponseWriter, r *http.Request) {
	r.SetPathValue("gateway", "alipay")
	h.PaymentCallback(w, r)
}
