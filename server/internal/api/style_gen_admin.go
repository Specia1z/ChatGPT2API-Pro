package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// POST /api/admin/style-presets/generate — 风格预设 AI 智能生成
// 输入风格名称，AI 返回 icon/desc/hint，供管理员在新建风格时一键填充。
// 复用 svg_model 与账号池；不扣用户令牌（管理员操作）。
func (h *Handler) AdminGenerateStylePreset(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	var req struct {
		Name string `json:"name"`
	}
	json.Unmarshal(body, &req)
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请先填写风格名称"})
		return
	}
	if len([]rune(req.Name)) > 40 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "风格名称过长"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	if settings == nil || strings.TrimSpace(settings.SVGModel) == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "AI 生成未配置（需后台设置模型）"})
		return
	}

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	res, err := svc.GenerateStylePreset(r.Context(), settings.SVGModel, req.Name)
	if err != nil || res == nil {
		msg := "生成失败，请重试"
		if err != nil && strings.Contains(err.Error(), "拒绝") {
			msg = "内容被模型拒绝，请换个名称"
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: msg})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"icon": res.Icon,
		"desc": res.Desc,
		"hint": res.Hint,
	}})
}
