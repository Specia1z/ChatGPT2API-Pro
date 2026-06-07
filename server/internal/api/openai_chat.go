package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
)

// ── OpenAI Chat Completions 兼容层 ──────────────────────────────
// POST /v1/chat/completions —— 把标准 messages（含多模态/多轮）转成 ChatGPT 网页后端协议。
// 模型由请求 model 字段指定（gpt-5 / gpt-5.3 / gpt-5-codex / codex 等）。
// 工具调用：提示词模拟（实验性），见 buildToolPrompt。

// oaiChatRequest 标准 chat/completions 请求体（按需取字段）。
type oaiChatRequest struct {
	Model    string            `json:"model"`
	Messages []json.RawMessage `json:"messages"`
	Stream   bool              `json:"stream"`
	Tools    []json.RawMessage `json:"tools,omitempty"`
}

// parseOAIMessage 解析单条 message：content 可能是字符串，或 [{type:text,text}|{type:image_url,image_url:{url}}]。
func parseOAIMessage(raw json.RawMessage) (role, text string, images []string) {
	var m struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	json.Unmarshal(raw, &m)
	role = m.Role
	// content 为字符串
	var s string
	if json.Unmarshal(m.Content, &s) == nil {
		return role, s, nil
	}
	// content 为数组（多模态）
	var parts []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if json.Unmarshal(m.Content, &parts) == nil {
		var sb strings.Builder
		for _, p := range parts {
			switch p.Type {
			case "text":
				sb.WriteString(p.Text)
			case "image_url":
				if b64 := dataURLToB64(p.ImageURL.URL); b64 != "" {
					images = append(images, b64)
				}
			}
		}
		return role, sb.String(), images
	}
	return role, "", nil
}

// dataURLToB64 从 data:image/...;base64,XXXX 提取裸 base64；纯 base64 原样返回；http(s) 链接暂不支持返回空。
func dataURLToB64(u string) string {
	if strings.HasPrefix(u, "data:") {
		if i := strings.Index(u, ","); i >= 0 {
			b64 := u[i+1:]
			if _, err := base64.StdEncoding.DecodeString(b64); err == nil {
				return b64
			}
		}
		return ""
	}
	if strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") {
		return "" // 远程图片链接暂不支持（需下载，后续可加）
	}
	// 视作裸 base64
	if _, err := base64.StdEncoding.DecodeString(u); err == nil {
		return u
	}
	return ""
}

// buildToolPrompt 工具调用提示词模拟（实验性）：把 tools 定义转成 system 指令，
// 要求模型需要调用工具时只输出特定 JSON。返回注入用的 system 文本（无 tools 则空）。
func buildToolPrompt(tools []json.RawMessage) string {
	if len(tools) == 0 {
		return ""
	}
	var defs []string
	for _, t := range tools {
		defs = append(defs, string(t))
	}
	return "你可以使用以下工具（function）。当且仅当需要调用工具时，只输出一行 JSON，" +
		"格式：{\"tool_call\":{\"name\":\"函数名\",\"arguments\":{...}}}，不要输出任何其他内容；" +
		"否则正常用自然语言回答。可用工具定义：\n" + strings.Join(defs, "\n")
}

