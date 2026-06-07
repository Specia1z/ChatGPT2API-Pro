package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
)

// ── OpenAI Responses API 兼容层 ──────────────────────────────
// POST /v1/responses —— 新版 Responses API（codex CLI / Agents SDK 默认走此端点）。
// 请求与 chat/completions 不同：input(字符串或消息数组) + instructions(系统提示)。
// 响应：{id, object:"response", status, output:[{type:"message", role:"assistant",
//        content:[{type:"output_text", text}]}], output_text}。
// 复用底层 ChatGenService（含多轮上下文折叠、号池、令牌桶）。

type oaiResponsesRequest struct {
	Model        string          `json:"model"`
	Input        json.RawMessage `json:"input"`        // string | []message
	Instructions string          `json:"instructions"` // 系统提示（可选）
	Stream       bool            `json:"stream"`
}

// parseResponsesInput 解析 input：可能是纯字符串，或消息数组（结构同 chat，content 可为
// 字符串或 parts 数组，parts 里 input_text/input_image）。返回 service.ChatMessage 列表。
func parseResponsesInput(raw json.RawMessage) []service.ChatMessage {
	// 形态一：纯字符串
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []service.ChatMessage{{Role: "user", Text: s}}
	}
	// 形态二：消息数组
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) != nil {
		return nil
	}
	var out []service.ChatMessage
	for _, item := range arr {
		var m struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if json.Unmarshal(item, &m) != nil {
			continue
		}
		role := m.Role
		if role == "" {
			role = "user"
		}
		// content 为字符串
		var cs string
		if json.Unmarshal(m.Content, &cs) == nil {
			out = append(out, service.ChatMessage{Role: role, Text: cs})
			continue
		}
		// content 为 parts 数组（Responses 用 input_text / input_image / output_text）
		var parts []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL string `json:"image_url"`
		}
		if json.Unmarshal(m.Content, &parts) == nil {
			var sb strings.Builder
			var imgs []string
			for _, p := range parts {
				switch p.Type {
				case "input_text", "output_text", "text":
					sb.WriteString(p.Text)
				case "input_image", "image_url":
					if b64 := dataURLToB64(p.ImageURL); b64 != "" {
						imgs = append(imgs, b64)
					}
				}
			}
			out = append(out, service.ChatMessage{Role: role, Text: sb.String(), Images: imgs})
		}
	}
	return out
}

// Responses —— POST /v1/responses（OpenAI Responses API 兼容）。
func (h *Handler) Responses(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeOpenAIError(w, 401, "未授权", "invalid_request_error")
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	var req oaiResponsesRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeOpenAIError(w, 400, "请求体解析失败", "invalid_request_error")
		return
	}
	msgs := parseResponsesInput(req.Input)
	if len(msgs) == 0 {
		writeOpenAIError(w, 400, "input 不能为空", "invalid_request_error")
		return
	}
	if strings.TrimSpace(req.Instructions) != "" {
		msgs = append([]service.ChatMessage{{Role: "system", Text: req.Instructions}}, msgs...)
	}
	modelSlug := strings.TrimSpace(req.Model)
	if modelSlug == "" {
		modelSlug = "auto"
	}

	settings, _ := h.MySQL.GetSettings()
	refund, acqErr := h.acquireChatSlot(uid, settings)
	if acqErr != nil {
		writeOpenAIError(w, 429, acqErr.Error(), "rate_limit_error")
		return
	}
	defer service.GetScheduler().Release(uid)

	svc := service.NewChatGenService(h.MySQL, h.Redis)
	respID := "resp_" + newReqID()
	created := time.Now().Unix()

	if req.Stream {
		h.responsesStream(w, r, svc, modelSlug, msgs, respID, created, refund)
		return
	}
	full, genErr := svc.Chat(r.Context(), modelSlug, msgs, nil)
	if genErr != nil {
		refund()
		writeOpenAIError(w, 502, genErr.Error(), "upstream_error")
		return
	}
	writeJSON(w, 200, buildResponsesObject(respID, modelSlug, created, cleanReply(full), "completed"))
}

// buildResponsesObject 构造 Responses 非流式响应对象。
func buildResponsesObject(id, modelSlug string, created int64, text, status string) map[string]any {
	return map[string]any{
		"id": id, "object": "response", "created_at": created, "status": status, "model": modelSlug,
		"output": []map[string]any{{
			"type": "message", "id": "msg_" + newReqID(), "role": "assistant", "status": "completed",
			"content": []map[string]any{{"type": "output_text", "text": text, "annotations": []any{}}},
		}},
		"output_text": text,
	}
}

// responsesStream 以 Responses 流式事件输出（response.output_text.delta + response.completed）。
func (h *Handler) responsesStream(w http.ResponseWriter, r *http.Request, svc *service.ChatGenService, modelSlug string, msgs []service.ChatMessage, id string, created int64, refund func()) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)
	send := func(event string, obj any) {
		b, _ := json.Marshal(obj)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
		if flusher != nil {
			flusher.Flush()
		}
	}
	// 起始事件
	send("response.created", map[string]any{"type": "response.created", "response": buildResponsesObject(id, modelSlug, created, "", "in_progress")})

	var full strings.Builder
	sent := false
	_, genErr := svc.Chat(r.Context(), modelSlug, msgs, func(delta string) {
		sent = true
		full.WriteString(delta)
		send("response.output_text.delta", map[string]any{"type": "response.output_text.delta", "delta": delta})
	})
	if genErr != nil && !sent {
		refund()
		send("response.failed", map[string]any{"type": "response.failed", "response": map[string]any{"id": id, "status": "failed", "error": map[string]any{"message": genErr.Error()}}})
		return
	}
	text := cleanReply(full.String())
	send("response.completed", map[string]any{"type": "response.completed", "response": buildResponsesObject(id, modelSlug, created, text, "completed")})
}
