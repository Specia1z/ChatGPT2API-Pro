package api

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

/* ═══════════════════════════════════════════════
   EasyPay（易支付）协议实现 —— 纯标准库，零依赖
   credit.linux.do 采用此协议：跳转支付页 + MD5 签名 + 异步回调
   ═══════════════════════════════════════════════ */

// epaySign 生成 EasyPay 签名：参与字段按 ASCII 升序拼成 a=b&c=d，
// 末尾直接拼商户密钥 key，做 MD5（32 位小写）。
// 注意：空值参数不参与签名（与易支付标准一致）。
func epaySign(params map[string]string, key string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if v == "" || k == "sign" || k == "sign_type" {
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
	b.WriteString(key) // 末尾拼 key（不加 &）
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// epayVerifySign 校验异步回调签名：从 url.Values 取除 sign/sign_type 外的非空字段，
// 按同规则签名比对。空 sign 或不匹配返回 false。
func epayVerifySign(vals url.Values, key string) bool {
	sign := vals.Get("sign")
	if sign == "" {
		return false
	}
	params := map[string]string{}
	for k := range vals {
		if k == "sign" || k == "sign_type" {
			continue
		}
		v := vals.Get(k)
		if v != "" {
			params[k] = v
		}
	}
	return epaySign(params, key) == sign
}

// buildEpayRedirectURL 构造跳转到易支付支付页的完整 URL（submit.php 页面跳转模式）。
// apiBase 为网关根地址（如 https://credit.linux.do），amount 单位与配置一致（积分则传积分数）。
// notifyURL 为服务器异步回调地址，returnURL 为支付完成后浏览器跳转地址。
func buildEpayRedirectURL(apiBase, pid, key, orderNo, subject, payType string, amount float64, notifyURL, returnURL string) string {
	params := map[string]string{
		"pid":          pid,
		"type":         payType, // alipay/wxpay/qqpay 等；credit 场景一般不指定或填 credit
		"out_trade_no": orderNo,
		"notify_url":   notifyURL,
		"return_url":   returnURL,
		"name":         subject,
		"money":        fmt.Sprintf("%.2f", amount),
	}
	params["sign"] = epaySign(params, key)
	params["sign_type"] = "MD5"

	// 拼成 submit.php?k=v&...（值需 URL 编码）
	var b strings.Builder
	b.WriteString(strings.TrimRight(apiBase, "/"))
	b.WriteString("/submit.php?")
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

// sortedKeys 返回 map 的 key 升序切片（输出 URL 时让参数顺序稳定，便于调试）。
func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
