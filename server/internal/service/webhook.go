package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"time"

	"chatgpt2api-pro/internal/store"
)

// WebhookPayload 是回调投递给开发者 URL 的 JSON 体。
// 与原生 /api/v1 查询结果的字段语义对齐，开发者收到即可直接用。
type WebhookPayload struct {
	Event     string `json:"event"`            // image.completed | image.failed
	ID        int64  `json:"id"`               // 生成任务 ID
	Status    string `json:"status"`           // completed | failed
	Prompt    string `json:"prompt"`           // 原始提示词
	Model     string `json:"model"`            // 模型标识
	Size      string `json:"size,omitempty"`   // 比例/尺寸
	ImageURL  string `json:"image_url,omitempty"` // 带签名的代理地址（completed 时）
	ErrorMsg  string `json:"error_msg,omitempty"` // 失败原因（failed 时）
	CreatedAt int64  `json:"created_at"`       // 投递时的 Unix 时间戳（秒）
}

// webhookClient 是带 SSRF 防护的 HTTP 客户端：拦截指向内网/环回/链路本地地址的请求，
// 防止用户填一个内部地址（如 http://169.254.169.254 元数据服务、http://localhost:6379）
// 把服务端当跳板探测内网。DialContext 在每次实际连接前校验解析出的 IP。
var webhookClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if IsBlockedWebhookIP(ip.IP) {
					return nil, fmt.Errorf("webhook 目标地址被拒绝（内网/环回地址）")
				}
			}
			// 用校验过的首个 IP 直连，避免 DNS rebinding（解析后到连接前被改解析）
			d := &net.Dialer{Timeout: 5 * time.Second}
			return d.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
		},
		// 禁止连接复用残留，单次投递用完即弃，降低被探测内网的面
		DisableKeepAlives: true,
	},
	// 不自动跟随重定向：防止 302 到内网地址绕过首跳的 SSRF 校验
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// IsBlockedWebhookIP 判断 IP 是否属于需拦截的私有/特殊网段（SSRF 防护）。
// 导出供 API 层保存 webhook 时对字面 IP 做前置校验。
func IsBlockedWebhookIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// 100.64.0.0/10 (CGNAT)、198.18.0.0/15 (benchmark) 等额外保留段
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
		if ip4[0] == 198 && (ip4[1] == 18 || ip4[1] == 19) {
			return true
		}
	}
	return false
}

// DeliverWebhook 异步投递一次回调（在自己的 goroutine 内带重试，不阻塞调用方）。
// 仅当用户配置了 webhook 且 enabled 时才投递。投递结果回写 DB 供前端自查。
// secret 非空时用 HMAC-SHA256 对 body 签名，放入 X-Webhook-Signature 头。
func DeliverWebhook(mysql *store.MySQLStore, userID int64, payload WebhookPayload) {
	wh, err := mysql.GetUserWebhook(userID)
	if err != nil || wh == nil || !wh.Enabled || wh.URL == "" {
		return
	}
	go func() {
		body, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[webhook uid=%d gen=%d] marshal payload: %v", userID, payload.ID, err)
			return
		}
		// 退避重试：最多 3 次（首次 + 2 重试），间隔 0/2/5 秒。
		// 2xx 即成功；4xx 视为客户端永久错误不重试；其余（5xx/网络）重试。
		delays := []time.Duration{0, 2 * time.Second, 5 * time.Second}
		var lastStatus int
		var lastErr string
		for attempt, d := range delays {
			if d > 0 {
				time.Sleep(d)
			}
			status, derr := postWebhook(webhookClient, wh.URL, wh.Secret, body, payload, attempt+1)
			lastStatus, lastErr = status, derr
			if status >= 200 && status < 300 {
				lastErr = ""
				break
			}
			if status >= 400 && status < 500 {
				// 客户端错误（如 URL 不存在/拒绝），重试无意义，提前结束
				break
			}
		}
		mysql.UpdateWebhookDeliveryResult(userID, lastStatus, lastErr)
		if lastErr != "" {
			log.Printf("[webhook uid=%d gen=%d] 投递失败 status=%d: %s", userID, payload.ID, lastStatus, lastErr)
		}
	}()
}

// postWebhook 执行单次 POST。返回 HTTP 状态码（0=网络错误）与错误描述（空=成功）。
// client 由调用方注入：生产用带 SSRF 防护的 webhookClient，测试可注入普通 client 打 httptest。
func postWebhook(client *http.Client, url, secret string, body []byte, payload WebhookPayload, attempt int) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, "构造请求失败: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "img2design-webhook/1.0")
	req.Header.Set("X-Webhook-Event", payload.Event)
	req.Header.Set("X-Webhook-ID", strconv.FormatInt(payload.ID, 10))
	req.Header.Set("X-Webhook-Attempt", strconv.Itoa(attempt))
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-Webhook-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.StatusCode, ""
	}
	return resp.StatusCode, "目标返回非 2xx 状态"
}

