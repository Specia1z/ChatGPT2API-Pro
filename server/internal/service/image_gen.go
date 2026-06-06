package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

type ImageGenService struct {
	mysql *store.MySQLStore
	redis *store.RedisStore
}

func NewImageGenService(mysql *store.MySQLStore, redis *store.RedisStore) *ImageGenService {
	return &ImageGenService{mysql: mysql, redis: redis}
}

func (s *ImageGenService) Generate(ctx context.Context, prompt, size string, refImages ...string) (string, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	proxy := regCfg.Proxy

	// 每个账号允许的最大并发占用数（防止单账号被并发请求踩踏触发限流）
	const maxPerAccount = 3

	candidates, err := GetAccountPool(s.mysql).PickCandidates()
	if err != nil {
		return "", fmt.Errorf("无可用账号: %w", err)
	}

	maxAttempts := 20
	if len(candidates) < maxAttempts {
		maxAttempts = len(candidates)
	}

	// tryOne 占用一个账号的槽位并尝试生图。用闭包 + defer 确保槽位在任何路径
	// （成功 / 失败 / panic）都被释放，杜绝槽位泄漏。
	// 返回：图片、是否占到坑(occupied)、生图错误。
	tryOne := func(acc *model.Account) (img string, occupied bool, genErr error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil // 未占到坑（已满），交由调用方换号
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID) // panic-safe 释放
		img, genErr = s.callChatGPT(ctx, prompt, acc.AccessToken, proxy, refImages, size)
		return img, true, genErr
	}

	var lastErr error
	attempt := 0
	for _, acc := range candidates {
		if attempt >= maxAttempts {
			break
		}

		imageB64, occupied, genErr := tryOne(acc)
		if !occupied {
			log.Printf("[gen] %s 槽位已满(并发>%d)，跳过", acc.Email, maxPerAccount)
			continue
		}
		attempt++

		if genErr == nil {
			acc.SuccessCount = 1
			acc.FailCount = 0
			now := time.Now()
			acc.LastUsedAt = &now
			s.mysql.UpdateAccountUsage(acc)
			return imageB64, nil
		}

		lastErr = genErr
		errStr := genErr.Error()
		log.Printf("[gen] #%d %s 失败: %v", attempt, acc.Email, genErr)

		// 失败分级：决定是否给账号打标记（"" = 不动账号状态，仅换号）
		mark := ""
		switch {
		case strings.Contains(errStr, "GPT 拒绝") || strings.Contains(errStr, "内容") || strings.Contains(errStr, "violate"):
			// 内容拒绝 → 换账号也没用，直接返回
			return "", genErr
		case isAuthBanned(errStr):
			mark = "异常" // 401/封禁 → 账号失效
		case isRateLimited(errStr):
			mark = "限流" // 真实频率/配额限制
		case isTransientErr(errStr):
			// 网络/TLS/超时/本地故障 → 与账号无关，不标记，仅换号
			log.Printf("[gen] %s 网络/临时故障，不标记账号，换号重试", acc.Email)
		default:
			// 未知错误 → 保守起见不动账号状态（避免误伤健康账号），仅换号
			log.Printf("[gen] %s 未知错误，不标记账号，换号重试", acc.Email)
		}
		if mark != "" {
			acc.FailCount = 1
			acc.SuccessCount = 0
			acc.Status = mark
			s.mysql.UpdateAccountUsage(acc)
		}
	}

	if lastErr != nil {
		return "", fmt.Errorf("号池耗尽: %w", lastErr)
	}
	return "", fmt.Errorf("号池为空或全部繁忙")
}

// isAuthBanned 认证失败/封禁（账号真有问题）。用 "HTTP 401" 而非裸 "401"，避免响应体里的巧合子串误判。
func isAuthBanned(s string) bool {
	return strings.Contains(s, "HTTP 401") || strings.Contains(s, "封禁(401)") ||
		strings.Contains(s, "token banned") || strings.Contains(s, "banned")
}

