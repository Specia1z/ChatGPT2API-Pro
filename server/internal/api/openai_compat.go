package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/storage"
)

// OpenAI 兼容图片生成接口 —— POST /v1/images/generations
// 与官方 DALL·E / gpt-image 接口对齐：同步返回，body 形如
//   {"prompt":"...","n":1,"size":"1024x1024","response_format":"b64_json","model":"gpt-image-2"}
// 响应 {"created":<unix>,"data":[{"b64_json":"..."} | {"url":"..."}]}。
// 复用既有 API Key 认证、令牌桶、调度器与生图服务，但改为阻塞直到全部图片完成。

// openaiSizeToRatio 把 OpenAI 的像素尺寸（如 1024x1024）映射到内部比例标签。
// 同时兼容直接传内部标签（16:9 / 2K / A4 等）。无法识别时回退 1:1。
func openaiSizeToRatio(size string) string {
	s := strings.ToLower(strings.TrimSpace(size))
	switch s {
	case "", "auto", "1024x1024", "256x256", "512x512":
		return "1:1"
	case "1792x1024", "1536x1024":
		return "16:9"
	case "1024x1792", "1024x1536":
		return "9:16"
	}
	// 已是内部标签则原样返回（大小写归一）
	known := map[string]string{
		"1:1": "1:1", "4:3": "4:3", "3:4": "3:4", "16:9": "16:9", "9:16": "9:16",
		"16:10": "16:10", "10:16": "10:16", "4:5": "4:5", "5:4": "5:4", "2:3": "2:3",
		"3:2": "3:2", "21:9": "21:9", "2k": "2K", "4k": "4K", "8k": "8K", "a4": "A4", "hd": "HD",
	}
	if v, ok := known[s]; ok {
		return v
	}
	return "1:1"
}

// writeOpenAIError 以 OpenAI 风格返回错误体。
func writeOpenAIError(w http.ResponseWriter, status int, message, errType string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    errType,
			"code":    status,
		},
	})
}

