package api

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"

	"chatgpt2api-pro/internal/model"
)

// alipayGateway 支付宝适配器，实现 PaymentGateway。
// 复用 payment_alipay.go 的标准库实现（precreate/query/verify）。
// 第一阶段配置仍读 settings.alipay_*；第二阶段迁移到 payment_gateways 表后改这里即可。
type alipayGatewayAdapter struct{}

func (a *alipayGatewayAdapter) Name() string { return "alipay" }

func (a *alipayGatewayAdapter) Enabled(cfg *model.Settings) bool {
	return cfg != nil && cfg.AlipayEnabled && cfg.AlipayAppID != ""
}

func (a *alipayGatewayAdapter) CreatePayment(cfg *model.Settings, orderNo, subject string, amount float64) (*PaymentResult, error) {
	qr, err := alipayPrecreate(cfg, orderNo, subject, amount)
	if err != nil {
		return nil, err
	}
	return &PaymentResult{QRCode: qr}, nil
}

func (a *alipayGatewayAdapter) Query(cfg *model.Settings, orderNo string) (bool, string, error) {
	if cfg.AlipayAppPrivateKey == "" {
		return false, "", nil
	}
	status, tradeNo, err := alipayQuery(cfg, orderNo)
	if err != nil {
		return false, "", err
	}
	return status == "TRADE_SUCCESS", tradeNo, nil
}

func (a *alipayGatewayAdapter) HandleCallback(cfg *model.Settings, r *http.Request) (*CallbackResult, error) {
	res := &CallbackResult{Ack: "success", AckFail: "fail"}
	body, _ := io.ReadAll(r.Body)
	vals, _ := url.ParseQuery(string(body))

	if cfg.AlipayPublicKey == "" || !verifyAlipaySign(vals, cfg.AlipayPublicKey) {
		log.Printf("[payment] alipay sign verify failed")
		return res, nil // Verified=false
	}
	// 防参数注入：拒绝重复 key
	for k, v := range vals {
		if len(v) > 1 {
			log.Printf("[payment] alipay duplicate key: %s", k)
			return res, nil
		}
	}
	// app_id 必须匹配
	if vals.Get("app_id") != cfg.AlipayAppID {
		log.Printf("[payment] alipay app_id mismatch: got %s", vals.Get("app_id"))
		return res, nil
	}
	res.Verified = true
	res.OrderNo = vals.Get("out_trade_no")
	res.TradeNo = vals.Get("trade_no")
	res.Paid = vals.Get("trade_status") == "TRADE_SUCCESS"
	if ta := vals.Get("total_amount"); ta != "" {
		if amt, err := strconv.ParseFloat(ta, 64); err == nil {
			res.Amount = amt
		}
	}
	return res, nil
}