// isRateLimited 真实限流（账号配额/频率受限）
func isRateLimited(s string) bool {
	low := strings.ToLower(s)
	return strings.Contains(s, "HTTP 429") || strings.Contains(s, "限流") ||
		strings.Contains(low, "rate limit") || strings.Contains(low, "too many")
}

// isTransientErr 本地网络/TLS/超时（与账号无关，不应标记账号状态）
func isTransientErr(s string) bool {
	low := strings.ToLower(s)
	for _, m := range []string{
		"tls 握手失败", "unsupported curve", "handshake", "malformed http response",
		"tls:", "connection refused", "connection reset", "timeout", "deadline exceeded",
		"no such host", "network is unreachable", "eof", "连接代理", "网络:", "i/o timeout",
	} {
		if strings.Contains(low, m) {
			return true
		}
	}
	return false
}

// healthCheck 快速验证账号可用性（10s 超时）
func (s *ImageGenService) healthCheck(acc *model.Account, proxy string) error {
	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	req, _ := http.NewRequest("GET", "https://chatgpt.com/backend-api/me", nil)
	req.Header.Set("Authorization", "Bearer "+acc.AccessToken)
	req.Header.Set("User-Agent", ua)
	req.Header.Set("OAI-Device-Id", deviceID)
	req.Header.Set("Origin", "https://chatgpt.com")
	req.Header.Set("Referer", "https://chatgpt.com/")

	resp, err := client.Do(req)
	if err != nil { return fmt.Errorf("网络: %w", err) }
	defer resp.Body.Close()

	if resp.StatusCode == 401 { return fmt.Errorf("封禁(401)") }
	if resp.StatusCode == 403 { return fmt.Errorf("受限(403)") }
	if resp.StatusCode >= 500 { return fmt.Errorf("服务端(%d)", resp.StatusCode) }
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body[:minI(80, len(body))]))
	}
	return nil
}

