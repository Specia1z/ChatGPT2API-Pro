package api

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

const alipayGateway = "https://openapi.alipay.com/gateway.do"

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
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	var req model.CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"}); return
	}
	plan, err := h.MySQL.GetPlanByID(req.PlanID)
	if err != nil || plan == nil || !plan.Enabled { writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐无效"}); return }
	if plan.PriceMonthly <= 0 { writeJSON(w, 400, model.APIResponse{Code: 400, Message: "免费套餐无需购买"}); return }

	billing := req.Billing
	if billing != "yearly" { billing = "monthly" }

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
	if err != nil { log.Printf("[payment] CreateOrder err: %v", err); writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建订单失败"}); return }

	// 校验优惠码（只读），计算折扣后更新订单金额，支付成功后才消耗
	discount := 0.0
	if couponCode != "" {
		if coupon, cErr := h.MySQL.ValidateCoupon(couponCode, originalAmount); cErr == nil && coupon != nil {
			if coupon.DiscountType == "percent" {
				discount = round2(originalAmount * coupon.DiscountValue / 100)
			} else {
				discount = coupon.DiscountValue
			}
			if discount > originalAmount { discount = originalAmount }
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
	if !settings.AlipayEnabled || settings.AlipayAppID == "" {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "alipay": nil, "message": "支付未配置"}})
		return
	}
	qrCode, qrErr := alipayPrecreate(settings, orderNo, subject, amount)
	if qrErr != nil {
		log.Printf("[payment] precreate err: %v", qrErr)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": nil, "alipay_app_id": "", "message": "支付服务暂不可用"}})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": qrCode, "alipay_app_id": settings.AlipayAppID}})
}

// GET /api/orders — 用户订单列表
func (h *Handler) UpgradeOrder(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	var req model.UpgradeOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"}); return
	}
	billing := req.Billing
	if billing != "yearly" { billing = "monthly" }

	newPlan, err := h.MySQL.GetPlanByID(req.PlanID)
	if err != nil || newPlan == nil || !newPlan.Enabled { writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐无效"}); return }

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
				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "续费请使用购买功能"}); return
			}
			if (billing == "yearly" && newPlan.PriceYearly <= currentPlan.PriceYearly) ||
				(billing != "yearly" && newPlan.PriceMonthly <= currentPlan.PriceMonthly) {
				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "只能升级到更高价位的套餐"}); return
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
	if upgradePrice < 0 { upgradePrice = 0 }
	upgradePrice = float64(int(upgradePrice*100+0.5)) / 100

	if upgradePrice == 0 {
		duration := newPlan.DurationDays
		if billing == "yearly" {
			if newPlan.DurationDaysYearly > 0 { duration = newPlan.DurationDaysYearly } else { duration = 0 }
		}
		h.MySQL.RawExec("UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?", newPlan.ID, duration, uid)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
			"free": true, "message": "已升级", "plan": newPlan.Name,
		}})
		return
	}

	orderNo := generateOrderNo()
	order, err := h.MySQL.CreateUpgradeOrder(uid, newPlan, orderNo, billing, upgradePrice)
	if err != nil { log.Printf("[payment] UpgradeOrder err: %v", err); writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建订单失败"}); return }

	subject := newPlan.Name + "(" + billing + ")"
	settings, _ := h.MySQL.GetSettings()
	if !settings.AlipayEnabled || settings.AlipayAppID == "" {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "alipay": nil, "message": "支付未配置"}})
		return
	}
	qrCode, qrErr := alipayPrecreate(settings, orderNo, subject, upgradePrice)
	if qrErr != nil {
		log.Printf("[payment] upgrade precreate err: %v", qrErr)
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": nil, "alipay_app_id": "", "message": "支付服务暂不可用"}})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"order": order, "qr_code": qrCode, "alipay_app_id": settings.AlipayAppID, "original_price": originalPrice, "remaining_value": remainingValue}})
}

