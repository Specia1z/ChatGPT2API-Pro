package service

import (
	"crypto/rand"
	"crypto/tls"
	"fmt"
	"math/big"
	"net/smtp"

	"chatgpt2api-pro/internal/model"
)

// SendVerificationEmail 发送 HTML 验证码邮件（shadcn 风格）
func SendVerificationEmail(cfg *model.EmailConfig, to, code, siteTitle string) error {
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

	subject := fmt.Sprintf("[%s] 邮箱验证", siteTitle)
	return sendMail(cfg, to, subject, html, "text/html")
}

// SendEmail 发送 SMTP 邮件（纯文本）
func SendEmail(cfg *model.EmailConfig, to, subject, body string) error {
	return sendMail(cfg, to, subject, body, "text/plain")
}

// sendMail 统一的 SMTP 发送逻辑，支持 465（隐式 TLS）与 587/25（STARTTLS）。
func sendMail(cfg *model.EmailConfig, to, subject, body, contentType string) error {
	if !cfg.SMTPEnabled || cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP 未配置")
	}
	port := cfg.SMTPPort
	if port == 0 { port = 587 }

	from := cfg.SMTPFrom
	if from == "" { from = cfg.SMTPUser }

	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: %s; charset=UTF-8\r\n\r\n",
		from, to, subject, contentType)
	msg := []byte(headers + body)
	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, port)

	var auth smtp.Auth
	if cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)
	}

	// 465 端口使用隐式 TLS（SMTPS）：先建立 TLS 连接再走 SMTP。
	// net/smtp 的 SendMail 仅支持明文/STARTTLS，无法处理 465。
	if port == 465 {
		return sendMailTLS(addr, cfg.SMTPHost, auth, from, to, msg)
	}

	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

// sendMailTLS 通过隐式 TLS 连接发送邮件（用于 465 端口）。
func sendMailTLS(addr, host string, auth smtp.Auth, from, to string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return fmt.Errorf("TLS 连接失败: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("SMTP 握手失败: %w", err)
	}
	defer client.Close()

	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("SMTP 认证失败: %w", err)
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	wc, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write(msg); err != nil {
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return client.Quit()
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
