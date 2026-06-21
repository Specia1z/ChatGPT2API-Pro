package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// GET /api/admin/risk/scores — 风险评分排行
func (h *Handler) AdminRiskScores(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	minScore, _ := strconv.Atoi(q.Get("min_score"))
	scores, total, err := h.MySQL.GetRiskScores(page, pageSize, minScore)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "查询失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": scores,
		"total": total,
	}})
}

// GET /api/admin/risk/detail?id= — 单个用户风险详情
func (h *Handler) AdminRiskDetail(w http.ResponseWriter, r *http.Request) {
	uid, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if uid <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	// 从 DB 查评分 + 封禁状态
	var score model.UserRiskScore
	var email string
	var status bool
	var banUntil, banReason, createdAt string
	err := h.MySQL.RawQueryRow(
		`SELECT u.email, r.score_api, r.score_points, r.score_content, r.score_account, r.total_score,
			u.status, COALESCE(DATE_FORMAT(u.ban_until,'%Y-%m-%d %H:%i:%s'),''), COALESCE(u.ban_reason,''),
			COALESCE(DATE_FORMAT(u.created_at,'%Y-%m-%d %H:%i:%s'),'')
		FROM user_risk_scores r JOIN users u ON r.user_id=u.id WHERE r.user_id=?`,
		uid).Scan(&email, &score.ScoreAPI, &score.ScorePoints, &score.ScoreContent, &score.ScoreAccount, &score.TotalScore,
		&status, &banUntil, &banReason, &createdAt)
	if err != nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "无评分记录"})
		return
	}
	score.UserID = uid
	score.Reasons = store.ScoreReasons(score)
	// Redis 实时快照
	snap := h.Redis.GetRiskSnapshot(r.Context(), uid)
	detail := model.RiskDetail{
		UserID:    uid,
		Email:     email,
		Scores:    score,
		Snapshots: snap,
		Banned:    !status,
		BanUntil:  banUntil,
		BanReason: banReason,
		CreatedAt: createdAt,
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: detail})
}

// POST /api/admin/risk/unban — 单独解封
func (h *Handler) AdminRiskUnban(w http.ResponseWriter, r *http.Request) {
	var req struct{ UserID int64 `json:"user_id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.UnbanUser(req.UserID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已解封"})
}

// POST /api/admin/risk/batch-unban — 批量解封低风险用户
func (h *Handler) AdminRiskBatchUnban(w http.ResponseWriter, r *http.Request) {
	var req struct{ MaxScore int `json:"max_score"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.MaxScore <= 0 {
		req.MaxScore = 50
	}
	n, err := h.MySQL.BatchUnbanRisk(req.MaxScore)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"count": n}, Message: fmt.Sprintf("已解封 %d 位用户", n)})
}
