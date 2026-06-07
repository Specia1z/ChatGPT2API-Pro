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
	"chatgpt2api-pro/internal/model"
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

// buildToolPrompt 工具调用提示词模拟（实验性）：强约束指令，尽量逼模型输出约定 JSON。
// 网页版模型默认倾向"我没有外部工具"，故这里用命令式 + 禁止退路 + 输出示例提高命中率。
func buildToolPrompt(tools []json.RawMessage) string {
	if len(tools) == 0 {
		return ""
	}
	var defs []string
	for _, t := range tools {
		defs = append(defs, string(t))
	}
	return "【强制规则·最高优先级】本会话已接入下列外部函数（function/tool），由调用方在你的回复之外负责执行。\n" +
		"你必须把这些函数当作真实可用。当用户的请求需要其中任一函数才能完成时，" +
		"你【只能】输出一行严格的 JSON，不得有任何其他文字、解释、寒暄或代码块标记：\n" +
		"{\"tool_call\":{\"name\":\"<函数名>\",\"arguments\":{<参数对象>}}}\n" +
		"硬性要求：\n" +
		"1. 禁止说“我无法访问/我没有该工具/请你提供”之类的话——这些函数确实可用，调用方会执行并把结果回传给你。\n" +
		"2. 禁止使用你自己的联网搜索或内置能力来替代这些函数。\n" +
		"3. 需要调用时，整个回复就是那一行 JSON，不要加 ```、不要加说明。\n" +
		"4. 只有当请求完全不需要任何函数时，才用自然语言正常回答。\n" +
		"可用函数定义（JSON Schema）：\n" + strings.Join(defs, "\n")
}

// detectToolCall 从模型回复里尝试解析提示词模拟的工具调用。
// 容错：去 markdown 围栏；若混在文字中，截取第一个含 "tool_call" 的 {...} 子串再解析。
func detectToolCall(text string) (name, argsJSON string, ok bool) {
	t := strings.TrimSpace(text)
	t = strings.TrimPrefix(t, "```json")
	t = strings.TrimPrefix(t, "```")
	t = strings.TrimSuffix(t, "```")
	t = strings.TrimSpace(t)

	try := func(s string) (string, string, bool) {
		var parsed struct {
			ToolCall struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"tool_call"`
		}
		if json.Unmarshal([]byte(s), &parsed) == nil && parsed.ToolCall.Name != "" {
			return parsed.ToolCall.Name, string(parsed.ToolCall.Arguments), true
		}
		return "", "", false
	}
	if n, a, k := try(t); k {
		return n, a, k
	}
	// 兜底：从含 tool_call 的位置向后做花括号配平，截 JSON 子串
	idx := strings.Index(t, "\"tool_call\"")
	if idx < 0 {
		return "", "", false
	}
	start := strings.LastIndex(t[:idx], "{")
	if start < 0 {
		return "", "", false
	}
	depth := 0
	for i := start; i < len(t); i++ {
		switch t[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return try(t[start : i+1])
			}
		}
	}
	return "", "", false
}

// cleanReply 清理网页版内部标记：引用标注 citeturnXXX、不可见占位符等，避免漏进 API 文本。
func cleanReply(s string) string {
	// 移除 citeturn... / turnXsearchX 等引用标记（出现在联网搜索回复里）
	for _, marker := range []string{"citeturn", "turn0search", "turn1search", "turn2search"} {
		for {
			i := strings.Index(s, marker)
			if i < 0 {
				break
			}
			// 标记到下一个 ASCII 空白为止（citeturn... 标记体均为 ASCII）
			j := i
			for j < len(s) && s[j] != ' ' && s[j] != '\n' && s[j] != '\t' && s[j] != '.' && s[j] != ',' {
				j++
			}
			s = s[:i] + s[j:]
		}
	}
	// 去掉私有 Unicode 区的不可见占位符（网页版偶发的 -）
	var b strings.Builder
	for _, r := range s {
		if r >= 0xE000 && r <= 0xF8FF {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// acquireChatSlot 为一次对话占用令牌桶 + 调度并发位（chat/responses 共用）。
// 成功返回 refund（出错时退令牌用）；失败返回错误。调用方需 defer GetScheduler().Release(uid)。
func (h *Handler) acquireChatSlot(uid int64, settings *model.Settings) (func(), error) {
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate, maxConcurrent := 50, 3, 1
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
		maxConcurrent = valOr(user.PlanConcurrency, 1)
	}
	cost := 1
	if settings != nil {
		cost = valOr(settings.TokensPerImage, 1)
	}
	sched := service.GetScheduler()
	if err := sched.CheckCapacity(uid, 1, maxConcurrent); err != nil {
		return nil, err
	}
	normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost)
	if !okTok {
		return nil, fmt.Errorf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, cost, waitSec)
	}
	refund := func() { h.Redis.RefundToken(uid, capacity, refillRate, cost) }
	if err := sched.Acquire(uid, maxConcurrent); err != nil {
		refund()
		return nil, err
	}
	return refund, nil
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
	refund, acqErr := h.acquireChatSlot(uid, settings)
	if acqErr != nil {
		writeOpenAIError(w, 429, acqErr.Error(), "rate_limit_error")
		return
	}
	defer service.GetScheduler().Release(uid)

	svc := service.NewChatGenService(h.MySQL, h.Redis)
	created := time.Now().Unix()
	cmplID := "chatcmpl-" + newReqID()

	if req.Stream {
		h.chatStream(w, r, svc, modelSlug, msgs, cmplID, created, refund)
		return
	}
	// 非流式：一次性返回
	full, genErr := svc.Chat(r.Context(), modelSlug, msgs, nil)
	if genErr != nil {
		refund()
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
	content = cleanReply(content)
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
