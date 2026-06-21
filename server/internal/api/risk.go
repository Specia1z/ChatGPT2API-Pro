package api

import (
	"net/http"
	"strconv"

	"chatgpt2api-pro/internal/model"
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
	// 从 DB 查评分
	var score model.UserRiskScore
	var email string
	err := h.MySQL.RawQueryRow(
		"SELECT u.email, r.score_api, r.score_points, r.score_content, r.score_account, r.total_score FROM user_risk_scores r JOIN users u ON r.user_id=u.id WHERE r.user_id=?",
		uid).Scan(&email, &score.ScoreAPI, &score.ScorePoints, &score.ScoreContent, &score.ScoreAccount, &score.TotalScore)
	if err != nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "无评分记录"})
		return
	}
	score.UserID = uid
	// Redis 实时快照
	snap := h.Redis.GetRiskSnapshot(r.Context(), uid)
	detail := model.RiskDetail{
		UserID:    uid,
		Email:     email,
		Scores:    score,
		Snapshots: snap,
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: detail})
}
