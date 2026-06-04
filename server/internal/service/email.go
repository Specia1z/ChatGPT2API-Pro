package service

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/smtp"
	// "strings"

	"chatgpt2api-pro/internal/model"
)

// SendVerificationEmail 发送 HTML 验证码邮件（shadcn 风格）
func SendVerificationEmail(cfg *model.EmailConfig, to, code, siteTitle string) error {
	if !cfg.SMTPEnabled || cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP 未配置")
	}
	port := cfg.SMTPPort
	if port == 0 { port = 587 }

	if siteTitle == "" { siteTitle = "ChatGPT2API Pro" }

	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="400" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
<tr><td style="padding:32px 32px 24px">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="font-size:18px;font-weight:600;color:#1a1a18;letter-spacing:-0.02em;padding-bottom:8px">%s</td></tr>
<tr><td align="center" style="font-size:13px;color:#6b6a66;padding-bottom:24px">请使用以下验证码完成邮箱验证</td></tr>
<tr><td align="center" style="padding:0 0 24px">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="background:#f0efe8;border-radius:12px;padding:16px 40px;letter-spacing:8px;font-size:32px;font-weight:700;color:#1a1a18;font-family:ui-monospace,SFMono-Regular,monospace">%s</td></tr>
</table>
</td></tr>
<tr><td align="center" style="font-size:12px;color:#9e9d98;padding-bottom:8px">验证码 10 分钟内有效，请勿泄露给他人</td></tr>
<tr><td align="center" style="font-size:12px;color:#9e9d98">如果您没有请求此验证码，请忽略此邮件</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:16px 32px 0;font-size:11px;color:#9e9d98">此邮件由系统自动发送，请勿回复</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`, siteTitle, code)

	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n", cfg.SMTPFrom, to, fmt.Sprintf("[%s] 邮箱验证", siteTitle))

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, port)
	auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)

	return smtp.SendMail(addr, auth, cfg.SMTPFrom, []string{to}, []byte(headers+html))
}

// SendEmail 发送 SMTP 邮件（纯文本）
func SendEmail(cfg *model.EmailConfig, to, subject, body string) error {
	if !cfg.SMTPEnabled || cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP 未配置")
	}
	port := cfg.SMTPPort
	if port == 0 { port = 587 }

	auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)
	from := cfg.SMTPFrom
	if from == "" { from = cfg.SMTPUser }

	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n", from, to, subject)
	msg := []byte(headers + body)
	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, port)

	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

// RandomCode 生成 N 位数字验证码
func RandomCode(length int) string {
	const chars = "0123456789"
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}
