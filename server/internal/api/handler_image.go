package api

import (
	"encoding/base64"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/storage"
)

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

// resolveAdminToken 检查请求是否来自管理员（支持 cookie 和 query 方式，供 img 标签用）。
// 管理身份已统一到 user token + role：中间件已鉴权则直接放行；
// 否则把 cookie/query 的 token 当 user token 解析出 userID，再查角色。
func (h *Handler) resolveAdminToken(r *http.Request) bool {
	// 中间件（AdminAuth）已鉴权
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
	uid, err := h.Redis.GetToken(r.Context(), "user:"+rawToken)
	if err != nil || uid == 0 {
		return false
	}
	email, status, role, ok := h.MySQL.GetUserAuthInfo(uid)
	if !ok || !status {
		return false
	}
	return role >= 1 || middleware.IsSuperAdminEmail(email)
}

// GET /api/images/{id} — 图片代理（隐藏真实存储地址）
func (h *Handler) ServeGenerationImage(w http.ResponseWriter, r *http.Request) {
	// 默认禁缓存：防止 CDN/CF 缓存错误响应（如图片异步生成中的 404）。
	// 成功返回图片时下方会覆盖为 public/private。
	w.Header().Set("Cache-Control", "no-store")

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

	// 鉴权：公开分享图片无需登录；带有效 HMAC 签名的链接（OpenAI url 模式）直接放行；
	// 否则私有图片需所有者或管理员
	if !gen.Shared && !verifyImageSig(id, r.URL.Query().Get("exp"), r.URL.Query().Get("sig")) {
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
	// 优先查短时缓存（API Key 生成的「不落地」图片暂存于此，命中即返回）
	if cached, ok := h.Redis.GetEphemeralImage(r.Context(), id); ok {
		imgData = cached
	} else if gen.ImageURL != "" {
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
			// 按确定性 object key 重建路径，不依赖 image_url 里嵌入的 LocalURL。
			// 这样前端访问前缀(LocalURL)热切换、或 LocalPath 变更都能实时生效。
			// filepath.Join 接受正斜杠输入，跨平台安全。
			key := storage.ObjectKey(gen.UserID, gen.ID)
			filePath := filepath.Join(storageCfg.LocalPath, filepath.Clean(key))
			imgData, err = os.ReadFile(filePath)
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
	// 公开分享图允许共享缓存(CDN/代理)，私有图仅浏览器内存短暂持有
	if gen.Shared {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else {
		w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(imgData)))
	w.Write(imgData)
}