func (s *ImageGenService) callChatGPT(ctx context.Context, prompt, accessToken, proxy string, refImages []string, size string) (string, error) {
	// 注入比例提示到 prompt
	prompt = appendSizeHint(prompt, size)
	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 180 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	doGet := func(path string) (map[string]any, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com"+path, nil)
		for k, v := range hdr(path) { req.Header.Set(k, v) }
		resp, err := client.Do(req)
		if err != nil { return nil, err }
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body[:minI(300, len(body))]))
		}
		var data map[string]any
		json.NewDecoder(resp.Body).Decode(&data)
		return data, nil
	}

	// Step 1: Bootstrap
	bootstrapReq, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil)
	bootstrapReq.Header.Set("User-Agent", ua)
	if bootstrapResp, err := client.Do(bootstrapReq); err == nil {
		bootstrapResp.Body.Close()
	}
	// Step 2: Requirements + PoW
	legacyToken := buildLegacyToken(ua)
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements", map[string]string{"p": legacyToken}, hdr, "", "", "")
	if err != nil { return "", fmt.Errorf("requirements: %w", err) }
	sentinelToken, _ := reqs["token"].(string)
	proofToken := solvePoWIfNeeded(reqs, ua)

	// Step 2.5: 上传多张参考图
	var uploadedFileIDs []string
	for _, refB64 := range refImages {
		if refB64 == "" { continue }
		fid, err := uploadImage(ctx, client, refB64, accessToken, deviceID, ua)
		if err != nil {
			log.Printf("[gen] upload ref image: %v", err)
			continue
		}
		log.Printf("[gen] uploaded ref image, file_id=%s", fid)
		uploadedFileIDs = append(uploadedFileIDs, fid)
	}
	if len(uploadedFileIDs) > 0 {
		log.Printf("[gen] total %d ref images uploaded", len(uploadedFileIDs))
	}

	// Step 3: Prepare
	prepPayload := map[string]any{
		"action": "next", "fork_from_shared_post": false,
		"parent_message_id": newUUID(), "model": "gpt-image-2",
		"client_prepare_state": "success", "timezone_offset_min": -480,
		"timezone": "Asia/Shanghai", "conversation_mode": map[string]string{"kind": "primary_assistant"},
		"system_hints": []string{"picture_v2"},
		"partial_query": map[string]any{
			"id": newUUID(), "author": map[string]string{"role": "user"},
			"content": map[string]any{"content_type": "text", "parts": []string{prompt}},
		},
		"image_attachments": buildImageAttachments(uploadedFileIDs),
		"supports_buffering": true, "supported_encodings": []string{"v1"},
		"client_contextual_info": map[string]any{"app_name": "chatgpt.com"},
	}
	prepData, err := doPost(ctx, client, "/backend-api/f/conversation/prepare", prepPayload, hdr, sentinelToken, proofToken, "")
	if err != nil { return "", fmt.Errorf("prepare: %w", err) }
	conduitToken, _ := prepData["conduit_token"].(string)

	// Step 4: SSE
	genPayload := map[string]any{
		"action": "next",
		"messages": buildMessages(prompt, uploadedFileIDs),
		"image_attachments": buildImageAttachments(uploadedFileIDs),
		"parent_message_id": newUUID(), "model": "gpt-image-2",
		"client_prepare_state": "sent", "timezone_offset_min": -480,
		"timezone": "Asia/Shanghai", "conversation_mode": map[string]string{"kind": "primary_assistant"},
		"system_hints": []string{"picture_v2"},
		"supports_buffering": true, "supported_encodings": []string{"v1"},
		"client_contextual_info": map[string]any{"app_name": "chatgpt.com"},
	}
	conversationID, err := doSSEPost(ctx, client, "/backend-api/f/conversation", genPayload, hdr, sentinelToken, proofToken, conduitToken)
	if err != nil { return "", fmt.Errorf("sse: %w", err) }

	// Step 5: Poll
	time.Sleep(10 * time.Second)
	var fileIDs []string
	consecutiveErrors := 0
	for i := 0; i < 48; i++ {
		conv, err := doGet("/backend-api/conversation/" + conversationID)
		if err != nil {
			consecutiveErrors++
			log.Printf("[gen] poll %d: err=%v (连续错误=%d)", i, err, consecutiveErrors)
			// TLS/网络错误连错 5 次直接放弃
			if consecutiveErrors >= 5 {
				return "", fmt.Errorf("生图轮询网络故障 (连续%d次失败)", consecutiveErrors)
			}
			time.Sleep(5 * time.Second)
			continue
		}
		consecutiveErrors = 0
		// 检测 GPT 拒绝/错误消息
		if rejectMsg := detectRejection(conv); rejectMsg != "" {
			return "", fmt.Errorf("GPT 拒绝: %s", rejectMsg)
		}

		fids := extractFileIDs(conv)
		if len(fids) > 0 { fileIDs = fids; break }
		time.Sleep(10 * time.Second)
	}
	if len(fileIDs) == 0 { return "", fmt.Errorf("生图超时") }
	log.Printf("[gen] found %d file IDs", len(fileIDs))

	// Step 6: Download URL
	var dlURL string
	for _, fid := range fileIDs {
		if fid == "file_upload" { continue }
		data, err := doGet("/backend-api/files/" + fid + "/download")
		if err != nil { continue }
		if u, _ := data["download_url"].(string); u != "" { dlURL = u; break }
		if u, _ := data["url"].(string); u != "" { dlURL = u; break }
	}
	if dlURL == "" { return "", fmt.Errorf("无法获取下载地址") }

	// Step 7: Download
	log.Printf("[gen] downloading: %s", dlURL[:minI(100, len(dlURL))])
	imgReq, _ := http.NewRequestWithContext(ctx, "GET", dlURL, nil)
	imgReq.Header.Set("User-Agent", ua)
	imgReq.Header.Set("Referer", "https://chatgpt.com/")
	imgReq.Header.Set("Authorization", "Bearer "+accessToken)
	imgReq.Header.Set("OAI-Device-Id", deviceID)
	imgResp, err := client.Do(imgReq)
	if err != nil { return "", fmt.Errorf("下载图片: %w", err) }
	defer imgResp.Body.Close()
	imgData, _ := io.ReadAll(imgResp.Body)
	log.Printf("[gen] download status=%d size=%d", imgResp.StatusCode, len(imgData))
	if len(imgData) < 100 {
		preview := string(imgData)
		if len(preview) > 200 { preview = preview[:200] }
		return "", fmt.Errorf("图片数据异常: HTTP %d, body=%s", imgResp.StatusCode, preview)
	}
	log.Printf("[gen] downloaded %d bytes", len(imgData))
	return base64.StdEncoding.EncodeToString(imgData), nil
}

