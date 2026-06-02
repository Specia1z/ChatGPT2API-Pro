package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"chatgpt2api-pro/internal/model"
)

// GET /api/admin/coupons — 管理员获取所有优惠码
func (h *Handler) AdminListCoupons(w http.ResponseWriter, r *http.Request) {
	list, err := h.MySQL.ListCoupons()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: list})
}

// POST /api/admin/coupons — 管理员创建优惠码
func (h *Handler) AdminCreateCoupon(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req model.CouponCode
	if err := json.Unmarshal(body, &req); err != nil || req.Code == "" || req.DiscountType == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.DiscountType != "percent" && req.DiscountType != "fixed" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "折扣类型必须为 percent 或 fixed"})
		return
	}
	if req.DiscountValue <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "折扣值必须大于 0"})
		return
	}
	if req.DiscountType == "percent" && req.DiscountValue > 100 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "百分比折扣不能超过 100"})
		return
	}
	if req.MaxUses <= 0 {
		req.MaxUses = 1
	}
	if _, err := h.MySQL.CreateCoupon(&req); err != nil {
		log.Printf("[coupon] 创建失败: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建失败，可能优惠码已存在"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已创建"})
}

// DELETE /api/admin/coupons — 管理员禁用优惠码
func (h *Handler) AdminDisableCoupon(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct{ ID int64 `json:"id"` }
	json.Unmarshal(body, &req)
	if req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.DisableCoupon(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已禁用"})
}

// POST /api/orders/coupon/validate — 校验优惠码
func (h *Handler) ValidateCoupon(w http.ResponseWriter, r *http.Request) {
	var req model.ValidateCouponRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" || req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	billing := req.Billing
	if billing != "yearly" {
		billing = "monthly"
	}

	// 获取套餐计算原价
	plan, err := h.MySQL.GetPlanByID(req.PlanID)
	if err != nil || plan == nil || !plan.Enabled {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐无效"})
		return
	}

	originalPrice := plan.PriceMonthly
	if plan.DurationDays > 0 {
		originalPrice = round2(plan.PriceMonthly * float64(plan.DurationDays) / 30)
	}
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			originalPrice = round2(plan.PriceYearly * 12 * float64(plan.DurationDaysYearly) / 365)
		} else {
			originalPrice = round2(plan.PriceYearly * 12)
		}
	}

	coupon, err := h.MySQL.ValidateCoupon(req.Code, originalPrice)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "校验失败"})
		return
	}
	if coupon == nil {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: model.CouponDiscount{
			Valid: false, Message: "优惠码无效或已过期",
		}})
		return
	}

	discount := 0.0
	if coupon.DiscountType == "percent" {
		discount = round2(originalPrice * coupon.DiscountValue / 100)
	} else {
		discount = coupon.DiscountValue
	}
	if discount > originalPrice {
		discount = originalPrice
	}

	finalPrice := round2(originalPrice - discount)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: model.CouponDiscount{
		Valid:         true,
		Code:          coupon.Code,
		DiscountType:  coupon.DiscountType,
		DiscountValue: coupon.DiscountValue,
		OriginalPrice: originalPrice,
		Discount:      discount,
		FinalPrice:    finalPrice,
	}})
}
