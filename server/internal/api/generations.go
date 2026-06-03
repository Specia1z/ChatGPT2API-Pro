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



	"chatgpt2api-pro/internal/middleware"

	"chatgpt2api-pro/internal/model"

	"chatgpt2api-pro/internal/service"

	"chatgpt2api-pro/internal/storage"

)



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



	// 所有权校验：只能删自己的

	if err := h.MySQL.DeleteUserGeneration(req.ID, uid); err != nil {

		if err == sql.ErrNoRows {

			writeJSON(w, 404, model.APIResponse{Code: 404, Message: "不存在或无权操作"})

			return

		}

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})

}



func valOr(v, def int) int { if v <= 0 { return def }; return v }



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



	// 令牌桶检查 — 原子消耗 count 个令牌（同步，确保返回时已扣减）

	normal, burst, ok, waitSec, _ := h.Redis.ConsumeToken(userID, capacity, refillRate, count)
	totalRemain := normal + burst
	
	if !ok {
	
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", totalRemain, count, waitSec)})
	
		return
	
	}



	// 批量创建记录

	var ids []int64

	for i := 0; i < count; i++ {

		id, err := h.MySQL.CreateGeneration(userID, req.Prompt, req.Model, size)

		if err != nil {

			// 已扣减 count 个令牌，但从第 i 条起未能建记录（不会进入下方 goroutine 退款），
			// 退还这部分未使用的令牌，避免令牌泄漏

			h.Redis.RefundToken(userID, capacity, refillRate, count-i)

			writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

			return

		}

		ids = append(ids, id)

	}



	// 并发生图

	preview := req.Prompt

	if len(preview) > 50 { preview = preview[:50] }

	for _, id := range ids {

		go func(genID int64) {

			defer func() {

				if r := recover(); r != nil {

					log.Printf("[gen %d] panic: %v", genID, r)

					if err := h.MySQL.UpdateGeneration(genID, "", "failed", fmt.Sprintf("内部错误: %v", r), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

					h.Redis.RefundToken(userID, capacity, refillRate, 1)

				}

			}()



			if err := sched.Acquire(userID, maxConcurrent); err != nil {

				log.Printf("[gen %d] 调度拒绝: %v", genID, err)

				if err := h.MySQL.UpdateGeneration(genID, "", "failed", err.Error(), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

				h.Redis.RefundToken(userID, capacity, refillRate, 1)

				return

			}

			defer sched.Release(userID)



			log.Printf("[gen %d] 开始生图: %s, size=%s", genID, preview, size)

			svc := service.NewImageGenService(h.MySQL, h.Redis)

			imageB64, err := svc.Generate(context.Background(), req.Prompt, size, req.RefImagesB64...)

			if err != nil {

				log.Printf("[gen %d] 失败: %v", genID, err)

				if err := h.MySQL.UpdateGeneration(genID, "", "failed", err.Error(), ""); err != nil { log.Printf("[gen %d] update fail: %v", genID, err) }

				h.Redis.RefundToken(userID, capacity, refillRate, 1)

				return

			}

			log.Printf("[gen %d] 成功, size=%d", genID, len(imageB64))

			// 检查存储配置
				storageCfg, _ := h.MySQL.GetStorageConfig()
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
						path := fmt.Sprintf("u/%d/%d.png", userID, genID)
						imageURL, saveErr := st.Save(context.Background(), path, imgData)
						if saveErr != nil {
							log.Printf("[gen %d] storage save error: %v, fallback to database", genID, saveErr)
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

	if _, err := h.MySQL.RawExec("DELETE FROM generations WHERE id=?", req.ID); err != nil {

		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})

		return

	}

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

