package api

import (
	"encoding/json"
	"io"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

func (h *Handler) CreateRecharge(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}

	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	var req struct {
		Points  int    `json:"points"`
		Gateway string `json:"gateway"`
	}
	json.Unmarshal(body, &req)
	if req.Points <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "积分数量必须大于 0"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	gw := selectGateway(settings, req.Gateway)
	if gw == nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "暂无可用支付渠道"})
		return
	}

	cc := parseCreditConfig(settings.CreditConfig)
	rate := creditRate(cc.Rate)
	amount := round2(float64(req.Points) / float64(rate))
	if amount <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "金额计算异常"})
		return
	}

	orderNo := generateOrderNo()
	if err := h.MySQL.CreateRechargeOrder(uid, orderNo, req.Points, amount); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建订单失败"})
		return
	}

	subject := "积分充值 " + orderNo
	result, err := gw.CreatePayment(settings, orderNo, subject, amount)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "发起支付失败"})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"order_no":     orderNo,
		"amount":       amount,
		"points":       req.Points,
		"redirect_url": result.RedirectURL,
		"qr_code":      result.QRCode,
	}})
}

func (h *Handler) GetRechargeStatus(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	orderNo := r.PathValue("orderNo")
	order, err := h.MySQL.GetOrderByOrderNo(orderNo)
	if err != nil || order == nil || order.UserID != uid {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "订单不存在"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"order_no": order.OrderNo,
		"status":   order.Status,
		"points":   order.RechargePoints,
		"amount":   order.Amount,
	}})
}
