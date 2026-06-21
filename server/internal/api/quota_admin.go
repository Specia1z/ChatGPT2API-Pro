package api

import (
	"net/http"
	"sort"

	"chatgpt2api-pro/internal/model"
)

// QuotaHitItem 撞额名单条目。
type QuotaHitItem struct {
	UserID    int64  `json:"user_id"`
	Email     string `json:"email"`
	PlanName  string `json:"plan_name"`
	Quota     int    `json:"quota"`
	Used      int    `json:"used"`
	Pct       int    `json:"pct"` // 已用/配额 百分比
}

// KeyIPAlertItem 单 Key 多 IP 告警条目。
type KeyIPAlertItem struct {
	KeyID   int64  `json:"key_id"`
	UserID  int64  `json:"user_id"`
	KeyName string `json:"key_name"`
	Email   string `json:"email"`
	IPCount int    `json:"ip_count"`
}

// GET /api/admin/quota/alerts — 撞额名单 + 单 Key 多 IP 告警（仅观测，不自动处置）
func (h *Handler) AdminQuotaAlerts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 阈值：单 Key 多 IP 告警线（后台 RiskConfig 可调）
	ipThreshold := 50
	if settings, _ := h.MySQL.GetSettings(); settings != nil {
		rc := model.ParseRiskConfig(settings.RiskConfigJSON)
		if rc.KeyIPAlertThreshold > 0 {
			ipThreshold = rc.KeyIPAlertThreshold
		}
	}

	// ── 撞额名单：仅扫描有配额套餐的活跃用户，逐个比对 Redis 本月用量 ──
	hits := []QuotaHitItem{}
	if users, err := h.MySQL.ListQuotaPlanUsers(); err == nil {
		for _, u := range users {
			used := h.Redis.GetMonthlyUsage(ctx, u.UserID)
			if used >= u.MonthlyQuota {
				pct := 100
				if u.MonthlyQuota > 0 {
					pct = used * 100 / u.MonthlyQuota
				}
				hits = append(hits, QuotaHitItem{
					UserID: u.UserID, Email: u.Email, PlanName: u.PlanName,
					Quota: u.MonthlyQuota, Used: used, Pct: pct,
				})
			}
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].Pct > hits[j].Pct })

	// ── 多 IP 告警：扫描启用中的 API Key，逐个查 24h 去重 IP 数 ──
	ipAlerts := []KeyIPAlertItem{}
	if keys, err := h.MySQL.ListEnabledAPIKeys(); err == nil {
		for _, k := range keys {
			n := h.Redis.GetKeyIPCount(ctx, k.KeyID)
			if n >= ipThreshold {
				ipAlerts = append(ipAlerts, KeyIPAlertItem{
					KeyID: k.KeyID, UserID: k.UserID, KeyName: k.KeyName, Email: k.Email, IPCount: n,
				})
			}
		}
	}
	sort.Slice(ipAlerts, func(i, j int) bool { return ipAlerts[i].IPCount > ipAlerts[j].IPCount })

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"quota_hits":    hits,
		"ip_alerts":     ipAlerts,
		"ip_threshold":  ipThreshold,
	}})
}
