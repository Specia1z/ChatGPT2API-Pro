package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// ── Monitor ────────────────────────────────────────────

func (h *Handler) GetMonitorConfig(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetMonitorConfig()
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) SaveMonitorConfig(w http.ResponseWriter, r *http.Request) {
	var cfg model.MonitorConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	h.MySQL.SaveMonitorConfig(&cfg)

	// 根据 enabled 状态启停监控
	if cfg.Enabled {
		service.GetMonitor(h.MySQL).Start()
	} else {
		service.GetMonitor(h.MySQL).Stop()
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) TriggerMonitor(w http.ResponseWriter, r *http.Request) {
	mon := service.GetMonitor(h.MySQL)
	if mon.IsRunning() {
		writeJSON(w, 200, model.APIResponse{Code: 200, Message: "检查已在进行中，请稍后再试"})
		return
	}
	mon.RunOnce()
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已触发健康检查"})
}

// GET /api/monitor/events — 监控事件 SSE
func (h *Handler) MonitorEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	// 先发当前的监控状态
	mon := service.GetMonitor()
	if mon != nil {
		statusData, _ := json.Marshal(map[string]any{
			"running": mon.IsRunning(),
			"time":    time.Now().Format("15:04:05"),
		})
		fmt.Fprintf(w, "event: status\ndata: %s\n\n", statusData)
		flusher.Flush()
	}

	// 发最近的历史日志
	allLogs := service.GetRegisterBroker().GetLogs()
	// 只取最近 50 条
	if len(allLogs) > 50 {
		allLogs = allLogs[len(allLogs)-50:]
	}
	for _, l := range allLogs {
		data, _ := json.Marshal(l)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// 订阅实时日志
	ch := service.GetRegisterBroker().Subscribe()
	defer service.GetRegisterBroker().Unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case entry, ok := <-ch:
			if !ok {
				return
			}
			if entry.Level == "__stats__" {
				fmt.Fprintf(w, "event: stats\ndata: %s\n\n", entry.Text)
			} else {
				data, _ := json.Marshal(entry)
				fmt.Fprintf(w, "data: %s\n\n", data)
			}
			flusher.Flush()
		}
	}
}