func doPost(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof, conduit string) (map[string]any, error) {
	j, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com"+path, strings.NewReader(string(j)))
	for k, v := range hdrFn(path) { req.Header.Set(k, v) }
	req.Header.Set("Content-Type", "application/json")
	if sentinel != "" { req.Header.Set("OpenAI-Sentinel-Chat-Requirements-Token", sentinel) }
	if proof != "" { req.Header.Set("OpenAI-Sentinel-Proof-Token", proof) }
	if conduit != "" { req.Header.Set("X-Conduit-Token", conduit) }
	resp, err := client.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body[:minI(200, len(body))]))
	}
	var data map[string]any
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

func doSSEPost(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof, conduit string) (string, error) {
	j, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com"+path, strings.NewReader(string(j)))
	for k, v := range hdrFn(path) { req.Header.Set(k, v) }
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if sentinel != "" { req.Header.Set("OpenAI-Sentinel-Chat-Requirements-Token", sentinel) }
	if proof != "" { req.Header.Set("OpenAI-Sentinel-Proof-Token", proof) }
	if conduit != "" { req.Header.Set("X-Conduit-Token", conduit) }
	resp, err := client.Do(req)
	if err != nil { return "", err }
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("SSE HTTP %d: %s", resp.StatusCode, string(body[:minI(300, len(body))]))
	}
	scanner := bufio.NewScanner(resp.Body)
	cid := ""
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") { continue }
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" { break }
		var ev map[string]any
		if json.Unmarshal([]byte(data), &ev) != nil { continue }
		if v, _ := ev["conversation_id"].(string); v != "" { cid = v }
		if msg, ok := ev["message"].(map[string]any); ok {
			if v, _ := msg["conversation_id"].(string); v != "" { cid = v }
		}
	}
	if cid == "" { return "", fmt.Errorf("未获取到 conversation_id") }
	return cid, nil
}

func solvePoWIfNeeded(reqs map[string]any, ua string) string {
	powInfo, _ := reqs["proofofwork"].(map[string]any)
	if powInfo == nil { return "" }
	required, _ := powInfo["required"].(bool)
	if !required { return "" }
	seed, _ := powInfo["seed"].(string)
	diff, _ := powInfo["difficulty"].(string)
	if seed == "" { return "" }
	return solveProofOfWork(seed, diff, ua)
}

func extractFileIDs(conversation map[string]any) []string {
	mapping, _ := conversation["mapping"].(map[string]any)
	if mapping == nil { return nil }
	var ids []string
	filePat := regexp.MustCompile(`file-service://([A-Za-z0-9_-]+)`)
	sedPat := regexp.MustCompile(`sediment://([A-Za-z0-9_-]+)`)
	for _, node := range mapping {
		n, _ := node.(map[string]any)
		if n == nil { continue }
		msg, _ := n["message"].(map[string]any)
		if msg == nil { continue }
		author, _ := msg["author"].(map[string]any)
		if role, _ := author["role"].(string); role != "tool" { continue }
		content, _ := msg["content"].(map[string]any)
		if ct, _ := content["content_type"].(string); ct != "multimodal_text" { continue }
		metadata, _ := msg["metadata"].(map[string]any)
		parts, _ := content["parts"].([]any)
		var fileIDs, sedimentIDs []string
		for _, part := range parts {
			var text string
			switch v := part.(type) {
			case string: text = v
			case map[string]any: text, _ = v["asset_pointer"].(string)
			}
			for _, m := range filePat.FindAllStringSubmatch(text, -1) {
				if m[1] != "" && !containsStr(fileIDs, m[1]) { fileIDs = append(fileIDs, m[1]) }
			}
			for _, m := range sedPat.FindAllStringSubmatch(text, -1) {
				if m[1] != "" && !containsStr(sedimentIDs, m[1]) { sedimentIDs = append(sedimentIDs, m[1]) }
			}
		}
		asyncType, _ := metadata["async_task_type"].(string)
		if asyncType != "image_gen" && len(fileIDs) == 0 && len(sedimentIDs) == 0 { continue }
		ids = append(ids, fileIDs...)
		ids = append(ids, sedimentIDs...)
	}
	return ids
}

