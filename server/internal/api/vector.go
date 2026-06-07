package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// GET /api/admin/models — 管理员拉取号池账号可用的对话模型列表（用于后台选 svg_model）
func (h *Handler) AdminListModels(w http.ResponseWriter, r *http.Request) {
	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	models, err := svc.ListModels(r.Context())
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: models})
}

// POST /api/vector — 用户用后台配置的模型生成 SVG（SSE 流式逐字返回）。
// 复用令牌桶（每次扣 tokens_per_image，失败退款）+ 调度器并发位。
func (h *Handler) CreateVector(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req struct {
		Prompt string `json:"prompt"`
	}
	json.Unmarshal(body, &req)
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "提示词不能为空"})
		return
	}
	if len(req.Prompt) > 2000 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "提示词超长（≤2000）"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	svgModel := strings.TrimSpace(settings.SVGModel)
	if svgModel == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "AI 矢量生成未启用"})
		return
	}
	// 敏感词
	if settings.BannedWords != "" {
		lp := strings.ToLower(req.Prompt)
		for _, word := range strings.Split(settings.BannedWords, ",") {
			word = strings.TrimSpace(strings.ToLower(word))
			if word != "" && strings.Contains(lp, word) {
				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "提示词包含违规内容"})
				return
			}
		}
	}

	// 套餐令牌参数 + 每次消耗
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate, maxConcurrent := 50, 3, 1
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
		maxConcurrent = valOr(user.PlanConcurrency, 1)
	}
	cost := valOr(settings.TokensPerImage, 1)

	// 调度器并发预检
	sched := service.GetScheduler()
	if err := sched.CheckCapacity(uid, 1, maxConcurrent); err != nil {
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: err.Error()})
		return
	}
	// 令牌桶消耗
	normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost)
	if !okTok {
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, cost, waitSec)})
		return
	}

	// 记录
	genID, err := h.MySQL.CreateSVGGeneration(uid, req.Prompt, svgModel)
	if err != nil {
		h.Redis.RefundToken(uid, capacity, refillRate, cost)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建记录失败"})
		return
	}

	// SSE 流式输出
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)
	sendEvent := func(event string, payload any) {
		b, _ := json.Marshal(payload)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if err := sched.Acquire(uid, maxConcurrent); err != nil {
		h.Redis.RefundToken(uid, capacity, refillRate, cost)
		h.MySQL.UpdateSVGGeneration(genID, "", "failed", err.Error())
		sendEvent("error", map[string]string{"message": err.Error()})
		return
	}
	defer sched.Release(uid)

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	full, genErr := svc.GenerateSVG(r.Context(), svgModel, req.Prompt, func(delta string) {
		sendEvent("delta", map[string]string{"text": delta})
	})
	if genErr != nil {
		h.Redis.RefundToken(uid, capacity, refillRate, cost)
		h.MySQL.UpdateSVGGeneration(genID, "", "failed", genErr.Error())
		sendEvent("error", map[string]string{"message": genErr.Error()})
		return
	}

	svg := extractSVG(full)
	h.MySQL.UpdateSVGGeneration(genID, svg, "completed", "")
	sendEvent("done", map[string]any{"id": genID, "svg": svg, "raw": full})
}

// GET /api/vector — 用户的 AI 矢量历史（分页）
func (h *Handler) ListVector(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}
	items, total, err := h.MySQL.GetUserSVGGenerations(uid, page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if items == nil {
		items = []model.Generation{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": items, "total": total, "page": page, "page_size": pageSize}})
}

// DELETE /api/vector — 删除一条矢量历史（复用 DeleteUserGeneration，带 user_id 防越权）
func (h *Handler) DeleteVector(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	var req struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(body, &req)
	if req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.DeleteUserGeneration(req.ID, uid); err != nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "记录不存在或无权删除"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}

// extractSVG 从模型回复里抽出 <svg>...</svg>（去掉 markdown 围栏/解释文字）；找不到则原样返回。
func extractSVG(s string) string {
	lo := strings.Index(s, "<svg")
	hi := strings.LastIndex(s, "</svg>")
	if lo >= 0 && hi > lo {
		return s[lo : hi+len("</svg>")]
	}
	return strings.TrimSpace(s)
}
