package api



import (

	"context"

	"database/sql"

	"encoding/base64"

	"encoding/json"

	"fmt"

	"io"

	"log"

	"net/http"

	"strings"

	"strconv"

	"time"



	"chatgpt2api-pro/internal/middleware"

	"chatgpt2api-pro/internal/model"

	"chatgpt2api-pro/internal/service"

	"chatgpt2api-pro/internal/storage"

)



// deleteStoredObject 删除 generation 对应的外部存储对象（S3/local）。
// database 模式无外部对象，直接跳过。失败仅记录日志、不阻断 DB 删除，
// 由本地清理器或后续运维兜底；优先保证用户删除操作成功返回。
func (h *Handler) deleteStoredObject(gen *model.Generation) {
	if gen == nil || gen.ImageURL == "" {
		return // database 模式或无外部对象
	}
	storageCfg, err := h.MySQL.GetStorageConfig()
	if err != nil || storageCfg == nil || storageCfg.Type == "database" {
		return
	}
	// 与 Save 对称地重建 object path
	path := storage.ObjectKey(gen.UserID, gen.ID)
	st := storage.FromConfig(storageCfg)
	if err := st.Delete(context.Background(), path); err != nil {
		log.Printf("[gen %d] storage delete failed (orphan object may remain): %v", gen.ID, err)
	}
}

// DELETE /api/generations — 用户删除自己的生图

func (h *Handler) DeleteGeneration(w http.ResponseWriter, r *http.Request) {

	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)

	if !ok {

		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})

		return

	}



	var req struct{ ID int64 `json:"id"` }

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})

		return

	}



	// 取记录用于删除后清理存储对象（image_url / user_id）
	gen, _ := h.MySQL.GetGenerationByID(req.ID)

	// 所有权校验：只能删自己的

	if err := h.MySQL.DeleteUserGeneration(req.ID, uid); err != nil {

		if err == sql.ErrNoRows {

			writeJSON(w, 404, model.APIResponse{Code: 404, Message: "不存在或无权操作"})

			return

		}

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

	// DB 记录已删，清理外部存储对象（best-effort）
	if gen != nil && gen.UserID == uid {
		h.deleteStoredObject(gen)
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})

}



func valOr(v, def int) int { if v <= 0 { return def }; return v }



// isEphemeralRequest 判断本次请求是否走「不永久落地」策略：
// 后台开启 api_no_persist 且请求来自 API Key（sk-）认证。网页 token 不受影响。
func (h *Handler) isEphemeralRequest(r *http.Request, settings *model.Settings) bool {
	if settings == nil || !settings.APINoPersist {
		return false
	}
	isAPI, _ := r.Context().Value(middleware.IsAPIKey).(bool)
	return isAPI
}

// ephemeralTTL 返回短时缓存有效期（后台 api_image_ttl_min，0=默认 30 分钟）。
func ephemeralTTL(settings *model.Settings) time.Duration {
	min := 30
	if settings != nil && settings.APIImageTTLMin > 0 {
		min = settings.APIImageTTLMin
	}
	return time.Duration(min) * time.Minute
}



// POST /api/generations — 用户提交生图任务

