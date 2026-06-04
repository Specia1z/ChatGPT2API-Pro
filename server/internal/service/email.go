package service

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/smtp"
	// "strings"

	"chatgpt2api-pro/internal/model"
)

// SendEmail 发送 SMTP 邮件
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