func detectRejection(conv map[string]any) string {
	mapping, _ := conv["mapping"].(map[string]any)
	if mapping == nil { return "" }
	for _, node := range mapping {
		n, _ := node.(map[string]any)
		if n == nil { continue }
		msg, _ := n["message"].(map[string]any)
		if msg == nil { continue }
		author, _ := msg["author"].(map[string]any)
		role, _ := author["role"].(string)
		if role != "assistant" { continue }
		content, _ := msg["content"].(map[string]any)
		parts, _ := content["parts"].([]any)
		for _, p := range parts {
			if text, ok := p.(string); ok {
				lower := strings.ToLower(text)
				if strings.Contains(lower, "violate") || strings.Contains(lower, "guardrails") ||
					strings.Contains(lower, "sorry") && strings.Contains(lower, "image") ||
					strings.Contains(lower, "unable to generate") ||
					strings.Contains(lower, "can't create") {
					return strings.TrimSpace(text)
				}
			}
		}
	}
	return ""
}

func containsStr(slice []string, item string) bool {
	for _, s := range slice { if s == item { return true } }
	return false
}

func uploadImage(ctx context.Context, client *http.Client, b64, accessToken, deviceID, ua string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil { return "", fmt.Errorf("decode: %w", err) }

	// Step 1: 请求上传凭证 (JSON body, not multipart)
	var step1 bytes.Buffer
	meta, _ := json.Marshal(map[string]any{
		"file_name": "image.png", "file_size": len(decoded),
		"use_case": "multimodal", "width": 1024, "height": 1024,
	})
	step1.Write(meta)
	req1, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com/backend-api/files", &step1)
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("Accept", "application/json")
	req1.Header.Set("User-Agent", ua)
	req1.Header.Set("Origin", "https://chatgpt.com")
	req1.Header.Set("Referer", "https://chatgpt.com/")
	req1.Header.Set("Authorization", "Bearer "+accessToken)
	req1.Header.Set("OAI-Device-Id", deviceID)
	resp1, err := client.Do(req1)
	if err != nil { return "", fmt.Errorf("upload step1: %w", err) }
	defer resp1.Body.Close()
	b1, _ := io.ReadAll(resp1.Body)
	if resp1.StatusCode != 200 {
		return "", fmt.Errorf("upload step1 HTTP %d: %s", resp1.StatusCode, string(b1[:minI(200, len(b1))]))
	}
	var uploadMeta map[string]any
	json.Unmarshal(b1, &uploadMeta)
	fileID, _ := uploadMeta["file_id"].(string)
	uploadURL, _ := uploadMeta["upload_url"].(string)
	if fileID == "" || uploadURL == "" {
		return "", fmt.Errorf("step1 missing file_id or upload_url: %s", string(b1[:minI(300, len(b1))]))
	}

	// Step 2: PUT 到 Azure Blob
	req2, _ := http.NewRequestWithContext(ctx, "PUT", uploadURL, bytes.NewReader(decoded))
	req2.Header.Set("Content-Type", "image/png")
	req2.Header.Set("x-ms-blob-type", "BlockBlob")
	req2.Header.Set("x-ms-version", "2020-04-08")
	req2.Header.Set("Origin", "https://chatgpt.com")
	req2.Header.Set("Referer", "https://chatgpt.com/")
	req2.Header.Set("User-Agent", ua)
	resp2, err := client.Do(req2)
	if err != nil { return "", fmt.Errorf("upload step2: %w", err) }
	if resp2.StatusCode != 201 {
		body, _ := io.ReadAll(resp2.Body)
		resp2.Body.Close()
		return "", fmt.Errorf("upload step2 HTTP %d: %s", resp2.StatusCode, string(body[:minI(200, len(body))]))
	}
	resp2.Body.Close()

	// Step 3: 标记上传完成
	req3, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com/backend-api/files/"+fileID+"/uploaded", strings.NewReader("{}"))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("Accept", "application/json")
	req3.Header.Set("User-Agent", ua)
	req3.Header.Set("Origin", "https://chatgpt.com")
	req3.Header.Set("Referer", "https://chatgpt.com/")
	req3.Header.Set("Authorization", "Bearer "+accessToken)
	req3.Header.Set("OAI-Device-Id", deviceID)
	resp3, err := client.Do(req3)
	if err != nil { return "", fmt.Errorf("upload step3: %w", err) }
	if resp3.StatusCode != 200 {
		body, _ := io.ReadAll(resp3.Body)
		resp3.Body.Close()
		return "", fmt.Errorf("upload step3 HTTP %d: %s", resp3.StatusCode, string(body[:minI(200, len(body))]))
	}
	resp3.Body.Close()

	log.Printf("[gen] upload complete, file_id=%s", fileID)
	return fileID, nil
}