// detectToolCall 从模型回复里尝试解析提示词模拟的工具调用。
func detectToolCall(text string) (name, argsJSON string, ok bool) {
	t := strings.TrimSpace(text)
	// 去掉可能的 markdown 围栏
	t = strings.TrimPrefix(t, "```json")
	t = strings.TrimPrefix(t, "```")
	t = strings.TrimSuffix(t, "```")
	t = strings.TrimSpace(t)
	var parsed struct {
		ToolCall struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"tool_call"`
	}
	if json.Unmarshal([]byte(t), &parsed) == nil && parsed.ToolCall.Name != "" {
		return parsed.ToolCall.Name, string(parsed.ToolCall.Arguments), true
	}
	return "", "", false
}

// ChatCompletions —— POST /v1/chat/completions（OpenAI 兼容）。
func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeOpenAIError(w, 401, "未授权", "invalid_request_error")
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	var req oaiChatRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeOpenAIError(w, 400, "请求体解析失败", "invalid_request_error")
		return
	}
	if len(req.Messages) == 0 {
		writeOpenAIError(w, 400, "messages 不能为空", "invalid_request_error")
		return
	}
	modelSlug := strings.TrimSpace(req.Model)
	if modelSlug == "" {
		modelSlug = "auto"
	}

	// 解析 messages → service.ChatMessage；工具定义作为 system 提示注入
	var msgs []service.ChatMessage
	if tp := buildToolPrompt(req.Tools); tp != "" {
		msgs = append(msgs, service.ChatMessage{Role: "system", Text: tp})
	}
	for _, raw := range req.Messages {
		role, text, images := parseOAIMessage(raw)
		msgs = append(msgs, service.ChatMessage{Role: role, Text: text, Images: images})
	}

	// 敏感词（仅检最后一条 user）
	settings, _ := h.MySQL.GetSettings()
	if settings.BannedWords != "" {
		last := ""
		for i := len(msgs) - 1; i >= 0; i-- {
			if msgs[i].Role == "user" {
				last = strings.ToLower(msgs[i].Text)
				break
			}
		}
		for _, word := range strings.Split(settings.BannedWords, ",") {
			word = strings.TrimSpace(strings.ToLower(word))
			if word != "" && last != "" && strings.Contains(last, word) {
				writeOpenAIError(w, 400, "提示词包含违规内容", "invalid_request_error")
				return
			}
		}
	}

	// 令牌桶 + 调度器（一次对话扣 tokens_per_image 个令牌）
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate, maxConcurrent := 50, 3, 1
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
		maxConcurrent = valOr(user.PlanConcurrency, 1)
	}
	cost := valOr(settings.TokensPerImage, 1)
	sched := service.GetScheduler()
	if err := sched.CheckCapacity(uid, 1, maxConcurrent); err != nil {
		writeOpenAIError(w, 429, err.Error(), "rate_limit_error")
		return
	}
	normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost)
	if !okTok {
		writeOpenAIError(w, 429, fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, cost, waitSec), "rate_limit_error")
		return
	}
	if err := sched.Acquire(uid, maxConcurrent); err != nil {
		h.Redis.RefundToken(uid, capacity, refillRate, cost)
		writeOpenAIError(w, 429, err.Error(), "rate_limit_error")
		return
	}
	defer sched.Release(uid)

	svc := service.NewChatGenService(h.MySQL, h.Redis)
	created := time.Now().Unix()
	cmplID := "chatcmpl-" + newReqID()

	if req.Stream {
		h.chatStream(w, r, svc, modelSlug, msgs, cmplID, created, func() {
			h.Redis.RefundToken(uid, capacity, refillRate, cost)
		})
		return
	}
	// 非流式：一次性返回
	full, genErr := svc.Chat(r.Context(), modelSlug, msgs, nil)
	if genErr != nil {
		h.Redis.RefundToken(uid, capacity, refillRate, cost)
		writeOpenAIError(w, 502, genErr.Error(), "upstream_error")
		return
	}
	resp := buildChatCompletion(cmplID, modelSlug, created, full, len(req.Tools) > 0)
	writeJSON(w, 200, resp)
}

// chatStream 以 OpenAI chat.completion.chunk 流式输出。出错（开头即失败）时退款。
func (h *Handler) chatStream(w http.ResponseWriter, r *http.Request, svc *service.ChatGenService, modelSlug string, msgs []service.ChatMessage, id string, created int64, refund func()) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)
	sent := false
	sendChunk := func(delta string, finish string) {
		chunk := map[string]any{
			"id": id, "object": "chat.completion.chunk", "created": created, "model": modelSlug,
			"choices": []map[string]any{{
				"index": 0,
				"delta": func() map[string]any {
					if finish != "" {
						return map[string]any{}
					}
					return map[string]any{"role": "assistant", "content": delta}
				}(),
				"finish_reason": func() any {
					if finish != "" {
						return finish
					}
					return nil
				}(),
			}},
		}
		b, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	_, genErr := svc.Chat(r.Context(), modelSlug, msgs, func(delta string) {
		sent = true
		sendChunk(delta, "")
	})
	if genErr != nil {
		if !sent {
			refund() // 完全没产出才退款
			b, _ := json.Marshal(map[string]any{"error": map[string]any{"message": genErr.Error(), "type": "upstream_error"}})
			fmt.Fprintf(w, "data: %s\n\n", b)
			if flusher != nil {
				flusher.Flush()
			}
			return
		}
	}
	sendChunk("", "stop")
	fmt.Fprint(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// buildChatCompletion 构造非流式 chat.completion 响应；检测到模拟工具调用时填 tool_calls。
func buildChatCompletion(id, modelSlug string, created int64, content string, toolsEnabled bool) map[string]any {
	msg := map[string]any{"role": "assistant", "content": content}
	finish := "stop"
	if toolsEnabled {
		if name, args, ok := detectToolCall(content); ok {
			if args == "" {
				args = "{}"
			}
			msg["content"] = nil
			msg["tool_calls"] = []map[string]any{{
				"id": "call_" + newReqID(), "type": "function",
				"function": map[string]any{"name": name, "arguments": args},
			}}
			finish = "tool_calls"
		}
	}
	return map[string]any{
		"id": id, "object": "chat.completion", "created": created, "model": modelSlug,
		"choices": []map[string]any{{"index": 0, "message": msg, "finish_reason": finish}},
		"usage":   map[string]any{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
	}
}

// ListModelsOpenAI —— GET /v1/models（OpenAI 兼容）。
func (h *Handler) ListModelsOpenAI(w http.ResponseWriter, r *http.Request) {
	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	models, _ := svc.ListModels(r.Context())
	// 账号可用模型 + 已知可调但不在默认列表的（codex 系列）
	slugs := map[string]bool{}
	for _, m := range models {
		slugs[m.Slug] = true
	}
	for _, extra := range []string{"gpt-5-codex", "gpt-5.3-codex", "codex", "codex-mini"} {
		slugs[extra] = true
	}
	var data []map[string]any
	for slug := range slugs {
		data = append(data, map[string]any{
			"id": slug, "object": "model", "created": 0, "owned_by": "openai",
		})
	}
	writeJSON(w, 200, map[string]any{"object": "list", "data": data})
}

// newReqID 生成短随机 id（chatcmpl/call 用）。
func newReqID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
