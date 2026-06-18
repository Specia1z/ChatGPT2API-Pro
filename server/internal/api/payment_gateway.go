package api

import (
	"net/http"

	"chatgpt2api-pro/internal/model"
)

// PaymentGateway 支付网关适配器接口。新增第三方支付（微信/Stripe 等）实现此接口即可，
// 无需改动订单/开通逻辑。第一阶段仅支付宝一个实现，配置仍读 settings.alipay_*（适配器内部封装）。
type PaymentGateway interface {
	// Name 渠道标识（alipay/wechat/stripe...），用于回调路由分发与配置匹配。
	Name() string
	// Enabled 该渠道当前是否可用（配置完整且已开启）。
	Enabled(cfg *model.Settings) bool
	// CreatePayment 为订单发起支付，返回支付凭据（二维码串/跳转 URL 等）。
	CreatePayment(cfg *model.Settings, orderNo, subject string, amount float64) (*PaymentResult, error)
	// Query 主动查询订单支付状态（异步通知的补充/备选）。
	// 返回 paid=true 表示已支付成功，tradeNo 为渠道交易号。
	Query(cfg *model.Settings, orderNo string) (paid bool, tradeNo string, err error)
	// HandleCallback 处理渠道异步通知：验签 + 防重放 + 金额校验，
	// 返回解析出的回调结果。ack 为应答给渠道的内容（如支付宝的 "success"）。
	HandleCallback(cfg *model.Settings, r *http.Request) (*CallbackResult, error)
}

// PaymentResult 发起支付的结果（不同渠道凭据形态不同，用通用字段承载）。
type PaymentResult struct {
	QRCode      string         `json:"qr_code,omitempty"`      // 二维码内容（当面付/扫码）
	RedirectURL string         `json:"redirect_url,omitempty"` // 跳转支付 URL
	Extra       map[string]any `json:"extra,omitempty"`
}

// CallbackResult 异步通知解析结果。
type CallbackResult struct {
	Verified bool    // 验签是否通过
	Paid     bool    // 是否支付成功（trade_status 等）
	OrderNo  string  // 商户订单号
	TradeNo  string  // 渠道交易号
	Amount   float64 // 通知金额（用于与订单金额比对；<=0 表示渠道未提供）
	Ack      string  // 应答渠道的响应体（成功时）
	AckFail  string  // 应答渠道的失败响应体
}

// gateways 已注册的支付网关，按 Name() 索引。第一阶段在 NewRouter 时注册 alipay。
var gateways = map[string]PaymentGateway{}

// registerGateway 注册一个支付网关适配器。
func registerGateway(g PaymentGateway) { gateways[g.Name()] = g }

// getGateway 取指定渠道适配器，不存在返回 nil。
func getGateway(name string) PaymentGateway { return gateways[name] }

// firstEnabledGateway 返回首个可用的支付网关（下单时选默认渠道用）。
// 优先级：支付宝 > Linux Do 积分支付。
func firstEnabledGateway(cfg *model.Settings) PaymentGateway {
	if g := gateways["alipay"]; g != nil && g.Enabled(cfg) {
		return g
	}
	if g := gateways["credit"]; g != nil && g.Enabled(cfg) {
		return g
	}
	return nil
}

// selectGateway 按名称选择指定渠道（必须可用）；空名称或不可用时回退 firstEnabledGateway。
func selectGateway(cfg *model.Settings, name string) PaymentGateway {
	if name != "" {
		if g := gateways[name]; g != nil && g.Enabled(cfg) {
			return g
		}
	}
	return firstEnabledGateway(cfg)
}
