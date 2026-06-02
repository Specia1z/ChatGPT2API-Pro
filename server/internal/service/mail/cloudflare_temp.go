package mail

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"chatgpt2api-pro/internal/model"
)

// CloudflareTempProvider Cloudflare 临时邮箱提供商（对标 Python CloudflareTempMailProvider）
type CloudflareTempProvider struct {
	apiBase       string
	adminPassword string
	domains       []string
	client        *http.Client
	timeout       time.Duration
	waitTimeout   time.Duration
	userAgent     string
}

func NewCloudflareTempProvider(entry model.MailProviderConfig, cfg model.MailConfig) *CloudflareTempProvider {
	transport := &http.Transport{
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if cfg.Proxy != "" {
		if proxyURL, err := url.Parse(cfg.Proxy); err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}
	return &CloudflareTempProvider{
		apiBase:       strings.TrimRight(entry.APIBase, "/"),
		adminPassword: entry.AdminPassword,
		domains:       entry.Domain,
		client: &http.Client{
			Transport: transport,
			Timeout:   time.Duration(cfg.RequestTimeout) * time.Second,
		},
		timeout:     time.Duration(cfg.RequestTimeout) * time.Second,
		waitTimeout: time.Duration(cfg.WaitTimeout) * time.Second,
		userAgent:   cfg.UserAgent,
	}
}

func (p *CloudflareTempProvider) Name() string {
	return "cloudflare_temp_email"
}

func (p *CloudflareTempProvider) CreateMailbox(username string) (*model.Mailbox, error) {
	if username == "" {
		username = randomMailboxName()
	}

	domain := p.nextDomain()
	if domain == "" {
		return nil, fmt.Errorf("cloudflare_temp_email: 未配置 domain")
	}

	payload := map[string]any{
		"enablePrefix": true,
		"name":         username,
		"domain":       domain,
	}

	body, err := p.request("POST", "/admin/new_address", map[string]string{
		"x-admin-auth": p.adminPassword,
	}, payload)
	if err != nil {
		return nil, err
	}

	var data struct {
		Address string `json:"address"`
		JWT     string `json:"jwt"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("cloudflare_temp_email: 解析响应失败: %w", err)
	}
	if data.Address == "" || data.JWT == "" {
		return nil, fmt.Errorf("cloudflare_temp_email: 缺少 address 或 jwt, body=%s", string(body))
	}

	return &model.Mailbox{
		Provider:    p.Name(),
		ProviderRef: "",
		Address:     data.Address,
		Token:       data.JWT,
	}, nil
}

func (p *CloudflareTempProvider) FetchLatestMessage(mailbox *model.Mailbox) (*model.MailMessage, error) {
	body, err := p.request("GET", "/api/mails?limit=10&offset=0", map[string]string{
		"Authorization": "Bearer " + mailbox.Token,
	}, nil)
	if err != nil {
		return nil, err
	}

	var data struct {
		Results []map[string]any `json:"results"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		// 尝试直接解析为数组
		var rawList []map[string]any
		if err2 := json.Unmarshal(body, &rawList); err2 != nil {
			return nil, fmt.Errorf("cloudflare_temp_email: 解析邮件列表失败: %w", err)
		}
		data.Results = rawList
	}

	if len(data.Results) == 0 {
		return nil, nil
	}

	for _, item := range data.Results {
		msg := p.parseMessage(item, mailbox.Address)
		if msg != nil {
			return msg, nil
		}
	}
	return nil, nil
}

func (p *CloudflareTempProvider) WaitForCode(mailbox *model.Mailbox) (string, error) {
	waitDuration := p.waitTimeout
	if waitDuration <= 0 {
		waitDuration = 120 * time.Second
	}
	deadline := time.Now().Add(waitDuration)
	waitInterval := 1 * time.Second

	// 首轮立即查一次（不先 sleep）——验证码可能在进入本函数前已到达
	for {
		msg, err := p.FetchLatestMessage(mailbox)
		if err != nil {
			return "", err
		}
		if msg != nil {
			code := extractCode(msg)
			if code != "" {
				return code, nil
			}
		}
		if !time.Now().Before(deadline) {
			break
		}
		time.Sleep(waitInterval)
	}
	return "", fmt.Errorf("cloudflare_temp_email: 等待验证码超时")
}

func (p *CloudflareTempProvider) Close() {
	p.client.CloseIdleConnections()
}

// --- private helpers ---

func (p *CloudflareTempProvider) request(method, path string, headers map[string]string, payload map[string]any) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		data, _ := json.Marshal(payload)
		body = strings.NewReader(string(data))
	}

	req, err := http.NewRequest(method, p.apiBase+path, body)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", p.userAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudflare_temp_email: 请求失败 %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return nil, fmt.Errorf("cloudflare_temp_email: HTTP %d %s %s, body=%s", resp.StatusCode, method, path, string(respBody[:min(300, len(respBody))]))
	}

	return respBody, nil
}