func (h *Handler) CreateGeneration(w http.ResponseWriter, r *http.Request) {

	// 安全断言

	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)

	if !ok {

		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})

		return

	}

	userID := uid



	// 限制请求体大小 (10 MB)

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)

	body, err := io.ReadAll(r.Body)

	if err != nil {

		writeJSON(w, 413, model.APIResponse{Code: 413, Message: "请求体过大"})

		return

	}



	var req struct {

		Prompt       string   `json:"prompt"`

		Model        string   `json:"model"`

		Size         string   `json:"size"`

		Count        int      `json:"count"`

		RefImagesB64 []string `json:"ref_images_b64"`

	}

	json.Unmarshal(body, &req)



	// 输入校验

	if req.Prompt == "" {

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "prompt 不能为空"})

		return

	}

	if len(req.Prompt) > 2000 {

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "prompt 超出长度限制 (2000)"})

		return

	}

	if len(req.RefImagesB64) > 10<<20 { // 10 MB

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参考图过大"})

		return

	}



	// 敏感词检查

	settings, _ := h.MySQL.GetSettings()

	if settings.BannedWords != "" {

		lowerPrompt := strings.ToLower(req.Prompt)

		for _, word := range strings.Split(settings.BannedWords, ",") {

			word = strings.TrimSpace(strings.ToLower(word))

			if word != "" && strings.Contains(lowerPrompt, word) {

				writeJSON(w, 400, model.APIResponse{Code: 400, Message: "提示词包含违规内容"})

				return

			}

		}

	}



	if req.Model == "" { req.Model = "gpt-image-2" }



	size := req.Size

	if size == "" { size = "1:1" }

	count := req.Count

	if count < 1 { count = 1 }

	if count > 10 { count = 10 }



	// 查用户套餐限制

	user, _ := h.MySQL.GetUserByID(userID)

	capacity := 50

	refillRate := 3

	maxConcurrent := 1

	if user != nil {

		capacity = valOr(user.TokenCapacity, 50)

		refillRate = valOr(user.TokenRefillPerHour, 3)

		maxConcurrent = valOr(user.PlanConcurrency, 1)

	}



	// 限制单次请求数量不超过用户并发上限

	if count > maxConcurrent {

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("您的套餐仅支持 %d 个并发生成，单次最多提交 %d 个", maxConcurrent, maxConcurrent)})

		return

	}



	// 调度器预检查（防止创建了记录却抢不到槽位）

	sched := service.GetScheduler()

	if err := sched.CheckCapacity(userID, count, maxConcurrent); err != nil {

		writeJSON(w, 429, model.APIResponse{Code: 429, Message: err.Error()})

		return

	}



	// 令牌桶检查 — 原子消耗令牌（同步，确保返回时已扣减）
	// 每张图消耗 tokensPerImage 个令牌（后台可调，0=默认 1）
	perImage := valOr(settings.TokensPerImage, 1)
	cost := count * perImage

	normal, burst, ok, waitSec, _ := h.Redis.ConsumeToken(userID, capacity, refillRate, cost)
	totalRemain := normal + burst

	if !ok {

		writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", totalRemain, cost, waitSec)})

		return

	}

	// 采集令牌消耗到 API 调用日志 holder（API Key 路由生效；web 路由 holder 不存在则空操作）
	middleware.SetAPICallCost(r, cost, count)
	middleware.SetAPICallExtra(r, req.Prompt, "")



	// 批量创建记录

	var ids []int64

	for i := 0; i < count; i++ {

		id, err := h.MySQL.CreateGeneration(userID, req.Prompt, req.Model, size)

		if err != nil {

			// 已扣减 cost 个令牌，但从第 i 条起未能建记录（不会进入下方 goroutine 退款），
			// 退还这部分未使用的令牌（按每图倍率），避免令牌泄漏

			h.Redis.RefundToken(userID, capacity, refillRate, (count-i)*perImage)

			writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

			return

		}

		ids = append(ids, id)

	}



	// 并发生图

	preview := req.Prompt

	if len(preview) > 50 { preview = preview[:50] }

	// 「不落地」策略：API Key 来源 + 后台开关。命中则图存 Redis 短时缓存、DB 不存图。
	ephemeral := h.isEphemeralRequest(r, settings)
	ephTTL := ephemeralTTL(settings)

	// Webhook 回调：仅对 API Key 来源的异步生图触发（网页 token 有实时 UI，不需要）。
	// baseURL 在此（仍持有 *http.Request）预先算好，供 goroutine 脱离 r 后拼图片地址。
	isAPIKey, _ := r.Context().Value(middleware.IsAPIKey).(bool)
	baseURL := requestBaseURL(r)

	// fireWebhook 在生成进入终态时投递回调（completed/failed）。仅 API Key 来源触发。
	fireWebhook := func(genID int64, status, errMsg string) {
		if !isAPIKey {
			return
		}
		payload := service.WebhookPayload{
			ID:        genID,
			Status:    status,
			Prompt:    req.Prompt,
			Model:     req.Model,
			Size:      size,
			CreatedAt: time.Now().Unix(),
		}
		if status == "completed" {
			payload.Event = "image.completed"
			payload.ImageURL = signedImageURLWithBase(baseURL, genID)
		} else {
			payload.Event = "image.failed"
			payload.ErrorMsg = errMsg
		}
		service.DeliverWebhook(h.MySQL, userID, payload)
	}

	for _, id := range ids {

		go func(genID int64) {

			// Webhook 终态触发：先注册 = 最后执行，确保能拿到下方（含 panic 分支）设置的最终状态。
			var fwStatus, fwErr string
			defer func() {
				if fwStatus != "" {
					fireWebhook(genID, fwStatus, fwErr)
				}
			}()

			defer func() {

				if r := recover(); r != nil {

					log.Printf("[gen %d] panic: %v", genID, r)

					if err := h.MySQL.UpdateGeneration(genID, "", "failed", fmt.Sprintf("内部错误: %v", r), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

					h.Redis.RefundToken(userID, capacity, refillRate, perImage)

					fwStatus, fwErr = "failed", fmt.Sprintf("内部错误: %v", r)

				}

			}()



			if err := sched.Acquire(userID, maxConcurrent); err != nil {

				log.Printf("[gen %d] 调度拒绝: %v", genID, err)

				if err := h.MySQL.UpdateGeneration(genID, "", "failed", err.Error(), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

				h.Redis.RefundToken(userID, capacity, refillRate, perImage)

				fwStatus, fwErr = "failed", err.Error()

				return

			}

			defer sched.Release(userID)



			log.Printf("[gen %d] 开始生图: %s, size=%s", genID, preview, size)

			svc := service.NewImageGenService(h.MySQL, h.Redis)

			imageB64, err := svc.Generate(context.Background(), req.Prompt, size, req.RefImagesB64...)

			if err != nil {

				log.Printf("[gen %d] 失败: %v", genID, err)

				if err := h.MySQL.UpdateGeneration(genID, "", "failed", err.Error(), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

				h.Redis.RefundToken(userID, capacity, refillRate, perImage)

				fwStatus, fwErr = "failed", err.Error()

				return

			}

			log.Printf("[gen %d] 成功, size=%d", genID, len(imageB64))

			// 出图成功：后续无论存缓存/存库/存对象存储（含 fallback）均为 completed 终态，此处统一标记。
			fwStatus = "completed"

			// 检查存储配置
				storageCfg, _ := h.MySQL.GetStorageConfig()
				if ephemeral {
					// 不落地：图存 Redis 短时缓存，DB 仅置 completed（不存图）。过期后代理返回空，符合预期。
					if imgData, decErr := base64.StdEncoding.DecodeString(imageB64); decErr == nil {
						if cerr := h.Redis.SetEphemeralImage(context.Background(), genID, imgData, ephTTL); cerr == nil {
							if err := h.MySQL.UpdateGeneration(genID, "", "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
							return
						} else {
							log.Printf("[gen %d] ephemeral cache fail: %v, fallback to database", genID, cerr)
						}
					}
					if err := h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
					return
				}
				if storageCfg.Type == "database" {
					if err := h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
				} else {
					// 非数据库模式：保存到外部存储，image_b64 为空，记录 image_url
					imgData, decErr := base64.StdEncoding.DecodeString(imageB64)
					if decErr != nil {
						log.Printf("[gen %d] decode b64 error: %v, fallback to database", genID, decErr)
						if err := h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
					} else {
						st := storage.FromConfig(storageCfg)
						path := storage.ObjectKey(userID, genID)
						imageURL, saveErr := st.Save(context.Background(), path, imgData)
						if saveErr != nil {
							log.Printf("[gen %d] storage save error: %v, fallback to database", genID, saveErr)
							if err := h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
						} else if imageURL == "" {
							// 配置不完整导致 FromConfig 回退到 database store（Save 返回空 URL），
							// 回退到 base64 存库，避免 image_url 与 image_b64 同时为空丢图
							log.Printf("[gen %d] storage returned empty URL (config fallback), saving b64 to database", genID)
							if err := h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
						} else {
							log.Printf("[gen %d] storage save OK, URL=%s", genID, imageURL)
							if err := h.MySQL.UpdateGeneration(genID, "", "completed", "", imageURL); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }
						}
					}
				}

		}(id)

	}



	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"ids": ids, "count": count, "status": "pending"}})

}



