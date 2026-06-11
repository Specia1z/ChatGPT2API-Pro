package api

import (
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// GET /api/user/api-usage/summary?days=N — API 调用用量概览（按端点/Key 分布 + 每日趋势 + 429）
func (h *Handler) GetAPIUsageSummary(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)

	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n >= 1 && n <= 90 {
			days = n
		}
	}

	sum, err := h.MySQL.GetAPIUsageSummary(userID, days)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取用量概览失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: sum})
}

// GET /api/user/api-usage/logs?page=&page_size=&key_id=&endpoint=&status= — 分页调用明细
func (h *Handler) GetAPIUsageLogs(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.UserIDKey).(int64)
	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	keyID, _ := strconv.ParseInt(q.Get("key_id"), 10, 64)
	status, _ := strconv.Atoi(q.Get("status"))
	endpoint := q.Get("endpoint")

	items, total, err := h.MySQL.GetAPICallLogs(userID, page, pageSize, keyID, endpoint, status)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取调用明细失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": items,
		"total": total,
	}})
}
