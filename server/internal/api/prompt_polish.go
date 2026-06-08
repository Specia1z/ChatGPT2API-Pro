package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// POST /api/user/prompt/polish — 提示词润色。
// 调后台已配模型（复用 svg_model）把简短描述扩写成专业提示词。
// 消耗 prompt_polish_cost 个令牌（0=免费）；失败退令牌。挂限流防爆刷。
func (h *Handler) PolishPrompt(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req struct {
		Prompt string `json:"prompt"`
		Style  string `json:"style"` // 用户已选风格 label（可空，用于风格联动）
	}
	json.Unmarshal(body, &req)
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请先输入描述"})
		return
	}
	if len(req.Prompt) > 1000 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "描述过长（≤1000）"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	if settings == nil || strings.TrimSpace(settings.SVGModel) == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "润色功能未配置（需后台设置模型）"})
		return
	}
	model_ := settings.SVGModel

	// 令牌消耗（prompt_polish_cost，0=免费跳过扣费）
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate := 50, 3
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
	}
	cost := settings.PromptPolishCost
	if cost > 0 {
		normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost)
		if !okTok {
			writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, cost, waitSec)})
			return
		}
	}

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	polished, err := svc.PolishPrompt(r.Context(), model_, req.Prompt, req.Style)
	if err != nil || strings.TrimSpace(polished) == "" {
		// 润色失败：退还已扣令牌
		if cost > 0 {
			h.Redis.RefundToken(uid, capacity, refillRate, cost)
		}
		msg := "润色失败，请重试"
		if err != nil && strings.Contains(err.Error(), "拒绝") {
			msg = "内容被模型拒绝，请调整描述"
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: msg})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"prompt": polished,
		"cost":   cost,
	}})
}