// GET /api/user/tokens — 查询当前令牌桶状态

func (h *Handler) GetUserTokens(w http.ResponseWriter, r *http.Request) {

	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)

	if !ok {

		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})

		return

	}

	user, _ := h.MySQL.GetUserByID(uid)

	capacity := 50

	refill := 3

	if user != nil {

		if user.TokenCapacity > 0 { capacity = user.TokenCapacity }

		if user.TokenRefillPerHour > 0 { refill = user.TokenRefillPerHour }

	}

	tokens := h.Redis.GetBucketTokens(uid, capacity, refill)

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{

		"tokens":   tokens,

		"capacity": capacity,

		"refill":   refill,

		"plan":     user.PlanName,

		"concurrency": user.PlanConcurrency,

	}})

}



// GET /api/generations — 用户查看自己的生图历史

func (h *Handler) GetUserGenerations(w http.ResponseWriter, r *http.Request) {

	userID := r.Context().Value(middleware.UserIDKey).(int64)

	// 自动清理过期 pending (15 分钟超时)

	h.MySQL.CleanupStaleGenerations(15)

	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))

	pageSize, _ := strconv.Atoi(q.Get("page_size"))

	if page < 1 { page = 1 }

	if pageSize < 1 || pageSize > 50 { pageSize = 12 }



	gens, total, err := h.MySQL.GetUserGenerations(userID, page, pageSize)

	if err != nil {

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

	// 重写 image_url 为带签名的代理绝对地址：
	// DB 存的是原始存储地址（S3/OpenList 私有地址，需签名才能访问且会暴露后端 IP）。
	// 统一改成 /api/images/{id}?exp&sig 代理地址——API 用户拿到可直接访问、隐藏后端；
	// 网页端用 id 走代理、不读此字段，无影响。
	// completed 即视为有图（含「不落地」记录：image_b64/url 均空、图在 Redis 短时缓存），统一给代理地址。
	for i := range gens {
		if gens[i].Status == "completed" {
			gens[i].ImageURL = absoluteImageURL(r, gens[i].ID)
			gens[i].ImageB64 = "" // 代理地址已足够，清空大字段省传输（网页端用 id 不用 b64）
		}
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{

		"items": gens, "total": total, "page": page, "page_size": pageSize,

	}})

}



