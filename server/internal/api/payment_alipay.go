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
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

const alipayGateway = "https://openapi.alipay.com/gateway.do"

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
	if err != nil {
		return "", "", err
	}
	var resp struct {
		Response struct {
			Code        string `json:"code"`
			TradeNo     string `json:"trade_no"`
			TradeStatus string `json:"trade_status"`
		} `json:"alipay_trade_query_response"`
	}
	json.Unmarshal(body, &resp)
	if resp.Response.Code != "10000" {
		return "", "", fmt.Errorf("query fail: %s", resp.Response.Code)
	}
	return resp.Response.TradeStatus, resp.Response.TradeNo, nil
}

// alipayCall 通用支付宝 API 调用：处理签名、HTTP GET、解析单字段响应
func alipayCall(cfg *model.Settings, extra map[string]string, respKey, field string) (string, error) {
	body, err := alipayCallRaw(cfg, extra)
	if err != nil {
		return "", err
	}
	var wrapper map[string]json.RawMessage
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return "", fmt.Errorf("parse err")
	}
	innerRaw, ok := wrapper[respKey]
	if !ok {
		return "", fmt.Errorf("missing response")
	}
	var inner map[string]json.RawMessage
	if err := json.Unmarshal(innerRaw, &inner); err != nil {
		return "", fmt.Errorf("parse inner err")
	}
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
		"app_id":    cfg.AlipayAppID,
		"format":    "JSON",
		"charset":   "utf-8",
		"sign_type": "RSA2",
		"timestamp": time.Now().Format("2006-01-02 15:04:05"),
		"version":   "1.0",
	}
	for k, v := range extra {
		params[k] = v
	}
	sign, err := signAlipay(params, cfg.AlipayAppPrivateKey)
	if err != nil {
		return nil, err
	}
	params["sign"] = sign
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var pairs []string
	for _, k := range keys {
		pairs = append(pairs, fmt.Sprintf("%s=%s", k, url.QueryEscape(params[k])))
	}
	resp, err := http.Get(alipayGateway + "?" + strings.Join(pairs, "&"))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// signAlipay 对参数做 RSA2 (SHA256WithRSA) 签名
func signAlipay(params map[string]string, privateKey string) (string, error) {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k != "sign" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	signStr := strings.Join(parts, "&")

	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		wrapped := "-----BEGIN RSA PRIVATE KEY-----\n" + privateKey + "\n-----END RSA PRIVATE KEY-----"
		block, _ = pem.Decode([]byte(wrapped))
	}
	if block == nil {
		return "", fmt.Errorf("invalid private key")
	}

	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		pk8, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			return "", fmt.Errorf("parse key: %v", err)
		}
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
	if sign == "" {
		return false
	}
	keys := make([]string, 0, len(vals))
	for k := range vals {
		if k != "sign" && k != "sign_type" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+vals.Get(k))
	}
	signStr := strings.Join(parts, "&")

	block, _ := pem.Decode([]byte(alipayPublicKey))
	if block == nil {
		wrapped := "-----BEGIN PUBLIC KEY-----\n" + alipayPublicKey + "\n-----END PUBLIC KEY-----"
		block, _ = pem.Decode([]byte(wrapped))
	}
	if block == nil {
		return false
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return false
	}
	rsaPub, _ := pub.(*rsa.PublicKey)
	if rsaPub == nil {
		return false
	}
	sig, _ := base64.StdEncoding.DecodeString(sign)
	if sig == nil {
		return false
	}
	hash := sha256.Sum256([]byte(signStr))
	return rsa.VerifyPKCS1v15(rsaPub, crypto.SHA256, hash[:], sig) == nil
}
