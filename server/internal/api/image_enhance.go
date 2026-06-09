package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// POST /api/user/image-enhance — 一键智能增强（两步法第一步：看图诊断）。
// 用视觉模型(svg_model)审视图片、诊断不足，返回一段针对性的中文重构提示词；
// 前端拿此提示词 + 原图走 /api/generations 图生图出增强版（生图按 tokens_per_image 计费）。
// 本接口只做诊断（一次视觉对话），不单独计费、不建记录。挂限流防爆刷。
func (h *Handler) ImageEnhanceDiagnose(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	_ = uid
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	var req struct {
		ImageB64 string `json:"image_b64"`
	}
	json.Unmarshal(body, &req)
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
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "智能增强未配置（需后台设置模型）"})
		return
	}

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	prompt, err := svc.EnhanceDiagnose(r.Context(), settings.SVGModel, req.ImageB64)
	if err != nil || strings.TrimSpace(prompt) == "" {
		msg := "智能诊断失败，请重试"
		if err != nil && strings.Contains(err.Error(), "拒绝") {
			msg = "图片内容被模型拒绝，请更换图片"
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: msg})
		return
	}
	prompt = strings.TrimSpace(prompt)

	// 后台若配置了额外的全局增强指令，追加到 AI 诊断结果之后（叠加生效）
	if extra := strings.TrimSpace(settings.ImageEnhancePrompt); extra != "" {
		prompt = prompt + "。" + extra
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"prompt": prompt,
	}})
}
