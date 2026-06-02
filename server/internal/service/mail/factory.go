package mail

import (
	"fmt"

	"chatgpt2api-pro/internal/model"
)

// Factory 根据配置创建邮箱提供商
func Factory(entry model.MailProviderConfig, cfg model.MailConfig) (Provider, error) {
	switch entry.Provider {
	case "cloudflare_temp_email", "cloudflare_temp":
		return NewCloudflareTempProvider(entry, cfg), nil

	// 后续扩展其他 provider:
	// case "ddg_mail":
	// case "cloudmail_gen":
	// case "tempmail_lol":
	// case "duckmail":

	default:
		return nil, fmt.Errorf("未知的邮箱提供商: %s", entry.Provider)
	}
}

// CreateMailbox 从配置列表中选择一个可用 provider 创建邮箱（对标 Python create_mailbox）
func CreateMailbox(cfg model.MailConfig) (*model.Mailbox, error) {
	providers := cfg.Providers
	if len(providers) == 0 {
		return nil, fmt.Errorf("未配置邮箱提供商")
	}

	var lastErr error
	for _, entry := range providers {
		p, err := Factory(entry, cfg)
		if err != nil {
			lastErr = err
			continue
		}
		mailbox, err := p.CreateMailbox("")
		p.Close()
		if err != nil {
			lastErr = err
			continue
		}
		return mailbox, nil
	}
	return nil, fmt.Errorf("所有邮箱提供商均无法创建邮箱: %v", lastErr)
}

// WaitForCode 从邮箱等待验证码（对标 Python wait_for_code）
func WaitForCode(cfg model.MailConfig, mailbox *model.Mailbox) (string, error) {
	entry := findProviderEntry(cfg, mailbox.Provider, mailbox.ProviderRef)
	if entry == nil {
		return "", fmt.Errorf("未找到邮箱提供商配置: %s", mailbox.Provider)
	}

	p, err := Factory(*entry, cfg)
	if err != nil {
		return "", err
	}
	defer p.Close()

	return p.WaitForCode(mailbox)
}

func findProviderEntry(cfg model.MailConfig, providerName, providerRef string) *model.MailProviderConfig {
	for _, entry := range cfg.Providers {
		if entry.Provider == providerName && entry.ProviderRef == providerRef {
			return &entry
		}
	}
	// fallback: 只匹配 provider name
	for _, entry := range cfg.Providers {
		if entry.Provider == providerName {
			return &entry
		}
	}
	return nil
}