// CreateImageOpenAI 处理 OpenAI 兼容的同步图片生成请求。
func (h *Handler) CreateImageOpenAI(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeOpenAIError(w, 401, "未认证", "invalid_request_error")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeOpenAIError(w, 413, "请求体过大", "invalid_request_error")
		return
	}

	var req struct {
		Prompt         string `json:"prompt"`
		N              int    `json:"n"`
		Size           string `json:"size"`
		ResponseFormat string `json:"response_format"`
		Model          string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeOpenAIError(w, 400, "请求体解析失败", "invalid_request_error")
		return
	}

	if strings.TrimSpace(req.Prompt) == "" {
		writeOpenAIError(w, 400, "prompt 不能为空", "invalid_request_error")
		return
	}
	if len(req.Prompt) > 2000 {
		writeOpenAIError(w, 400, "prompt 超出长度限制 (2000)", "invalid_request_error")
		return
	}

	n := req.N
	if n < 1 {
		n = 1
	}
	if n > 10 {
		n = 10
	}
	size := openaiSizeToRatio(req.Size)
	respFormat := req.ResponseFormat
	if respFormat == "" {
		respFormat = "b64_json"
	}
	if respFormat != "b64_json" && respFormat != "url" {
		writeOpenAIError(w, 400, "response_format 仅支持 b64_json 或 url", "invalid_request_error")
		return
	}

	// 敏感词检查（与原生接口一致）
	settings, _ := h.MySQL.GetSettings()
	if settings.BannedWords != "" {
		lower := strings.ToLower(req.Prompt)
		for _, word := range strings.Split(settings.BannedWords, ",") {
			word = strings.TrimSpace(strings.ToLower(word))
			if word != "" && strings.Contains(lower, word) {
				writeOpenAIError(w, 400, "提示词包含违规内容", "invalid_request_error")
				return
			}
		}
	}

	// GENERATE_PLACEHOLDER
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate, maxConcurrent := 50, 3, 1
	if user != nil {
		if user.TokenCapacity > 0 {
			capacity = user.TokenCapacity
		}
		if user.TokenRefillPerHour > 0 {
			refillRate = user.TokenRefillPerHour
		}
		if user.PlanConcurrency > 0 {
			maxConcurrent = user.PlanConcurrency
		}
	}
	if n > maxConcurrent {
		writeOpenAIError(w, 400, fmt.Sprintf("您的套餐仅支持 %d 个并发生成，n 最多为 %d", maxConcurrent, maxConcurrent), "invalid_request_error")
		return
	}

	sched := service.GetScheduler()
	if err := sched.CheckCapacity(uid, n, maxConcurrent); err != nil {
		writeOpenAIError(w, 429, err.Error(), "rate_limit_error")
		return
	}

	// 令牌桶：原子消耗 n 个
	normal, burst, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, n)
	if !okTok {
		writeOpenAIError(w, 429, fmt.Sprintf("令牌不足 (剩余%.0f, 需%d个, 等待%ds)", normal+burst, n, waitSec), "rate_limit_error")
		return
	}

	storageCfg, _ := h.MySQL.GetStorageConfig()

	// 同步并发生图：每张独立 goroutine，全部完成后统一返回
	type genResult struct {
		b64 string
		url string
		err error
	}
	results := make([]genResult, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			defer func() {
				if rec := recover(); rec != nil {
					results[idx].err = fmt.Errorf("内部错误: %v", rec)
					h.Redis.RefundToken(uid, capacity, refillRate, 1)
				}
			}()

			if err := sched.Acquire(uid, maxConcurrent); err != nil {
				results[idx].err = err
				h.Redis.RefundToken(uid, capacity, refillRate, 1)
				return
			}
			defer sched.Release(uid)

			genID, dbErr := h.MySQL.CreateGeneration(uid, req.Prompt, "gpt-image-2", size)
			if dbErr != nil {
				results[idx].err = dbErr
				h.Redis.RefundToken(uid, capacity, refillRate, 1)
				return
			}

			svc := service.NewImageGenService(h.MySQL, h.Redis)
			// OpenAI 标准生成接口不含参考图（图生图属 edits 接口），故不传 refImages
			imageB64, genErr := svc.Generate(context.Background(), req.Prompt, size)
			if genErr != nil {
				h.MySQL.UpdateGeneration(genID, "", "failed", genErr.Error(), "")
				h.Redis.RefundToken(uid, capacity, refillRate, 1)
				results[idx].err = genErr
				return
			}

			// 落库（与原生接口存储策略一致）：外部存储成功则存 URL，否则 base64 入库
			if storageCfg != nil && storageCfg.Type != "database" {
				if imgData, decErr := base64.StdEncoding.DecodeString(imageB64); decErr == nil {
					st := storage.FromConfig(storageCfg)
					path := storage.ObjectKey(uid, genID)
					if imageURL, saveErr := st.Save(context.Background(), path, imgData); saveErr == nil && imageURL != "" {
						h.MySQL.UpdateGeneration(genID, "", "completed", "", imageURL)
						results[idx] = genResult{b64: imageB64, url: absoluteImageURL(r, genID)}
						return
					}
				}
			}
			// database 模式或外部存储失败回退：base64 入库
			h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", "")
			results[idx] = genResult{b64: imageB64, url: absoluteImageURL(r, genID)}
		}(i)
	}
	wg.Wait()

	// 组装响应：全部失败则返回错误；部分成功则返回成功项
	data := make([]map[string]any, 0, n)
	var firstErr error
	for _, res := range results {
		if res.err != nil {
			if firstErr == nil {
				firstErr = res.err
			}
			continue
		}
		if respFormat == "url" {
			data = append(data, map[string]any{"url": res.url})
		} else {
			data = append(data, map[string]any{"b64_json": res.b64})
		}
	}

	if len(data) == 0 {
		msg := "生成失败"
		if firstErr != nil {
			msg = firstErr.Error()
		}
		log.Printf("[openai-compat] uid=%d 全部失败: %s", uid, msg)
		writeOpenAIError(w, 502, msg, "api_error")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(200)
	// 关闭 HTML 转义，避免 url 模式里的 & 被转成 &（OpenAI 官方不转义，对齐之）
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(map[string]any{
		"created": time.Now().Unix(),
		"data":    data,
	})
}

// absoluteImageURL 用请求的 scheme+host 拼出图片的可访问绝对地址，并附带 HMAC 签名，
// 使 OpenAI url 模式返回的链接可被无登录态的客户端直接访问（带 24h 过期）。
func absoluteImageURL(r *http.Request, genID int64) string {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
		scheme = "http"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		scheme = p
	}
	host := r.Host
	if xf := r.Header.Get("X-Forwarded-Host"); xf != "" {
		host = xf
	}
	exp := time.Now().Add(24 * time.Hour).Unix()
	sig := signImageURL(genID, exp)
	return fmt.Sprintf("%s://%s/api/images/%d?exp=%d&sig=%s", scheme, host, genID, exp, sig)
}

// imageURLSecret 返回图片签名密钥（复用 JWT_SECRET 环境变量，与登录态密钥同源）。
func imageURLSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		s = "change-me"
	}
	return []byte(s)
}

// signImageURL 对 genID + exp 做 HMAC-SHA256，返回 hex 签名。
func signImageURL(genID, exp int64) string {
	mac := hmac.New(sha256.New, imageURLSecret())
	fmt.Fprintf(mac, "%d:%d", genID, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyImageSig 校验图片访问签名是否有效且未过期（供 ServeGenerationImage 调用）。
func verifyImageSig(genID int64, expStr, sig string) bool {
	if expStr == "" || sig == "" {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	want := signImageURL(genID, exp)
	return hmac.Equal([]byte(want), []byte(sig))
}


