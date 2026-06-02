package api

import (
	"encoding/json"
	"log"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// GET /api/user/coupons — 用户优惠券列表
func (h *Handler) ListUserCoupons(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	list, err := h.MySQL.ListUserCoupons(uid)
	if err != nil { writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()}); return }
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: list})
}

// POST /api/user/coupons/claim — 领取优惠码
func (h *Handler) ClaimCoupon(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	var req model.ClaimCouponRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"}); return
	}
	cp, err := h.MySQL.ClaimCoupon(uid, req.Code)
	if err != nil {
		log.Printf("[coupon] claim err: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "领取失败"}); return
	}
	if cp == nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "优惠码无效、已过期、已领完或已领过"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cp, Message: "领取成功"})
}

// POST /api/user/coupons/use — 使用优惠券
func (h *Handler) UseUserCoupon(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	var req struct{ CouponID int64 `json:"coupon_id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CouponID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"}); return
	}
	if err := h.MySQL.UseUserCoupon(req.CouponID, uid); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "使用失败"}); return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已使用"})
}