// GET /api/admin/generations — 管理员查看所有生图

// DELETE /api/admin/generations — 管理员删除生图

func (h *Handler) AdminDeleteGeneration(w http.ResponseWriter, r *http.Request) {

	var req struct{ ID int64 `json:"id"` }

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {

		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})

		return

	}

	gen, _ := h.MySQL.GetGenerationByID(req.ID)

	if _, err := h.MySQL.RawExec("DELETE FROM generations WHERE id=?", req.ID); err != nil {

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

	// 清理外部存储对象（best-effort）
	h.deleteStoredObject(gen)

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})

}



func (h *Handler) GetAllGenerations(w http.ResponseWriter, r *http.Request) {

	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))

	pageSize, _ := strconv.Atoi(q.Get("page_size"))

	if page < 1 { page = 1 }

	if pageSize < 1 || pageSize > 50 { pageSize = 20 }



	gens, total, err := h.MySQL.GetAllGenerations(page, pageSize)

	if err != nil {

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{

		"items": gens, "total": total, "page": page, "page_size": pageSize,

	}})

}

// GET /api/admin/svg-generations — 管理员查看所有 AI 矢量(svg)生成。
func (h *Handler) GetAllSVGGenerations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}
	gens, total, err := h.MySQL.GetAllSVGGenerations(page, pageSize)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"items": gens, "total": total, "page": page, "page_size": pageSize,
	}})
}

