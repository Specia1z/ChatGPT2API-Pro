package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"chatgpt2api-pro/internal/apilog"
	"chatgpt2api-pro/internal/model"
)

// GET /api/admin/api-logs — 全站 API 调用明细（分页，跨用户筛选）
func (h *Handler) AdminListAPILogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	userID, _ := strconv.ParseInt(q.Get("user_id"), 10, 64)
	keyID, _ := strconv.ParseInt(q.Get("key_id"), 10, 64)
	status, _ := strconv.Atoi(q.Get("status"))
	endpoint := q.Get("endpoint")
	email := q.Get("email")

	items, total, err := h.MySQL.GetAllAPICallLogs(userID, email, page, pageSize, endpoint, status, keyID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "查询失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": items,
		"total": total,
	}})
}

// GET /api/admin/api-stats — 全站 API 调用聚合统计
func (h *Handler) AdminAPIStats(w http.ResponseWriter, r *http.Request) {
	minutes := 5
	if m := r.URL.Query().Get("minutes"); m != "" {
		if n, err := strconv.Atoi(m); err == nil && n >= 1 && n <= 1440 {
			minutes = n
		}
	}
	stats, err := h.MySQL.GetAPIStatsGlobal(minutes)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "统计失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}

// GET /api/admin/api-logs/events — SSE 实时推送 API 调用日志
func (h *Handler) AdminAPILogEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	// 首帧：最近 50 条历史
	recent, _ := h.MySQL.GetRecentAPICallLogs(50)
	for _, l := range recent {
		data, _ := json.Marshal(l)
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", data)
	}
	flusher.Flush()

	// 首帧 stats
	if stats, err := h.MySQL.GetAPIStatsGlobal(5); err == nil {
		data, _ := json.Marshal(stats)
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", data)
	}
	flusher.Flush()

	// 订阅实时广播
	ch := apilog.DefaultBroadcaster.Subscribe()
	defer apilog.DefaultBroadcaster.Unsubscribe(ch)

	// stats 更新定时器（每 30 秒）
	statsTicker := time.NewTicker(30 * time.Second)
	defer statsTicker.Stop()

	// 构建实时日志 event：需要附带用户邮箱（查缓存或实时查）
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case record, ok := <-ch:
			if !ok {
				return
			}
			// 构造 enriched log（与 APICallLog 结构一致）
			logData, _ := json.Marshal(map[string]any{
				"user_id":     record.UserID,
				"api_key_id":  record.APIKeyID,
				"endpoint":    record.Endpoint,
				"ip":          record.IP,
				"status_code": record.StatusCode,
				"tokens_cost": record.TokensCost,
				"count":       record.Count,
				"latency_ms":  record.LatencyMs,
				"created_at":  time.Now().Format("2006-01-02 15:04:05"),
			})
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", logData)
			flusher.Flush()
		case <-statsTicker.C:
			if stats, err := h.MySQL.GetAPIStatsGlobal(5); err == nil {
				data, _ := json.Marshal(stats)
				fmt.Fprintf(w, "event: stats\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}
