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

// SVGGenService 走 ChatGPT 文本对话接口生成 SVG/矢量（复用账号池 + 同款后端协议）。
// 与生图 service 同构：从号池取号、PoW、SSE，但走文本模型、读流式文本。
type SVGGenService struct {
	mysql *store.MySQLStore
	redis *store.RedisStore
}

func NewSVGGenService(mysql *store.MySQLStore, redis *store.RedisStore) *SVGGenService {
	return &SVGGenService{mysql: mysql, redis: redis}
}

// ModelInfo 账号可用模型（slug + 展示名）。
type ModelInfo struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

// ListModels 用号池里一个可用账号拉取 /backend-api/models，返回可选模型列表。
func (s *SVGGenService) ListModels(ctx context.Context) ([]ModelInfo, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	candidates, err := GetAccountPool(s.mysql).PickCandidates()
	if err != nil || len(candidates) == 0 {
		return nil, fmt.Errorf("无可用账号")
	}
	transport := getChromeTransport(regCfg.Proxy)
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	var lastErr error
	for i, acc := range candidates {
		if i >= 5 {
			break
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/backend-api/models?history_and_training_disabled=false", nil)
		req.Header.Set("User-Agent", ua)
		req.Header.Set("Authorization", "Bearer "+acc.AccessToken)
		req.Header.Set("Origin", "https://chatgpt.com")
		req.Header.Set("Referer", "https://chatgpt.com/")
		req.Header.Set("OAI-Device-Id", newUUID())
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		var data struct {
			Models []ModelInfo `json:"models"`
		}
		json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()
		if len(data.Models) > 0 {
			return data.Models, nil
		}
		lastErr = fmt.Errorf("账号 %s 返回空模型列表", acc.Email)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("拉取模型列表失败")
}

// GenerateSVG 用指定模型生成 SVG 文本。onDelta 每收到一段增量文本回调一次（用于 SSE 逐字透传）；
// 返回最终完整文本。账号池逐个尝试，失败按生图同款分级标记/换号。
func (s *SVGGenService) GenerateSVG(ctx context.Context, modelSlug, prompt string, onDelta func(string)) (string, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	proxy := regCfg.Proxy
	// 单账号并发上限：后台可配（scheduler_config.max_per_account），热更新。
	maxPerAccount := 3
	if sched := GetScheduler(); sched != nil {
		maxPerAccount = sched.MaxPerAccount()
	}

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
		txt, e := s.chatSVG(ctx, modelSlug, prompt, acc.AccessToken, proxy, onDelta)
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

const svgSystemHint = "你是一个 SVG 矢量图生成器。根据用户描述输出一段完整、合法、可独立渲染的 SVG 代码，" +
	"使用 viewBox，不要外部依赖。只输出 ```svg 代码块，不要任何多余解释。"

// chatSVG 用单个账号发起一次文本对话，SSE 流式累积 assistant 文本。
func (s *SVGGenService) chatSVG(ctx context.Context, modelSlug, prompt, accessToken, proxy string, onDelta func(string)) (string, error) {
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

	fullPrompt := svgSystemHint + "\n\n用户描述：" + prompt
	msg := map[string]any{
		"id":      newUUID(),
		"author":  map[string]string{"role": "user"},
		"content": map[string]any{"content_type": "text", "parts": []string{fullPrompt}},
	}
	payload := map[string]any{
		"action":                        "next",
		"messages":                      []map[string]any{msg},
		"parent_message_id":             newUUID(),
		"model":                         modelSlug,
		"timezone_offset_min":           -480,
		"conversation_mode":             map[string]string{"kind": "primary_assistant"},
		"history_and_training_disabled": true,
	}

	txt, err := s.streamText(ctx, client, "/backend-api/f/conversation", payload, hdr, sentinel, proof, onDelta)
	if err != nil || txt == "" {
		txt, err = s.streamText(ctx, client, "/backend-api/conversation", payload, hdr, sentinel, proof, onDelta)
	}
	if err != nil {
		return "", err
	}
	if txt == "" {
		return "", fmt.Errorf("未获取到回复")
	}
	return txt, nil
}

// streamText 发起 SSE 对话并逐条解析 assistant 文本；每次文本增长时回调 onDelta(增量)。
func (s *SVGGenService) streamText(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof string, onDelta func(string)) (string, error) {
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
	scanner.Buffer(make([]byte, 1024*1024), 8*1024*1024)
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
		parts, _ := content["parts"].([]any)
		var sb strings.Builder
		for _, p := range parts {
			if str, ok := p.(string); ok {
				sb.WriteString(str)
			}
		}
		cur := sb.String()
		if cur != "" && cur != last {
			// 全量快照：计算相对上次的增量回调
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
