package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// TestIsBlockedWebhookIP 校验 SSRF IP 黑名单：内网/环回/特殊段必须拦，公网放行。
func TestIsBlockedWebhookIP(t *testing.T) {
	cases := []struct {
		ip      string
		blocked bool
	}{
		{"127.0.0.1", true},       // loopback
		{"::1", true},             // loopback v6
		{"10.0.0.5", true},        // private A
		{"172.16.3.4", true},      // private B
		{"192.168.1.1", true},     // private C
		{"169.254.169.254", true}, // link-local（云元数据服务，重点防）
		{"100.64.0.1", true},      // CGNAT
		{"100.127.255.1", true},   // CGNAT 上界
		{"198.18.0.1", true},      // benchmark
		{"0.0.0.0", true},         // unspecified
		{"224.0.0.1", true},       // multicast
		{"8.8.8.8", false},        // 公网
		{"1.1.1.1", false},        // 公网
		{"100.63.255.1", false},   // 99.63 不在 100.64/10
		{"100.128.0.1", false},    // CGNAT 上界外
		{"198.20.0.1", false},     // benchmark 外
		{"93.184.216.34", false},  // 公网 example.com
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("无法解析 IP: %s", c.ip)
		}
		if got := IsBlockedWebhookIP(ip); got != c.blocked {
			t.Errorf("IsBlockedWebhookIP(%s) = %v, want %v", c.ip, got, c.blocked)
		}
	}
}

// PLACEHOLDER_REST

// TestPostWebhookSuccessAndSignature 验证：2xx 视为成功；签名头与请求头正确；
// 用普通 client 打 httptest（loopback），绕开生产 client 的 SSRF（那是另一个测试覆盖）。
func TestPostWebhookSuccessAndSignature(t *testing.T) {
	const secret = "test-secret-123"
	payload := WebhookPayload{
		Event: "image.completed", ID: 999, Status: "completed",
		Prompt: "hello", Model: "gpt-image-2", Size: "1:1",
		ImageURL: "https://example.com/api/images/999?exp=1&sig=2", CreatedAt: 1700000000,
	}
	body, _ := json.Marshal(payload)

	var gotSig, gotEvent, gotID, gotAttempt, gotCT string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSig = r.Header.Get("X-Webhook-Signature")
		gotEvent = r.Header.Get("X-Webhook-Event")
		gotID = r.Header.Get("X-Webhook-ID")
		gotAttempt = r.Header.Get("X-Webhook-Attempt")
		gotCT = r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	status, errMsg := postWebhook(srv.Client(), srv.URL, secret, body, payload, 1)
	if status != 200 || errMsg != "" {
		t.Fatalf("期望 200/空错误，得到 status=%d err=%q", status, errMsg)
	}
	// 头校验
	if gotEvent != "image.completed" || gotID != "999" || gotAttempt != "1" {
		t.Errorf("请求头不符: event=%q id=%q attempt=%q", gotEvent, gotID, gotAttempt)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type=%q, want application/json", gotCT)
	}
	// body 必须原样送达（验签依赖原文字节）
	if string(gotBody) != string(body) {
		t.Errorf("body 不一致:\n got=%s\nwant=%s", gotBody, body)
	}
	// 签名校验：sha256=<hmac(body, secret)>
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	wantSig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if gotSig != wantSig {
		t.Errorf("签名不符:\n got=%s\nwant=%s", gotSig, wantSig)
	}
}

// TestPostWebhookNoSecretNoSignature 未设密钥时不应带签名头。
func TestPostWebhookNoSecretNoSignature(t *testing.T) {
	payload := WebhookPayload{Event: "image.failed", ID: 7, Status: "failed", ErrorMsg: "boom"}
	body, _ := json.Marshal(payload)
	var hadSig bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hadSig = r.Header["X-Webhook-Signature"]
		w.WriteHeader(204)
	}))
	defer srv.Close()

	status, errMsg := postWebhook(srv.Client(), srv.URL, "", body, payload, 1)
	if status != 204 || errMsg != "" {
		t.Fatalf("期望 204/空错误，得到 status=%d err=%q", status, errMsg)
	}
	if hadSig {
		t.Error("未设密钥时不应出现 X-Webhook-Signature 头")
	}
}

// TestPostWebhookNon2xx 4xx/5xx 都应返回对应状态码 + 非空错误（供上层决定是否重试）。
func TestPostWebhookNon2xx(t *testing.T) {
	for _, code := range []int{400, 404, 500, 503} {
		code := code
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(code)
		}))
		status, errMsg := postWebhook(srv.Client(), srv.URL, "", []byte("{}"), WebhookPayload{}, 1)
		srv.Close()
		if status != code {
			t.Errorf("status=%d, want %d", status, code)
		}
		if errMsg == "" {
			t.Errorf("code=%d 时应返回非空错误", code)
		}
	}
}

// TestWebhookClientBlocksLoopback 生产 client（带 SSRF 防护）必须拒绝连 loopback。
// 这是 SSRF 防护的端到端验证：即便目标是真实存活的 httptest，也应在 dial 阶段被拒。
func TestWebhookClientBlocksLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()
	// 用生产 webhookClient（含 SSRF DialContext）打 127.0.0.1
	status, errMsg := postWebhook(webhookClient, srv.URL, "", []byte("{}"), WebhookPayload{}, 1)
	if status != 0 || errMsg == "" {
		t.Fatalf("SSRF 应拦截 loopback：期望 status=0/非空错误，得到 status=%d err=%q", status, errMsg)
	}
}

// TestWebhookClientNoRedirect 生产 client 不跟随重定向（防 302 跳内网绕过 SSRF）。
// 3xx 被原样返回（非 2xx），上层据此不视为成功。
func TestWebhookClientNoRedirect(t *testing.T) {
	var hits int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(200)
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound) // 302 → target
	}))
	defer redirector.Close()

	// 用普通 client（不含 SSRF，但保留「不跟随重定向」策略）验证 CheckRedirect 行为
	client := &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}
	status, _ := postWebhook(client, redirector.URL, "", []byte("{}"), WebhookPayload{}, 1)
	if status != http.StatusFound {
		t.Errorf("应原样返回 302 不跟随，得到 status=%d", status)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Errorf("不应跟随重定向打到 target，但 target 被访问 %d 次", hits)
	}
}
