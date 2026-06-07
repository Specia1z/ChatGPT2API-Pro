package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"

	"golang.org/x/crypto/bcrypt"
)

// Login 旧的独立管理员登录（基于 admins 表）。
// Deprecated: 管理员登录已统一到 /api/auth/login（按 users.role / .env SUPERADMIN_EMAIL 鉴权）。
// 该 handler 已从路由移除，仅保留供单测覆盖防枚举/限流逻辑，勿在新代码引用。
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req model.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	// 防刷：先查锁定（无论用户名是否存在都计失败数，消除用户名枚举差异）
	key := "admin:" + req.Username
	failCount, _ := h.Redis.GetLoginFail(r.Context(), key)
	if failCount >= 5 {
		ttl, _ := h.Redis.GetLoginFailTTL(r.Context(), key)
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("登录失败次数过多，请 %d 分钟后重试", int(ttl.Minutes())+1)})
		return
	}

	admin, err := h.MySQL.GetAdminByUsername(req.Username)
	// 用户名不存在或密码错误：统一计失败数 + 统一文案，不泄露用户名是否存在。
	// 用户名不存在时也跑一次 bcrypt 假比较，抹平时序差异防用户名枚举。
	pwOK := false
	if err == nil && admin != nil {
		pwOK = bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)) == nil
	} else {
		// 固定合法 bcrypt hash，仅用于消耗与真实校验相当的计算时间（抹平时序）
		bcrypt.CompareHashAndPassword([]byte("$2a$10$TMdt.HGIl7OlL3BWINXdOud7b9OpWVwaMh//PUx7diFCKUmFOvwwu"), []byte(req.Password))
	}
	if !pwOK {
		n, _ := h.Redis.IncrLoginFail(r.Context(), key)
		log.Printf("[admin-login] 失败 username=%s ip=%s 失败次数=%d", req.Username, r.RemoteAddr, n)
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "用户名或密码错误"})
		return
	}

	// 成功：清除失败计数
	h.Redis.ResetLoginFail(r.Context(), key)

	tokenBytes := make([]byte, 32)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	h.Redis.SetToken(r.Context(), token, admin.ID, 24*time.Hour)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: model.LoginResponse{
		Token:   token,
		AdminID: admin.ID,
	}})
}

// GET /api/accounts
func (h *Handler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status")
	search := q.Get("search")
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	accounts, total, err := h.MySQL.ListAccounts(status, search, (page-1)*pageSize, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}

	// 附加实时并发占用数（来自 Redis image_slot）
	if len(accounts) > 0 {
		ids := make([]int64, len(accounts))
		for i := range accounts {
			ids[i] = accounts[i].ID
		}
		slots := h.Redis.GetImageSlots(r.Context(), ids)
		for i := range accounts {
			accounts[i].ActiveSlots = slots[accounts[i].ID]
		}
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items":     accounts,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	}})
}

// POST /api/accounts
func (h *Handler) AddAccounts(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Tokens     []string `json:"tokens"`
		SourceType string   `json:"source_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if body.SourceType == "" {
		body.SourceType = "web"
	}
	added, err := h.MySQL.AddAccounts(body.Tokens, body.SourceType)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "ok", Data: map[string]any{"added": added}})
}

// DELETE /api/accounts
func (h *Handler) DeleteAccounts(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	n, err := h.MySQL.DeleteAccounts(body.IDs)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"removed": n}})
}

// POST /api/accounts/refresh
func (h *Handler) RefreshAccounts(w http.ResponseWriter, r *http.Request) {
	// 读取请求体，支持指定 ids 批量刷新
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body.Close()
	var body struct {
		IDs []int64 `json:"ids"`
	}
	json.Unmarshal(bodyBytes, &body)

	var accounts []model.Account
	var err error
	if len(body.IDs) > 0 {
		accounts, err = h.MySQL.GetAccountsByIDs(body.IDs)
	} else {
		accounts, err = h.MySQL.GetAccountsForRefresh()
	}
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}

	type result struct {
		acc *model.Account
		err error
	}

	sem := make(chan struct{}, 10)
	ch := make(chan result, len(accounts))

	// 读取注册机配置的代理
	regCfg, _ := h.MySQL.GetRegisterConfig()
	proxyURL := regCfg.Proxy

	for i := range accounts {
		sem <- struct{}{}
		go func(acc *model.Account) {
			defer func() { <-sem }()
			err := service.RefreshAccount(acc, proxyURL)
			ch <- result{acc, err}
		}(&accounts[i])
	}

	refreshed := 0
	var errors []string
	for i := 0; i < len(accounts); i++ {
		r := <-ch
		if r.err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", r.acc.Email, r.err))
			continue
		}
		if err := h.MySQL.UpdateAccountInfo(r.acc); err != nil {
			errors = append(errors, fmt.Sprintf("%s save: %v", r.acc.Email, err))
			continue
		}
		refreshed++
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"refreshed": refreshed,
		"total":     len(accounts),
		"errors":    errors,
	}})
}

// GET /api/accounts/stats
func (h *Handler) AccountStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.MySQL.GetAccountStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}
