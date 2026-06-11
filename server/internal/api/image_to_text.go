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

// POST /api/user/image-to-text — 图生文（反推提示词）。
// 上传一张图（裸 base64），用后台已配模型（复用 svg_model）反推出可直接用于生图的中文提示词。
// 消耗 image_to_text_cost 个令牌（0=免费）；失败退令牌。挂限流防爆刷。
func (h *Handler) ImageToText(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	// 参考图 base64 可能较大，放宽到 10MB
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	var req struct {
		ImageB64 string `json:"image_b64"`
	}
	json.Unmarshal(body, &req)
	// 兼容 dataURL：剥掉 data:image/...;base64, 前缀
	req.ImageB64 = strings.TrimSpace(req.ImageB64)
	if i := strings.Index(req.ImageB64, ","); strings.HasPrefix(req.ImageB64, "data:") && i > 0 {
		req.ImageB64 = req.ImageB64[i+1:]
	}
	if req.ImageB64 == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请先上传图片"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	if settings == nil || strings.TrimSpace(settings.SVGModel) == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "图生文功能未配置（需后台设置模型）"})
		return
	}
	modelSlug := settings.SVGModel

	// 令牌消耗（image_to_text_cost，0=免费跳过扣费）
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate := 50, 3
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
	}
	cost := settings.ImageToTextCost
	if cost > 0 {
		normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost)
		if !okTok {
			writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, cost, waitSec)})
			return
		}
	}
	middleware.SetAPICallCost(r, cost, 1)

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	prompt, err := svc.DescribePrompt(r.Context(), modelSlug, req.ImageB64, nil)
	if err != nil || strings.TrimSpace(prompt) == "" {
		if cost > 0 {
			h.Redis.RefundToken(uid, capacity, refillRate, cost)
		}
		msg := "反推失败，请重试"
		if err != nil && strings.Contains(err.Error(), "拒绝") {
			msg = "图片内容被模型拒绝，请更换图片"
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: msg})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"prompt": strings.TrimSpace(prompt),
		"cost":   cost,
	}})
}
