package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// GET /api/admin/risk/profile?id= — 用户风险画像聚合（多维信号，供人工研判）
func (h *Handler) AdminRiskProfile(w http.ResponseWriter, r *http.Request) {
	uid, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if uid <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	profile, err := h.MySQL.GetUserRiskProfile(r.Context(), h.Redis, uid)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "查询失败"})
		return
	}
	if profile == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	// 附带 AI 开关状态，供前端决定是否展示「AI 分析」按钮
	aiEnabled := false
	if settings, _ := h.MySQL.GetSettings(); settings != nil {
		aiEnabled = model.ParseRiskConfig(settings.RiskConfigJSON).AIScoringEnabled
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"profile":    profile,
		"ai_enabled": aiEnabled,
	}})
}

// POST /api/admin/risk/ai-analyze — 对单个用户执行 AI 风险分析（按需，仅建议不处置）
// 需后台开启 ai_scoring_enabled；复用 svg_model + 账号池；不扣令牌。
func (h *Handler) AdminRiskAIAnalyze(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	var req struct {
		UserID int64 `json:"user_id"`
	}
	json.Unmarshal(body, &req)
	if req.UserID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	if settings == nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "配置读取失败"})
		return
	}
	rc := model.ParseRiskConfig(settings.RiskConfigJSON)
	if !rc.AIScoringEnabled {
		writeJSON(w, 403, model.APIResponse{Code: 403, Message: "AI 智能风控未开启（系统设置 → 风险评分）"})
		return
	}
	if strings.TrimSpace(settings.SVGModel) == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "AI 分析未配置（需后台设置模型）"})
		return
	}

	profile, err := h.MySQL.GetUserRiskProfile(r.Context(), h.Redis, req.UserID)
	if err != nil || profile == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	res, aerr := svc.AnalyzeUserRisk(r.Context(), settings.SVGModel, profile)
	if aerr != nil || res == nil {
		msg := "AI 分析失败，请重试"
		if aerr != nil && strings.Contains(aerr.Error(), "拒绝") {
			msg = "内容被模型拒绝"
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: msg})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"score":   res.Score,
		"level":   res.Level,
		"reason":  res.Reason,
		"verdict": res.Verdict,
	}})
}