func (h *Handler) GetUserOrders(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok { writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"}); return }
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 { page = 1 }
	if pageSize < 1 || pageSize > 50 { pageSize = 10 }
	orders, total, err := h.MySQL.GetUserOrders(uid, page, pageSize)
	if err != nil { writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"}); return }
	if orders == nil { orders = []model.Order{} }
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": orders, "total": total}})
}

// GET /api/orders/{orderNo} — 查询订单状态（含支付宝主动查询）
func (h *Handler) GetOrderStatus(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(middleware.UserIDKey).(int64)
	orderNo := r.PathValue("orderNo")
	if orderNo == "" { writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"}); return }
	order, err := h.MySQL.GetOrderByOrderNo(orderNo)
	if err != nil || order == nil { writeJSON(w, 404, model.APIResponse{Code: 404, Message: "订单不存在"}); return }
	if order.UserID != uid { writeJSON(w, 403, model.APIResponse{Code: 403, Message: "无权访问"}); return }
	// 主动查询支付宝（异步通知的补充/备选方案）
	if order.Status == "pending" {
		settings, _ := h.MySQL.GetSettings()
		if settings.AlipayEnabled && settings.AlipayAppID != "" && settings.AlipayAppPrivateKey != "" {
			alipayStatus, tradeNo, err := alipayQuery(settings, orderNo)
			if err == nil && alipayStatus == "TRADE_SUCCESS" {
				ok, _ := h.MySQL.MarkOrderPaid(orderNo, tradeNo)
				if ok {
					if p, _ := h.MySQL.GetPlanByID(order.PlanID); p != nil {
						d := order.DurationDays
						if d <= 0 { d = p.DurationDays }
						if d > 0 {
							h.MySQL.RawExec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`, order.PlanID, d, order.UserID)
						} else {
							h.MySQL.RawExec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", order.PlanID, order.UserID)
						}
					}
					if order.CouponCode != "" {
						h.MySQL.AtomicUseCoupon(order.CouponCode, order.Amount)
					}
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
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	orders, total, err := h.MySQL.GetAllOrders(page, pageSize, status)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取订单失败"})
		return
	}
	if orders == nil {
		orders = []model.Order{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": orders, "total": total}})
}

// POST /api/orders/alipay/notify — 支付宝异步通知
func (h *Handler) AlipayNotify(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	vals, _ := url.ParseQuery(string(body))
	settings, _ := h.MySQL.GetSettings()
	if settings.AlipayPublicKey == "" { http.Error(w, "fail", 400); return }
	if !verifyAlipaySign(vals, settings.AlipayPublicKey) { log.Printf("[payment] sign verify failed"); http.Error(w, "fail", 400); return }

	// 检查是否存在重复 key（防止参数注入绕过）
	for k, v := range vals {
		if len(v) > 1 {
			log.Printf("[payment] duplicate key detected: %s", k)
			http.Error(w, "fail", 400)
			return
		}
	}

	// 验证 app_id 是否匹配
	if vals.Get("app_id") != settings.AlipayAppID {
		log.Printf("[payment] app_id mismatch: got %s, expected %s", vals.Get("app_id"), settings.AlipayAppID)
		http.Error(w, "fail", 400)
		return
	}

	if vals.Get("trade_status") == "TRADE_SUCCESS" {
		orderNo, tradeNo := vals.Get("out_trade_no"), vals.Get("trade_no")
		order, err := h.MySQL.GetOrderByOrderNo(orderNo)
		if err != nil || order == nil { http.Error(w, "fail", 400); return }
		if order.Status != "pending" { http.Error(w, "success", 200); return }

		// 验证金额是否一致
		totalAmount := vals.Get("total_amount")
		if totalAmount != "" {
			notifyAmount, parseErr := strconv.ParseFloat(totalAmount, 64)
			if parseErr != nil || notifyAmount != order.Amount {
				log.Printf("[payment] amount mismatch: notify=%s, order=%.2f", totalAmount, order.Amount)
				http.Error(w, "fail", 400)
				return
			}
		}

		if _, err := h.MySQL.MarkOrderPaid(orderNo, tradeNo); err != nil { http.Error(w, "fail", 500); return }
		if p, _ := h.MySQL.GetPlanByID(order.PlanID); p != nil {
			d := order.DurationDays; if d <= 0 { d = p.DurationDays }
			if d > 0 {
				h.MySQL.RawExec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`, order.PlanID, d, order.UserID)
			} else { h.MySQL.RawExec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", order.PlanID, order.UserID) }
		if order.CouponCode != "" {
			h.MySQL.AtomicUseCoupon(order.CouponCode, order.Amount)
		}
		}
	}
	http.Error(w, "success", 200)
}

/* ═══════════════════════════════════════════════
   Alipay API — 零外部依赖，标准库实现
   ═══════════════════════════════════════════════ */

// alipayPrecreate 调用当面付预创建接口，返回二维码字符串
func alipayPrecreate(cfg *model.Settings, orderNo, subject string, amount float64) (string, error) {
	extra := map[string]string{
		"method":      "alipay.trade.precreate",
		"biz_content": fmt.Sprintf(`{"out_trade_no":"%s","total_amount":"%.2f","subject":"%s"}`, orderNo, amount, subject),
	}
	if cfg.AlipayNotifyURL != "" {
		extra["notify_url"] = cfg.AlipayNotifyURL
	}
	return alipayCall(cfg, extra, "alipay_trade_precreate_response", "qr_code")
}

// alipayQuery 查询支付宝订单状态
func alipayQuery(cfg *model.Settings, orderNo string) (string, string, error) {
	params := map[string]string{
		"method":      "alipay.trade.query",
		"biz_content": fmt.Sprintf(`{"out_trade_no":"%s"}`, orderNo),
	}
	body, err := alipayCallRaw(cfg, params)
	if err != nil { return "", "", err }
	var resp struct {
		Response struct {
			Code        string `json:"code"`
			TradeNo     string `json:"trade_no"`
			TradeStatus string `json:"trade_status"`
		} `json:"alipay_trade_query_response"`
	}
	json.Unmarshal(body, &resp)
	if resp.Response.Code != "10000" { return "", "", fmt.Errorf("query fail: %s", resp.Response.Code) }
	return resp.Response.TradeStatus, resp.Response.TradeNo, nil
}

// alipayCall 通用支付宝 API 调用：处理签名、HTTP GET、解析单字段响应
func alipayCall(cfg *model.Settings, extra map[string]string, respKey, field string) (string, error) {
	body, err := alipayCallRaw(cfg, extra)
	if err != nil { return "", err }
	var wrapper map[string]json.RawMessage
	if err := json.Unmarshal(body, &wrapper); err != nil { return "", fmt.Errorf("parse err") }
	innerRaw, ok := wrapper[respKey]
	if !ok { return "", fmt.Errorf("missing response") }
	var inner map[string]json.RawMessage
	if err := json.Unmarshal(innerRaw, &inner); err != nil { return "", fmt.Errorf("parse inner err") }
	var code string
	var qr string
	json.Unmarshal(inner["code"], &code)
	json.Unmarshal(inner[field], &qr)
	if code != "10000" {
		var msg, subMsg string
		json.Unmarshal(inner["msg"], &msg)
		json.Unmarshal(inner["sub_msg"], &subMsg)
		return "", fmt.Errorf("alipay %s: %s %s", code, msg, subMsg)
	}
	return qr, nil
}

// alipayCallRaw 签名并调用支付宝网关，返回原始响应体
func alipayCallRaw(cfg *model.Settings, extra map[string]string) ([]byte, error) {
	params := map[string]string{
		"app_id":     cfg.AlipayAppID,
		"format":     "JSON",
		"charset":    "utf-8",
		"sign_type":  "RSA2",
		"timestamp":  time.Now().Format("2006-01-02 15:04:05"),
		"version":    "1.0",
	}
	for k, v := range extra { params[k] = v }
	sign, err := signAlipay(params, cfg.AlipayAppPrivateKey)
	if err != nil { return nil, err }
	params["sign"] = sign
	keys := make([]string, 0, len(params))
	for k := range params { keys = append(keys, k) }
	sort.Strings(keys)
	var pairs []string
	for _, k := range keys { pairs = append(pairs, fmt.Sprintf("%s=%s", k, url.QueryEscape(params[k]))) }
	resp, err := http.Get(alipayGateway + "?" + strings.Join(pairs, "&"))
	if err != nil { return nil, err }
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// signAlipay 对参数做 RSA2 (SHA256WithRSA) 签名
func signAlipay(params map[string]string, privateKey string) (string, error) {
	keys := make([]string, 0, len(params))
	for k := range params { if k != "sign" { keys = append(keys, k) } }
	sort.Strings(keys)
	var parts []string
	for _, k := range keys { parts = append(parts, k+"="+params[k]) }
	signStr := strings.Join(parts, "&")

	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		wrapped := "-----BEGIN RSA PRIVATE KEY-----\n" + privateKey + "\n-----END RSA PRIVATE KEY-----"
		block, _ = pem.Decode([]byte(wrapped))
	}
	if block == nil { return "", fmt.Errorf("invalid private key") }

	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		pk8, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil { return "", fmt.Errorf("parse key: %v", err) }
		key = pk8.(*rsa.PrivateKey)
	}

	hash := sha256.Sum256([]byte(signStr))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// verifyAlipaySign 校验支付宝异步通知的签名
func verifyAlipaySign(vals url.Values, alipayPublicKey string) bool {
	sign := vals.Get("sign")
	if sign == "" { return false }
	keys := make([]string, 0, len(vals))
	for k := range vals {
		if k != "sign" && k != "sign_type" { keys = append(keys, k) }
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys { parts = append(parts, k+"="+vals.Get(k)) }
	signStr := strings.Join(parts, "&")

	block, _ := pem.Decode([]byte(alipayPublicKey))
	if block == nil {
		wrapped := "-----BEGIN PUBLIC KEY-----\n" + alipayPublicKey + "\n-----END PUBLIC KEY-----"
		block, _ = pem.Decode([]byte(wrapped))
	}
	if block == nil { return false }
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil { return false }
	rsaPub, _ := pub.(*rsa.PublicKey)
	if rsaPub == nil { return false }
	sig, _ := base64.StdEncoding.DecodeString(sign)
	if sig == nil { return false }
	hash := sha256.Sum256([]byte(signStr))
	return rsa.VerifyPKCS1v15(rsaPub, crypto.SHA256, hash[:], sig) == nil
}