func buildMessages(prompt string, fileIDs []string) []map[string]any {
	parts := []any{prompt}
	for _, fid := range fileIDs {
		parts = append(parts, map[string]any{
			"content_type": "image_asset_pointer",
			"asset_pointer": "file-service://" + fid,
			"size_bytes": float64(0),
			"width": float64(1024),
			"height": float64(1024),
		})
	}
	msg := map[string]any{
		"id": newUUID(), "author": map[string]string{"role": "user"},
		"content": map[string]any{"content_type": "multimodal_text", "parts": parts},
		"metadata": map[string]any{"system_hints": []string{"picture_v2"}},
	}
	return []map[string]any{msg}
}

func buildImageAttachments(fileIDs []string) []map[string]any {
	if len(fileIDs) == 0 { return nil }
	var atts []map[string]any
	for i, fid := range fileIDs {
		atts = append(atts, map[string]any{
			"file_id":         fid,
			"file_name":       fmt.Sprintf("ref_%d.png", i+1),
			"file_size_bytes": float64(0),
			"width":           float64(1024),
			"height":          float64(1024),
			"media_type":      "image/png",
		})
	}
	return atts
}

func appendSizeHint(prompt, size string) string {
	hints := map[string]string{
		"1:1":  ". IMPORTANT: Generate a perfect square image, exactly 1024x1024 pixels, 1:1 aspect ratio.",
		"4:3":  ". IMPORTANT: Generate in landscape 4:3 format, exactly 1280x960 pixels.",
		"3:4":  ". IMPORTANT: Generate in portrait 3:4 vertical format, exactly 960x1280 pixels.",
		"16:9": ". IMPORTANT: Generate in widescreen 16:9 format, exactly 1792x1024 pixels.",
		"9:16": ". IMPORTANT: Generate in tall portrait 9:16 vertical format, exactly 1024x1792 pixels. Full vertical phone screen.",
		"16:10": ". IMPORTANT: Generate in 16:10 widescreen format, exactly 1600x1000 pixels.",
		"10:16": ". IMPORTANT: Generate in 10:16 portrait format, exactly 1000x1600 pixels.",
		"4:5":  ". IMPORTANT: Generate in 4:5 portrait format, exactly 1024x1280 pixels.",
		"21:9": ". IMPORTANT: Generate in ultra-wide cinematic 21:9 format, exactly 2560x1080 pixels.",
		"2:3":  ". IMPORTANT: Generate in portrait 2:3 format, exactly 1024x1536 pixels. Product photo vertical orientation.",
		"3:2":  ". IMPORTANT: Generate in landscape 3:2 photography format, exactly 1536x1024 pixels.",
		"5:4":  ". IMPORTANT: Generate in 5:4 large format, exactly 1280x1024 pixels.",
		"2K":   ". CRITICAL: Output must be exactly 2560x1440 pixels, 2K QHD resolution. High detail, sharp edges, no compression artifacts.",
		"4K":   ". CRITICAL: Output must be exactly 3840x2160 pixels, 4K UHD resolution. Ultra high detail, crystal clear, no compression artifacts.",
		"8K":   ". CRITICAL: Output must be exactly 7680x4320 pixels, 8K UHD resolution. Maximum possible detail, photorealistic quality.",
		"A4":   ". IMPORTANT: Generate in A4 document format, exactly 2480x3508 pixels at 300dpi. Suitable for printing.",
		"HD":   ". IMPORTANT: Generate in HD format, exactly 1280x720 pixels.",
	}
	if hint, ok := hints[size]; ok {
		return prompt + ". " + hint
	}
	// Auto：复合值 "auto:宽x高"（展示层显示 Auto，引导层用真实像素按参考图比例出图）；
	// 兼容历史裸像素串 "宽x高"。剥掉 auto: 前缀后统一按像素解析。
	size = strings.TrimPrefix(size, "auto:")
	if w, h, ok := parseWxH(size); ok {
		return prompt + fmt.Sprintf(". IMPORTANT: Generate the image at exactly %dx%d pixels, matching the reference image's aspect ratio.", w, h)
	}
	return prompt
}

