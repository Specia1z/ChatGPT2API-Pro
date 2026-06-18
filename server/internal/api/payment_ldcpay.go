package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// ldcPaySign 生成 LDC Pay Ed25519 签名。
// 规则：取除 sign 外的所有非空参数 → ASCII 字典序拼 k1=v1&k2=v2... → 末尾追加 clientSecret → Ed25519 签名 → Base64。
func ldcPaySign(params map[string]string, clientSecret string, privKey ed25519.PrivateKey) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if v == "" || k == "sign" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(params[k])
	}
	b.WriteString(clientSecret)
	sig := ed25519.Sign(privKey, []byte(b.String()))
	return base64.StdEncoding.EncodeToString(sig)
}

// ldcPayVerifySign 校验 LDC Pay 回调的 Ed25519 签名（用 credit.linux.do 平台公钥验签）。
// 目前 credit.linux.do 回调同样支持 MD5 验签，此函数为 LDC Pay 协议完整性预留。
func ldcPayVerifySign(vals url.Values, clientSecret string, pubKey ed25519.PublicKey) bool {
	sign := vals.Get("sign")
	if sign == "" || len(pubKey) == 0 {
		return false
	}
	params := map[string]string{}
	for k := range vals {
		if k == "sign" {
			continue
		}
		v := vals.Get(k)
		if v != "" {
			params[k] = v
		}
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(params[k])
	}
	b.WriteString(clientSecret)
	sigBytes, err := base64.StdEncoding.DecodeString(sign)
	if err != nil {
		return false
	}
	return ed25519.Verify(pubKey, []byte(b.String()), sigBytes)
}

// buildLDCPayRedirectURL 构造 LDC Pay 支付跳转 URL（POST 表单提交模拟用 GET 跳转方式，
// credit.linux.do 也支持 GET query 方式提交）。
func buildLDCPayRedirectURL(apiBase, clientID, clientSecret string, privKey ed25519.PrivateKey, orderNo, subject string, amount float64, notifyURL, returnURL string) string {
	params := map[string]string{
		"client_id":    clientID,
		"type":         "ldcpay",
		"out_trade_no": orderNo,
		"money":        fmt.Sprintf("%.2f", amount),
		"order_name":   subject,
	}
	if notifyURL != "" {
		params["notify_url"] = notifyURL
	}
	if returnURL != "" {
		params["return_url"] = returnURL
	}
	params["sign"] = ldcPaySign(params, clientSecret, privKey)

	var b strings.Builder
	b.WriteString(strings.TrimRight(apiBase, "/"))
	b.WriteString("/pay/submit.php?")
	first := true
	for _, k := range sortedKeys(params) {
		if !first {
			b.WriteByte('&')
		}
		first = false
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(url.QueryEscape(params[k]))
	}
	return b.String()
}

// parseEd25519PrivateKey 解析 Ed25519 私钥（支持 Base64 seed 32字节 或 Hex seed 64字符）。
func parseEd25519PrivateKey(raw string) (ed25519.PrivateKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty key")
	}
	// Base64 seed (32 bytes → 44 chars base64)
	if seed, err := base64.StdEncoding.DecodeString(raw); err == nil && len(seed) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(seed), nil
	}
	// Base64 full key (64 bytes → 88 chars base64)
	if full, err := base64.StdEncoding.DecodeString(raw); err == nil && len(full) == ed25519.PrivateKeySize {
		return ed25519.PrivateKey(full), nil
	}
	// Hex seed (64 hex chars = 32 bytes)
	if len(raw) == 64 {
		if seed, err := hex.DecodeString(raw); err == nil && len(seed) == ed25519.SeedSize {
			return ed25519.NewKeyFromSeed(seed), nil
		}
	}
	// Hex full key (128 hex chars = 64 bytes)
	if len(raw) == 128 {
		if full, err := hex.DecodeString(raw); err == nil && len(full) == ed25519.PrivateKeySize {
			return ed25519.PrivateKey(full), nil
		}
	}
	return nil, fmt.Errorf("unsupported key format (expect Base64 or Hex, 32-byte seed or 64-byte full key)")
}
