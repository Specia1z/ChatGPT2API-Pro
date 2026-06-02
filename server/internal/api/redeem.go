package api

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

/* ── Code generation ──────────────────────────── */

const redeemCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generateRedeemCode() string {
	parts := make([]string, 4)
	for i := range parts {
		b := make([]byte, 4)
		for j := range b {
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(redeemCharset))))
			b[j] = redeemCharset[n.Int64()]
		}
		parts[i] = string(b)
	}
	return strings.Join(parts, "-")
}

/* ── Admin: Generate codes ────────────────────── */

func (h *Handler) GenerateRedeemCodes(w http.ResponseWriter, r *http.Request) {
	var req model.GenerateRedeemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	if req.Count <= 0 || req.Count > 100 {
		req.Count = 1
	}
	if req.Type != "plan" && req.Type != "points" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "type 必须是 plan 或 points"})
		return
	}
	if req.Type == "plan" && req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "plan_id 不能为空"})
		return
	}
	if req.Type == "points" && req.Points <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "points 必须大于 0"})
		return
	}
	if req.PlanDurationDays < 0 {
		req.PlanDurationDays = 0
	}
	if req.ExpiresInHours < 0 {
		req.ExpiresInHours = 0
	}
	if req.MaxUses <= 0 {
		req.MaxUses = 1
	}

	adminID, _ := r.Context().Value(middleware.AdminIDKey).(int64)

	codes := make([]string, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		code := generateRedeemCode()
		_, err := h.MySQL.CreateRedeemCode(code, &req, adminID)
		if err != nil {
			continue
		}
		codes = append(codes, code)
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"codes": codes,
		"count": len(codes),
	}})
}

/* ── Admin: List redeem codes ─────────────────── */

func (h *Handler) ListRedeemCodes(w http.ResponseWriter, r *http.Request) {
	codes, err := h.MySQL.ListRedeemCodes()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if codes == nil {
		codes = []model.RedeemCode{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": codes,
		"total": len(codes),
	}})
}

/* ── Admin: Disable a code ────────────────────── */

func (h *Handler) DisableRedeemCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if err := h.MySQL.DisableRedeemCode(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "操作失败"})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已禁用"})
}

/* ── Admin: Get redeem logs for a code ─────────── */

func (h *Handler) GetRedeemLogs(w http.ResponseWriter, r *http.Request) {
	codeIDStr := r.URL.Query().Get("code_id")
	if codeIDStr == "" {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": []model.RedeemLog{}}})
		return
	}
	codeID, err := strconv.ParseInt(codeIDStr, 10, 64)
	if err != nil {
		writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": []model.RedeemLog{}}})
		return
	}
	logs, err := h.MySQL.GetRedeemLogsByCode(codeID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if logs == nil {
		logs = []model.RedeemLog{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": logs}})
}

/* ── User: Redeem a code ──────────────────────── */

func (h *Handler) RedeemCode(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.UserIDKey).(int64)

	var req model.RedeemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请输入兑换码"})
		return
	}

	code := strings.ToUpper(strings.TrimSpace(req.Code))

	// 1. 查找兑换码（仅用于获取 ID 和存在性）
	rc, err := h.MySQL.GetRedeemCodeByCode(code)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "系统错误"})
		return
	}
	if rc == nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "兑换码无效"})
		return
	}

	// 2. 原子完成兑换（检查 + 消费 + 权益 + 日志）
	rtype, value, err := h.MySQL.CompleteRedeem(rc.ID, userID, code)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "系统错误"})
		return
	}
	if rtype == "" {
		// 统一错误消息，不泄露兑换码状态
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "兑换码无效"})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "兑换成功", Data: map[string]string{
		"type":  rtype,
		"value": value,
	}})
}

/* ── User: Redeem history ─────────────────────── */

func (h *Handler) UserRedeemHistory(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.UserIDKey).(int64)
	logs, err := h.MySQL.GetRedeemLogsByUser(userID)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "获取失败"})
		return
	}
	if logs == nil {
		logs = []model.RedeemLog{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": logs,
		"total": len(logs),
	}})
}