// parseWxH 解析 "宽x高"（如 1920x817，分隔符 x/X/*）为像素值；非法返回 ok=false。
func parseWxH(s string) (w, h int, ok bool) {
	sep := -1
	for i := 0; i < len(s); i++ {
		if s[i] == 'x' || s[i] == 'X' || s[i] == '*' {
			sep = i
			break
		}
	}
	if sep <= 0 || sep >= len(s)-1 {
		return 0, 0, false
	}
	wv, e1 := strconv.Atoi(s[:sep])
	hv, e2 := strconv.Atoi(s[sep+1:])
	if e1 != nil || e2 != nil || wv <= 0 || hv <= 0 {
		return 0, 0, false
	}
	return wv, hv, true
}

func isAlphaNum(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_'
}

func buildLegacyToken(ua string) string {
	sid := newUUID()
	data := []any{
		"1920x1080", time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT-0700 (Coordinated Universal Time)"),
		4294705152, 1, float64(0), ua,
		"https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js",
		nil, nil, "en-US", float64(0),
		"vendorSub-undefined", "location", "Object",
		float64(1000 + time.Now().UnixNano()%40000), sid, "",
		float64(8), float64(time.Now().UnixMilli()),
	}
	j, _ := json.Marshal(data)
	return "gAAAAAC" + base64.StdEncoding.EncodeToString(j)
}

