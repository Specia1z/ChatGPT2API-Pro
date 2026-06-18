package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/model"
)

// creditGatewayAdapter Linux Do Credit 积分支付适配器，实现 PaymentGateway。
// 基于 EasyPay（易支付）协议：跳转支付页 + MD5 签名 + 异步回调。
// 配置存于 settings.credit_config（JSON）。
type creditGatewayAdapter struct{}

func (c *creditGatewayAdapter) Name() string { return "credit" }

func (c *creditGatewayAdapter) Enabled(cfg *model.Settings) bool {
	cc := parseCreditConfig(cfg.CreditConfig)
	if !cc.Enabled || cc.APIBase == "" {
		return false
	}
	hasLDCPay := cc.LDCClientID != "" && cc.LDCClientSecret != "" && cc.LDCPrivateKey != ""
	hasEpay := cc.PID != "" && cc.Key != ""
	return hasLDCPay || hasEpay
}

// CreatePayment 构造跳转到 credit.linux.do 支付页的 URL。
// amount 为订单人民币金额，按 credit_config.rate 换算为积分数（rate<=0 视为 1）。
func (c *creditGatewayAdapter) CreatePayment(cfg *model.Settings, orderNo, subject string, amount float64) (*PaymentResult, error) {
	cc := parseCreditConfig(cfg.CreditConfig)
	credits := amount * float64(creditRate(cc.Rate))
	notifyURL := creditNotifyURL(cfg)
	returnURL := creditReturnURL(cfg)

	// LDC Pay（Ed25519）优先
	if cc.LDCClientID != "" && cc.LDCClientSecret != "" && cc.LDCPrivateKey != "" {
		privKey, err := parseEd25519PrivateKey(cc.LDCPrivateKey)
		if err == nil {
			redirectURL := buildLDCPayRedirectURL(cc.APIBase, cc.LDCClientID, cc.LDCClientSecret, privKey, orderNo, subject, credits, notifyURL, returnURL)
			return &PaymentResult{RedirectURL: redirectURL}, nil
		}
		log.Printf("[payment] LDC Pay Ed25519 key parse failed, fallback to EasyPay: %v", err)
	}

	// EasyPay（MD5）降级
	redirectURL := buildEpayRedirectURL(cc.APIBase, cc.PID, cc.Key, orderNo, subject, "epay", credits, notifyURL, returnURL)
	return &PaymentResult{RedirectURL: redirectURL}, nil
}

// Query 主动查询订单状态。EasyPay 标准查询端点各家实现不一，且 credit 场景前端轮询兜底足够，
// 此处不实现主动查询（返回未支付），由异步通知 + 前端轮询驱动开通。
func (c *creditGatewayAdapter) Query(cfg *model.Settings, orderNo string) (bool, string, error) {
	return false, "", nil
}

// HandleCallback 处理 EasyPay 异步回调（GET notify_url）：
// MD5 验签 → 取 out_trade_no/trade_no/money/trade_status。
// money 为积分数，按 rate 还原为人民币金额返回，使通用金额校验（payment.go）能比对订单人民币金额。
func (c *creditGatewayAdapter) HandleCallback(cfg *model.Settings, r *http.Request) (*CallbackResult, error) {
	res := &CallbackResult{Ack: "success", AckFail: "fail"}
	cc := parseCreditConfig(cfg.CreditConfig)

	// 验签：优先用 EasyPay Key，回退到 LDC Client Secret（credit.linux.do 回调统一 MD5）
	signKey := cc.Key
	if signKey == "" {
		signKey = cc.LDCClientSecret
	}
	if signKey == "" {
		return res, nil
	}
	if !epayVerifySign(r.URL.Query(), signKey) {
		log.Printf("[payment] credit sign verify failed")
		return res, nil
	}
	q := r.URL.Query()
	res.Verified = true
	res.OrderNo = q.Get("out_trade_no")
	res.TradeNo = q.Get("trade_no")
	res.Paid = q.Get("trade_status") == "TRADE_SUCCESS"
	if moneyStr := q.Get("money"); moneyStr != "" {
		if credits, err := strconv.ParseFloat(moneyStr, 64); err == nil {
			rate := creditRate(cc.Rate)
			if rate > 0 {
				res.Amount = round2(credits / float64(rate))
			} else {
				res.Amount = round2(credits)
			}
		}
	}
	return res, nil
}

// parseCreditConfig 解析 settings.credit_config JSON，失败返回零值（渠道视为不可用）。
func parseCreditConfig(raw string) model.CreditConfig {
	var cc model.CreditConfig
	if raw == "" {
		return cc
	}
	json.Unmarshal([]byte(raw), &cc)
	return cc
}

// creditRate 取有效汇率：<=0 视为 1（1 元 = 1 积分）。
func creditRate(rate int) int {
	if rate <= 0 {
		return 1
	}
	return rate
}

// creditNotifyURL 异步回调地址：固定走通用回调路由，{gateway}=credit。
// 用请求 host 推断对外域名不可靠（回调由 credit 服务器发起，需公网可达），
// 因此优先用 settings.alipay_notify_url 同域推断，回退到空（依赖前端轮询）。
// 实践中：若部署在公网域名，建议在支付宝 notify_url 配置同域名，此处复用其 host。
func creditNotifyURL(cfg *model.Settings) string {
	return creditCallbackURL(cfg)
}

func creditReturnURL(cfg *model.Settings) string {
	return creditCallbackURL(cfg)
}

// creditCallbackURL 从 alipay_notify_url（若配置）派生 credit 回调地址；
// 未配置则返回空（EasyPay 会用商户后台默认回调，或仅依赖前端轮询）。
func creditCallbackURL(cfg *model.Settings) string {
	base := cfg.AlipayNotifyURL
	// alipay_notify_url 形如 https://your-domain/api/orders/alipay/notify
	// 取其 host + /api/orders/credit/notify
	if i := indexOf(base, "/api/orders/"); i >= 0 {
		return base[:i] + "/api/orders/credit/notify"
	}
	return base
}

// indexOf 字符串子串位置（找不到返回 -1），避免引入额外依赖。
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
