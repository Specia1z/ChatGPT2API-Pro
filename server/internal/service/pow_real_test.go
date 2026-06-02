package service

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// TestRealPoWAgainstOpenAI 真实端到端验证：
// 用真实 access token → 打 OpenAI sentinel/chat-requirements 拿真实 seed/difficulty
// → 用优化版 solveProofOfWork 求解 → 提交 conversation/prepare 看是否被接受。
// 需要：代理可用 + 环境 ATTOK（token）+ ATPROXY（代理）。无则 skip。
func TestRealPoWAgainstOpenAI(t *testing.T) {
	tokBytes, err := os.ReadFile(os.Getenv("ATTOK_FILE"))
	if err != nil {
		t.Skip("无 ATTOK_FILE 环境变量指向的 token 文件，跳过真实测试")
	}
	accessToken := strings.TrimSpace(string(tokBytes))
	if len(accessToken) < 900 {
		t.Skipf("token 长度 %d 不完整，跳过", len(accessToken))
	}
	proxy := os.Getenv("ATPROXY")
	if proxy == "" {
		proxy = "http://127.0.0.1:10808"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	// Step 1: bootstrap
	if br, e := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil); e == nil {
		br.Header.Set("User-Agent", ua)
		if rs, e2 := client.Do(br); e2 == nil {
			rs.Body.Close()
		}
	}

	// Step 2: chat-requirements → 拿真实 seed/difficulty
	legacyToken := buildLegacyToken(ua)
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements",
		map[string]string{"p": legacyToken}, hdr, "", "", "")
	if err != nil {
		t.Fatalf("❌ chat-requirements 失败（可能 token 失效/被风控/PoW入口变化）: %v", err)
	}
	sentinelToken, _ := reqs["token"].(string)
	t.Logf("✅ chat-requirements 返回，sentinel token 长度=%d", len(sentinelToken))

	// 看真实难度
	if pw, ok := reqs["proofofwork"].(map[string]any); ok {
		req, _ := pw["required"].(bool)
		seed, _ := pw["seed"].(string)
		diff, _ := pw["difficulty"].(string)
		t.Logf("📋 真实 PoW: required=%v seed=%s... difficulty=%q", req, safeSeed(seed), diff)
	} else {
		t.Logf("📋 本次未要求 PoW（proofofwork 字段缺失）")
	}

	// Step 2.5: 用优化版求解真实 PoW
	t0 := time.Now()
	proofToken := solvePoWIfNeeded(reqs, ua)
	t.Logf("⏱  优化版求解耗时 %v，proof 长度=%d 前缀=%.12s", time.Since(t0), len(proofToken),
		func() string { if len(proofToken) > 0 { return proofToken } ; return "(空-未要求或求解失败)" }())

	// Step 3: conversation/prepare —— 提交 proof，看 OpenAI 是否接受
	prepPayload := map[string]any{
		"action": "next", "fork_from_shared_post": false,
		"parent_message_id": newUUID(), "model": "gpt-image-2",
		"client_prepare_state": "success", "timezone_offset_min": -480,
		"timezone": "Asia/Shanghai", "conversation_mode": map[string]string{"kind": "primary_assistant"},
		"system_hints": []string{"picture_v2"},
		"partial_query": map[string]any{
			"id": newUUID(), "author": map[string]string{"role": "user"},
			"content": map[string]any{"content_type": "text", "parts": []string{"a red apple"}},
		},
		"supports_buffering": true, "supported_encodings": []string{"v1"},
		"client_contextual_info": map[string]any{"app_name": "chatgpt.com"},
	}
	prepData, err := doPost(ctx, client, "/backend-api/f/conversation/prepare", prepPayload, hdr, sentinelToken, proofToken, "")
	if err != nil {
		// 关键判断：如果是 PoW 被拒，错误里通常含 403 / sentinel / proof 相关
		t.Fatalf("❌ prepare 被拒（若含 403/sentinel 则说明 PoW/token 未通过）: %v", err)
	}
	conduit, _ := prepData["conduit_token"].(string)
	t.Logf("✅✅ prepare 成功！OpenAI 接受了优化版 PoW。conduit_token 长度=%d", len(conduit))
	t.Log("=== 结论：优化版 PoW 能被真实 OpenAI sentinel 接受 ===")
}