func solveProofOfWork(seed, difficulty, ua string) string {
	// PoW 不可缓存：OpenAI 每次下发随机 seed（seed 进哈希输入），上次的解对新 seed 无效，
	// 故每次都需重新求解。求解器本身极快（约 360 万次/秒），无需缓存。
	log.Printf("[pow] solving: diff=%s seed=%s..%d", difficulty, safeSeed(seed), len(seed))
	sid := newUUID()
	start := time.Now()
	ts := time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT-0700 (MST)")
	randVal := float64(1000 + time.Now().UnixNano()%40000)
	nowMs := float64(time.Now().UnixMilli())

	// JSON-encode static strings once
	tsEnc, _ := json.Marshal(ts)
	uaEnc, _ := json.Marshal(ua)
	sidEnc, _ := json.Marshal(sid)

	urlEnc := `"https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js"`
	vendorEnc := `"vendorSub-undefined"`
	locEnc := `"location"`
	objEnc := `"Object"`

	// Pre-build template parts — only counter and elapsed change per iteration
	// JSON: ["1920x1080",TS,4294705152,COUNTER,0,UA,URL,null,null,"en-US",ELAPSED,VENDOR,LOC,OBJ,RANDVAL,SID,"",8,NOWMS]
	prefix := `["1920x1080",` + string(tsEnc) + `,4294705152,`
	mid := `,0,` + string(uaEnc) + `,` + urlEnc + `,null,null,"en-US",`
	tail := `,` + vendorEnc + `,` + locEnc + `,` + objEnc + `,` + strconv.FormatFloat(randVal, 'f', -1, 64) + `,` + string(sidEnc) + `,"",8,` + strconv.FormatFloat(nowMs, 'f', -1, 64) + `]`

	// 性能优化（已由 TestPowStepEquivalence 证明与原版逐字节等价）：
	//  1) 难度用整数比较：hex(h)[:n] <= difficulty 等价于 (h >> (32-n*4)) <= diffInt，免每次 Sprintf+字符串切片+字符串比较
	//  2) fnv 分段：seed 的累加态只算一次，每次迭代续算 b64，免 seed+b64 字符串拼接
	//  3) base64 写入复用 buffer，免每次分配新 string
	//  4) elapsed 仅作反爬填充字段，降频更新，免每次迭代 time.Now() 系统调用
	// 难度格式异常时回退到原始字符串路径。
	if n := len(difficulty); n >= 1 && n <= 8 {
		if diffInt, perr := strconv.ParseUint(difficulty, 16, 64); perr == nil {
			shift := uint(32 - n*4)
			seedH := fnv1aSeed([]byte(seed))
			jsonBuf := make([]byte, 0, len(prefix)+24+len(mid)+24+len(tail))
			b64Buf := make([]byte, base64.StdEncoding.EncodedLen(cap(jsonBuf)+16))
			var lastE int64 = -1
			var elapsedStr string
			for i := 0; i < 500000; i++ {
				if i&1023 == 0 {
					if e := time.Since(start).Milliseconds(); e != lastE {
						lastE = e
						elapsedStr = strconv.FormatInt(e, 10)
					}
				}
				jsonBuf = jsonBuf[:0]
				jsonBuf = append(jsonBuf, prefix...)
				jsonBuf = strconv.AppendInt(jsonBuf, int64(i), 10)
				jsonBuf = append(jsonBuf, mid...)
				jsonBuf = append(jsonBuf, elapsedStr...)
				jsonBuf = append(jsonBuf, tail...)

				encLen := base64.StdEncoding.EncodedLen(len(jsonBuf))
				if encLen > len(b64Buf) {
					b64Buf = make([]byte, encLen)
				}
				base64.StdEncoding.Encode(b64Buf, jsonBuf)
				b64 := b64Buf[:encLen]

				if uint64(fnv1aFinish(seedH, b64)>>shift) <= diffInt {
					token := "gAAAAAB" + string(b64) + "~S"
					log.Printf("[pow] solved: diff=%s iter=%d elapsed=%dms", difficulty, i, time.Since(start).Milliseconds())
					return token
				}
			}
			log.Printf("[pow] not found in 500k: diff=%s elapsed=%dms", difficulty, time.Since(start).Milliseconds())
			return ""
		}
	}

	// 回退：原始字符串比较路径（难度格式异常时）
	buf := make([]byte, 0, len(prefix)+64+len(mid)+64+len(tail))
	for i := 0; i < 500000; i++ {
		elapsed := float64(time.Since(start).Milliseconds())

		buf = buf[:0]
		buf = append(buf, prefix...)
		buf = strconv.AppendInt(buf, int64(i), 10)
		buf = append(buf, mid...)
		buf = strconv.AppendFloat(buf, elapsed, 'f', -1, 64)
		buf = append(buf, tail...)

		b64 := base64.StdEncoding.EncodeToString(buf)
		if fnv1a32(seed+b64)[:len(difficulty)] <= difficulty {
			token := "gAAAAAB" + b64 + "~S"
			log.Printf("[pow] solved: diff=%s iter=%d elapsed=%dms", difficulty, i, time.Since(start).Milliseconds())
			return token
		}
	}
	log.Printf("[pow] not found in 500k: diff=%s elapsed=%dms", difficulty, time.Since(start).Milliseconds())
	return ""
}

func safeSeed(seed string) string {
	if len(seed) > 16 {
		return seed[:16]
	}
	return seed
}
