package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"

	"golang.org/x/crypto/bcrypt"
)

// GET /api/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := q.Get("search")
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 { page = 1 }
	if pageSize < 1 || pageSize > 100 { pageSize = 20 }

	users, total, err := h.MySQL.ListUsers(search, page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	// 标注 superadmin（按 .env 邮箱实时判定）
	for i := range users {
		users[i].IsSuperAdmin = middleware.IsSuperAdminEmail(users[i].Email)
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": users, "total": total, "page": page, "page_size": pageSize,
	}})
}

// POST /api/admin/users/set-role — 授予/撤销管理员（仅 superadmin）
func (h *Handler) AdminSetUserRole(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID   int64 `json:"id"`
		Role int   `json:"role"` // 0=普通 1=admin
	}
	json.Unmarshal(body, &req)
	if req.ID <= 0 || (req.Role != 0 && req.Role != 1) {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	// 目标用户若为 superadmin（.env 邮箱），不可被降权——其权限不由 DB role 决定
	target, _ := h.MySQL.GetUserByID(req.ID)
	if target == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "用户不存在"})
		return
	}
	if middleware.IsSuperAdminEmail(target.Email) {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "超级管理员权限由配置决定，无法在此修改"})
		return
	}
	if err := h.MySQL.SetUserRole(req.ID, req.Role); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	msg := "已设为管理员"
	if req.Role == 0 {
		msg = "已取消管理员"
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: msg})
}

// POST /api/admin/users/update
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	json.Unmarshal(body, &req)
	if err := h.MySQL.UpdateUser(req.ID, req.Name); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已更新"})
}

// POST /api/admin/users/reset-password
func (h *Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID       int64  `json:"id"`
		Password string `json:"password"`
	}
	json.Unmarshal(body, &req)
	if req.Password == "" {
		b := make([]byte, 8)
		rand.Read(b)
		req.Password = fmt.Sprintf("%x", b)
	} else if len(req.Password) < 6 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "密码至少 6 位"})
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err := h.MySQL.ResetUserPassword(req.ID, string(hash)); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "密码已重置"})
}

// POST /api/admin/users/points
func (h *Handler) AdjustUserPoints(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID    int64 `json:"id"`
		Delta int   `json:"delta"`
	}
	json.Unmarshal(body, &req)
	if req.ID <= 0 || req.Delta == 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	var pts int
	var err error
	if req.Delta < 0 {
		// 扣减：原子钳制不低于 0，余额不足则按现有余额全扣
		var ok bool
		pts, ok, err = h.MySQL.DeductUserPoints(req.ID, -req.Delta, "admin", "管理员调整")
		if err == nil && !ok {
			// 余额不足请求扣减量：扣到 0
			if pts > 0 { pts, _, err = h.MySQL.DeductUserPoints(req.ID, pts, "admin", "管理员调整") }
		}
	} else {
		pts, err = h.MySQL.AddUserPoints(req.ID, req.Delta, "admin", "管理员调整")
	}
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"points": pts,
		"delta":  req.Delta,
		"action": fmt.Sprintf("%+d", req.Delta),
	}})
}

// POST /api/admin/users/toggle-status
func (h *Handler) ToggleUserStatus(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct{ ID int64 `json:"id"`; Reason string `json:"reason"` }
	json.Unmarshal(body, &req)
	if err := h.MySQL.ToggleUserStatus(req.ID, req.Reason); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已切换"})
}

// POST /api/admin/users/subscription — 管理员为已有用户开通/续期/清除套餐
func (h *Handler) AdminSetUserSubscription(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID     int64  `json:"id"`
		PlanID int    `json:"plan_id"`
		Days   int    `json:"days"`
		Mode   string `json:"mode"` // renew | set | clear
	}
	json.Unmarshal(body, &req)
	if req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if req.Mode == "" {
		req.Mode = "renew"
	}
	if req.Mode != "clear" {
		// 校验套餐存在
		if req.PlanID <= 0 {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请选择套餐"})
			return
		}
		plan, _ := h.MySQL.GetPlanByID(req.PlanID)
		if plan == nil {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐不存在"})
			return
		}
		// days<=0 时从套餐默认有效期读取（0 代表永久）
		if req.Days <= 0 {
			req.Days = plan.DurationDays
		}
	}
	if err := h.MySQL.AdminSetUserSubscription(req.ID, req.PlanID, req.Days, req.Mode); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "订阅已更新"})
}

// POST /api/admin/users/create
func (h *Handler) AdminCreateUser(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Name         string `json:"name"`
		Points       int    `json:"points"`
		PlanID       int    `json:"plan_id"`
		DurationDays int    `json:"duration_days"`
	}
	json.Unmarshal(body, &req)

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "邮箱和密码不能为空"})
		return
	}

	existing, _ := h.MySQL.GetUserByEmail(req.Email)
	if existing != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "该邮箱已注册"})
		return
	}

	if req.PlanID > 0 {
		plan, _ := h.MySQL.GetPlanByID(req.PlanID)
		if plan == nil {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "套餐不存在"})
			return
		}
	}

	// 如果指定了 duration_days 但没有指定 plan_id，不允许
	if req.DurationDays > 0 && req.PlanID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请先选择套餐"})
		return
	}

	// 如果指定了 plan_id 但没有指定 duration_days，从套餐读取
	durationDays := req.DurationDays
	if req.PlanID > 0 && durationDays <= 0 {
		plan, _ := h.MySQL.GetPlanByID(req.PlanID)
		if plan != nil {
			durationDays = plan.DurationDays
		}
	}

	if req.Points < 0 {
		req.Points = 0
	}
	if req.PlanID <= 0 {
		req.PlanID = 0
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	id, err := h.MySQL.CreateUserWithDetails(req.Email, string(hash), req.Name, req.Points, req.PlanID, durationDays)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}

	// 自动创建默认 API Key
	h.MySQL.CreateAPIKey(id, "Default")

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "用户创建成功", Data: map[string]any{"id": id}})
}