var (
	domainIdx   int
	domainIdxMu sync.Mutex
)

func (p *CloudflareTempProvider) nextDomain() string {
	if len(p.domains) == 0 {
		return ""
	}
	if len(p.domains) == 1 {
		return p.domains[0]
	}
	domainIdxMu.Lock()
	d := p.domains[domainIdx%len(p.domains)]
	domainIdx = (domainIdx + 1) % len(p.domains)
	domainIdxMu.Unlock()
	return d
}

func (p *CloudflareTempProvider) parseMessage(item map[string]any, mailboxAddr string) *model.MailMessage {
	addr := strings.ToLower(strings.TrimSpace(mailboxAddr))

	// 检查收件人是否匹配
	to := extractTo(item, addr)
	if to != "" && !strings.Contains(to, addr) {
		return nil
	}

	textContent, htmlContent := extractContent(item)

	sender := ""
	if from, ok := item["from"]; ok {
		switch v := from.(type) {
		case string:
			sender = v
		case map[string]any:
			sender = stringVal(v, "address")
			if sender == "" {
				sender = stringVal(v, "name")
			}
		}
	}

	msgID := stringVal(item, "id")
	if msgID == "" {
		msgID = stringVal(item, "_id")
	}

	receivedAt := ""
	if ts, ok := item["createdAt"]; ok {
		receivedAt = fmt.Sprintf("%v", ts)
	}

	return &model.MailMessage{
		Provider:    "cloudflare_temp_email",
		Mailbox:     mailboxAddr,
		MessageID:   msgID,
		Subject:     stringVal(item, "subject"),
		Sender:      sender,
		TextContent: textContent,
		HTMLContent: htmlContent,
		ReceivedAt:  receivedAt,
	}
}

// extractCode 从邮件中提取 6 位验证码（对标 Python _extract_code）
func extractCode(msg *model.MailMessage) string {
	content := msg.Subject + "\n" + msg.TextContent + "\n" + msg.HTMLContent
	if content == "\n\n" {
		return ""
	}

	// 匹配 HTML 背景色 + 6 位数字
	re := regexp.MustCompile(`background-color:\s*#F3F3F3[^>]*>[\s\S]*?(\d{6})[\s\S]*?</p>`)
	if match := re.FindStringSubmatch(content); match != nil {
		if match[1] != "177010" {
			return match[1]
		}
	}

	// 匹配 "Verification code" / "验证码" 关键词后的 6 位数字
	re2 := regexp.MustCompile(`(?i)(?:verification code|code is|代码为|验证码)[:\s]*(\d{6})`)
	if match := re2.FindStringSubmatch(content); match != nil {
		if match[1] != "177010" {
			return match[1]
		}
	}

	// 匹配所有独立的 6 位数字
	re3 := regexp.MustCompile(`>\s*(\d{6})\s*<|(?<![#&])\b(\d{6})\b`)
	for _, match := range re3.FindAllStringSubmatch(content, -1) {
		code := match[1]
		if code == "" {
			code = match[2]
		}
		if code != "" && code != "177010" {
			return code
		}
	}

	return ""
}

func extractContent(item map[string]any) (string, string) {
	text := stringVal(item, "text_content")
	if text == "" {
		text = stringVal(item, "text")
	}
	if text == "" {
		text = stringVal(item, "body")
	}
	if text == "" {
		text = stringVal(item, "content")
	}

	html := stringVal(item, "html_content")
	if html == "" {
		html = stringVal(item, "html")
	}
	if html == "" {
		html = stringVal(item, "body_html")
	}
	if html == "" {
		html = stringVal(item, "html_body")
	}

	// fallback: 检查 raw 字段（CF API 可能把完整邮件放在 raw 里）
	if text == "" && html == "" {
		if raw, ok := item["raw"]; ok {
			switch v := raw.(type) {
			case string:
				text = v
			default:
				if rawBytes, _ := json.Marshal(v); rawBytes != nil {
					text = string(rawBytes)
				}
			}
		}
	}

	return text, html
}

func extractTo(item map[string]any, targetAddr string) string {
	for _, key := range []string{"to", "mailTo", "receiver", "receivers", "address", "email", "envelope_to"} {
		if val := item[key]; val != nil {
			switch v := val.(type) {
			case string:
				if v != "" {
					return strings.ToLower(v)
				}
			case map[string]any:
				if s := stringVal(v, "address"); s != "" {
					return strings.ToLower(s)
				}
			}
		}
	}
	return ""
}

func stringVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func randomMailboxName() string {
	letters := "abcdefghijklmnopqrstuvwxyz"
	digits := "0123456789"
	b := make([]byte, 5+1+3) // 5 letters + 1 digit + up to 3 letters
	for i := 0; i < 5; i++ {
		b[i] = letters[rand.Intn(len(letters))]
	}
	b[5] = digits[rand.Intn(len(digits))]
	n := 1 + rand.Intn(3)
	for i := 0; i < n; i++ {
		b[6+i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
