package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/storage"
	"chatgpt2api-pro/internal/store"

	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	MySQL   *store.MySQLStore
	Redis   *store.RedisStore
	Cleaner *service.StorageCleaner
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// POST /api/admin/login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req model.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	admin, err := h.MySQL.GetAdminByUsername(req.Username)
	if err != nil || admin == nil {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "用户名或密码错误"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "用户名或密码错误"})
		return
	}

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

// ── Register SSE ─────────────────────────────────────

func (h *Handler) RegisterEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok { return }

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
			if !ok { return }
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

// ── Settings ─────────────────────────────────────────

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetSettings()
	// 公开接口不返回敏感字段
	cfg.CFTurnstileSecretKey = ""
	cfg.AlipayAppPrivateKey = ""
	cfg.AlipayPublicKey = ""
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) SaveSettings(w http.ResponseWriter, r *http.Request) {
	var cfg model.Settings
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	h.MySQL.SaveSettings(&cfg)

	// 热更新：StorageCleanupDays 变化时启停本地清理定时器
	if cfg.StorageCleanupDays > 0 {
		h.Cleaner.Start()
	} else {
		h.Cleaner.Stop()
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

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

// GET /api/accounts/stats
func (h *Handler) AccountStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.MySQL.GetAccountStats()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: stats})
}

func (h *Handler) GetStorageConfig(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.MySQL.GetStorageConfig()
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

func (h *Handler) SaveStorageConfig(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var cfg model.StorageConfig
	json.Unmarshal(body, &cfg)
	if cfg.Type == "" { cfg.Type = "database" }
	if err := h.MySQL.SaveStorageConfig(&cfg); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: cfg})
}

// resolveUserID 尝试从请求中提取用户 ID
func (h *Handler) resolveUserID(r *http.Request) int64 {
	// 1. 优先从 context 取（中间件已鉴权的情况）
	if uid, ok := r.Context().Value(middleware.UserIDKey).(int64); ok && uid > 0 {
		return uid
	}
	// 2. Authorization: Bearer token (user token)
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		// 先试 user token
		if uid, err := h.Redis.GetToken(r.Context(), "user:"+token); err == nil && uid > 0 {
			return uid
		}
		// 再试 API Key
		if strings.HasPrefix(token, "sk-") {
			if user, err := h.MySQL.GetUserByAPIKey(token); err == nil && user != nil {
				return user.ID
			}
		}
	}
	// 3. Cookie（img 标签自动携带同域 cookie）
	if c, _ := r.Cookie("token"); c != nil && c.Value != "" {
		if uid, err := h.Redis.GetToken(r.Context(), "user:"+c.Value); err == nil && uid > 0 {
			return uid
		}
	}
	// 3. ?token= 查询参数（img 标签无法发送 Authorization 头，通过此方式传递 token）
	if token := r.URL.Query().Get("token"); token != "" {
		if uid, err := h.Redis.GetToken(r.Context(), "user:"+token); err == nil && uid > 0 {
			return uid
		}
	}
	return 0
}

// resolveAdminToken 检查请求中是否包含有效的管理员 token（支持 cookie 和 query 方式）
func (h *Handler) resolveAdminToken(r *http.Request) bool {
	// 中间件已鉴权
	if _, ok := r.Context().Value(middleware.AdminIDKey).(int64); ok {
		return true
	}
	var rawToken string
	if c, err := r.Cookie("token"); err == nil && c.Value != "" {
		rawToken = c.Value
	} else {
		rawToken = r.URL.Query().Get("token")
	}
	if rawToken == "" {
		return false
	}
	aid, err := h.Redis.GetToken(r.Context(), rawToken)
	return err == nil && aid > 0
}

// GET /api/images/{id} — 图片代理（隐藏真实存储地址）
func (h *Handler) ServeGenerationImage(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	gen, err := h.MySQL.GetGenerationByID(id)
	if err != nil || gen == nil {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "图片不存在"})
		return
	}

	// 鉴权：公开分享图片无需登录，私有图片需所有者或管理员
	if !gen.Shared {
		uid := h.resolveUserID(r)
		if uid == 0 || gen.UserID != uid {
			// 检查管理员 token（支持 cookie/query/admin 中间件）
			if !h.resolveAdminToken(r) {
				writeJSON(w, 403, model.APIResponse{Code: 403, Message: "无权访问"})
				return
			}
		}
	}

	var imgData []byte
	if gen.ImageURL != "" {
		// S3 存储需要 V4 签名才能访问
		storageCfg, _ := h.MySQL.GetStorageConfig()
		if storageCfg.Type == "s3" {
			imgData, err = storage.S3SignedGET(r.Context(), storageCfg, gen.ImageURL)
			if err != nil {
				log.Printf("[proxy] S3 signed GET error: %v", err)
				writeJSON(w, 502, model.APIResponse{Code: 502, Message: "获取图片失败"})
				return
			}
		} else if storageCfg.Type == "local" && storageCfg.LocalPath != "" {
			relPath := strings.TrimPrefix(gen.ImageURL, storageCfg.LocalURL)
			filePath := filepath.Join(storageCfg.LocalPath, relPath)
			imgData, err = os.ReadFile(filepath.Clean(filePath))
			if err != nil {
				log.Printf("[proxy] local read error: %v", err)
				writeJSON(w, 502, model.APIResponse{Code: 502, Message: "获取图片失败"})
				return
			}
		} else {
			resp, err := http.Get(gen.ImageURL)
			if err != nil {
				writeJSON(w, 502, model.APIResponse{Code: 502, Message: "获取图片失败"})
				return
			}
			defer resp.Body.Close()
			imgData, err = io.ReadAll(resp.Body)
			if err != nil {
				writeJSON(w, 502, model.APIResponse{Code: 502, Message: "读取图片失败"})
				return
			}
		}
	} else if gen.ImageB64 != "" {
		imgData, err = base64.StdEncoding.DecodeString(gen.ImageB64)
		if err != nil {
			writeJSON(w, 500, model.APIResponse{Code: 500, Message: "图片解码失败"})
			return
		}
	} else {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "图片数据为空"})
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Length", strconv.Itoa(len(imgData)))
	w.Write(imgData)
}
