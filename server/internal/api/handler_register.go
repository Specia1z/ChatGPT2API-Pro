package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
)

// ── Register SSE ─────────────────────────────────────

func (h *Handler) RegisterEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	// 先发当前统计
	stats := service.GetRegisterBroker().GetStats()
	statsData, _ := json.Marshal(stats)
	fmt.Fprintf(w, "event: stats\ndata: %s\n\n", statsData)
	flusher.Flush()

	// 只发最近 20 条历史日志
	allLogs := service.GetRegisterBroker().GetLogs()
	if len(allLogs) > 20 {
		allLogs = allLogs[len(allLogs)-20:]
	}
	for _, l := range allLogs {
		data, _ := json.Marshal(l)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

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

// ── Register ────────────────────────────────────────────

func (h *Handler) GetRegisterConfig(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetRegisterConfig()
	// 过滤敏感字段
	for i := range cfg.Mail {
		cfg.Mail[i].AdminPassword = ""
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) SaveRegisterConfig(w http.ResponseWriter, r *http.Request) {
	var cfg model.RegisterConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.SaveRegisterConfig(&cfg); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	log.Printf("[register] saved config: threads=%d total=%d proxy=%s enabled=%v", cfg.Threads, cfg.Total, cfg.Proxy, cfg.Enabled)

	// 根据 enabled 状态启停注册机
	if cfg.Enabled {
		service.StartRegister(&cfg, func(acc *model.Account) {
			h.MySQL.AddAccounts([]string{acc.AccessToken}, "web")
			// 注册成功后自动刷新账号信息
			go func() {
				proxy := cfg.Proxy
				if err := service.RefreshAccount(acc, proxy); err == nil {
					h.MySQL.UpdateAccountByToken(acc)
					service.GetRegisterBroker().Log(
						fmt.Sprintf("📊 账号信息: %s 配额=%d 状态=%s", acc.PlanType, acc.Quota, acc.Status),
						"green", acc.Email, 0)
				}
			}()
		}, func() (int, int) {
			stats, _ := h.MySQL.GetAccountStats()
			return stats.TotalQuota, stats.Active
		})
	} else {
		service.StopRegister()
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}
