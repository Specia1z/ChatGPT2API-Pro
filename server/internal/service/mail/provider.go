package mail

import "chatgpt2api-pro/internal/model"

// Provider 邮箱提供商接口（对标 Python BaseMailProvider）
type Provider interface {
	// Name 返回提供商名称
	Name() string

	// CreateMailbox 创建临时邮箱
	CreateMailbox(username string) (*model.Mailbox, error)

	// FetchLatestMessage 获取最新邮件
	FetchLatestMessage(mailbox *model.Mailbox) (*model.MailMessage, error)

	// WaitForCode 等待验证码
	WaitForCode(mailbox *model.Mailbox) (string, error)

	// Close 清理资源
	Close()
}
