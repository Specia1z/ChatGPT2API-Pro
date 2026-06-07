package service

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// ChatMessage 一条对话消息（OpenAI 风格）。Images 为可选的 base64 图片（多模态输入）。
type ChatMessage struct {
	Role    string   // system | user | assistant
	Text    string   // 文本内容
	Images  []string // 裸 base64 图片（仅 user 消息有意义）
}

// ChatGenService 通用对话服务：把 OpenAI 风格 messages 转成 ChatGPT 网页后端协议，
// 复用号池/PoW/SSE。与 SVG 服务同构。
type ChatGenService struct {
	mysql *store.MySQLStore
	redis *store.RedisStore
}

func NewChatGenService(mysql *store.MySQLStore, redis *store.RedisStore) *ChatGenService {
	return &ChatGenService{mysql: mysql, redis: redis}
}

// Chat 用指定模型跑一轮对话（含完整历史）。onDelta 流式增量回调（nil=不回调）；返回完整文本。
// 号池逐个尝试，失败按生图同款分级标记/换号。
func (s *ChatGenService) Chat(ctx context.Context, modelSlug string, messages []ChatMessage, onDelta func(string)) (string, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	proxy := regCfg.Proxy
	const maxPerAccount = 3

	candidates, err := GetAccountPool(s.mysql).PickCandidates()
	if err != nil {
		return "", fmt.Errorf("无可用账号: %w", err)
	}
	maxAttempts := 20
	if len(candidates) < maxAttempts {
		maxAttempts = len(candidates)
	}

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatOnce(ctx, modelSlug, messages, acc.AccessToken, proxy, onDelta)
		return txt, true, e
	}

	var lastErr error
	attempt := 0
	for _, acc := range candidates {
		if attempt >= maxAttempts {
			break
		}
		txt, occupied, genErr := tryOne(acc)
		if !occupied {
			continue
		}
		attempt++
		if genErr == nil {
			acc.SuccessCount = 1
			acc.FailCount = 0
			now := time.Now()
			acc.LastUsedAt = &now
			s.mysql.UpdateAccountUsage(acc)
			return txt, nil
		}
		lastErr = genErr
		errStr := genErr.Error()
		mark := ""
		switch {
		case strings.Contains(errStr, "GPT 拒绝") || strings.Contains(errStr, "violate"):
			return "", genErr
		case isAuthBanned(errStr):
			mark = "异常"
		case isRateLimited(errStr):
			mark = "限流"
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

// chatOnce 用单个账号跑一轮完整对话。把 messages（含多轮历史 + 多模态图片）转成
// ChatGPT 后端的 messages 数组，SSE 流式累积 assistant 文本。
func (s *ChatGenService) chatOnce(ctx context.Context, modelSlug string, messages []ChatMessage, accessToken, proxy string, onDelta func(string)) (string, error) {
	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 300 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	// bootstrap
	if r, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil); r != nil {
		r.Header.Set("User-Agent", ua)
		if resp, err := client.Do(r); err == nil {
			resp.Body.Close()
		}
	}
	// requirements + PoW
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements", map[string]string{"p": buildLegacyToken(ua)}, hdr, "", "", "")
	if err != nil {
		return "", fmt.Errorf("requirements: %w", err)
	}
	sentinel, _ := reqs["token"].(string)
	proof := solvePoWIfNeeded(reqs, ua)

	// ChatGPT 网页后端的 messages 多条不保证被当成多轮上下文（它更像新建会话的首批消息，
	// 取最后一条为 prompt）。为可靠实现无状态多轮，把历史折叠成单条文本上下文 + 末条作为当前提问。
	// 末条若是 tool 结果，则构造"请基于工具结果作答"的提问。多模态图片取末条 user 的。
	var ctxParts []string
	var lastImages []string
	// 末条有效消息（user 或 tool）作为"当前提问"
	lastIdx := len(messages) - 1
	for lastIdx >= 0 && strings.TrimSpace(messages[lastIdx].Text) == "" && len(messages[lastIdx].Images) == 0 {
		lastIdx--
	}
	for i, m := range messages {
		role := m.Role
		txt := strings.TrimSpace(m.Text)
		if i == lastIdx {
			lastImages = m.Images
			continue // 末条单独处理
		}
		if txt == "" {
			continue
		}
		switch role {
		case "system":
			ctxParts = append(ctxParts, "[系统指令] "+txt)
		case "assistant":
			ctxParts = append(ctxParts, "助手: "+txt)
		case "tool":
			ctxParts = append(ctxParts, "[工具返回结果] "+txt)
		default:
			ctxParts = append(ctxParts, "用户: "+txt)
		}
	}
	finalText := ""
	if lastIdx >= 0 {
		lm := messages[lastIdx]
		lt := strings.TrimSpace(lm.Text)
		if lm.Role == "tool" {
			finalText = "工具返回了以下结果，请基于它回答用户：\n" + lt
		} else {
			finalText = lt
		}
	}
	if len(ctxParts) > 0 {
		finalText = "以下是之前的对话历史：\n" + strings.Join(ctxParts, "\n") + "\n\n现在请处理最新内容：\n" + finalText
	}

	// 构造单条 user 消息（含多模态图片）
	var ggMessages []map[string]any
	{
		if len(lastImages) > 0 {
			parts := []any{finalText}
			for _, b64 := range lastImages {
				if b64 == "" {
					continue
				}
				fid, upErr := uploadImage(ctx, client, b64, accessToken, deviceID, ua)
				if upErr != nil {
					continue
				}
				parts = append(parts, map[string]any{
					"content_type":  "image_asset_pointer",
					"asset_pointer": "file-service://" + fid,
					"size_bytes":    float64(0), "width": float64(1024), "height": float64(1024),
				})
			}
			ggMessages = append(ggMessages, map[string]any{
				"id":      newUUID(),
				"author":  map[string]string{"role": "user"},
				"content": map[string]any{"content_type": "multimodal_text", "parts": parts},
			})
		} else {
			ggMessages = append(ggMessages, map[string]any{
				"id":      newUUID(),
				"author":  map[string]string{"role": "user"},
				"content": map[string]any{"content_type": "text", "parts": []string{finalText}},
			})
		}
	}

	payload := map[string]any{
		"action":                        "next",
		"messages":                      ggMessages,
		"parent_message_id":             newUUID(),
		"model":                         modelSlug,
		"timezone_offset_min":           -480,
		"conversation_mode":             map[string]string{"kind": "primary_assistant"},
		"history_and_training_disabled": true,
	}

	txt, err := s.streamChat(ctx, client, "/backend-api/f/conversation", payload, hdr, sentinel, proof, onDelta)
	if err != nil || txt == "" {
		txt, err = s.streamChat(ctx, client, "/backend-api/conversation", payload, hdr, sentinel, proof, onDelta)
	}
	if err != nil {
		return "", err
	}
	if txt == "" {
		return "", fmt.Errorf("未获取到回复")
	}
	return txt, nil
}

// streamChat 发起 SSE 对话并逐条解析 assistant 文本；文本增长时回调 onDelta(增量)。
func (s *ChatGenService) streamChat(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof string, onDelta func(string)) (string, error) {
	j, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com"+path, strings.NewReader(string(j)))
	for k, v := range hdrFn(path) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if sentinel != "" {
		req.Header.Set("OpenAI-Sentinel-Chat-Requirements-Token", sentinel)
	}
	if proof != "" {
		req.Header.Set("OpenAI-Sentinel-Proof-Token", proof)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b[:minI(300, len(b))]))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	last := ""
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var ev map[string]any
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		msg, _ := ev["message"].(map[string]any)
		if msg == nil {
			if v, _ := ev["v"].(map[string]any); v != nil {
				msg, _ = v["message"].(map[string]any)
			}
		}
		if msg == nil {
			continue
		}
		author, _ := msg["author"].(map[string]any)
		if role, _ := author["role"].(string); role != "assistant" {
			continue
		}
		content, _ := msg["content"].(map[string]any)
		if content == nil {
			continue
		}
		// 仅取文本部分（忽略思维链/工具中间态）
		if ct, _ := content["content_type"].(string); ct != "text" && ct != "multimodal_text" {
			continue
		}
		parts, _ := content["parts"].([]any)
		var sb strings.Builder
		for _, p := range parts {
			if str, ok := p.(string); ok {
				sb.WriteString(str)
			}
		}
		cur := sb.String()
		if cur != "" && cur != last {
			if onDelta != nil && strings.HasPrefix(cur, last) {
				onDelta(cur[len(last):])
			} else if onDelta != nil {
				onDelta(cur)
			}
			last = cur
		}
	}
	return strings.TrimSpace(last), nil
}
