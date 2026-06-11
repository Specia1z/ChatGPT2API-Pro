package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/storage"
)

// POST /api/v1/image-enhance — 一键智能增强（开发者 API，同步返回增强后的图）。
// 内部两步一气呵成：①视觉模型看图诊断不足、生成针对性中文重构提示词 ②据此 + 原图图生图。
// 阻塞直到出图，直接返回结果图。按一次图生图计费（tokens_per_image）。
// body: {"image_b64":"<裸base64或dataURL>", "size":"1:1", "response_format":"b64_json|url"}
func (h *Handler) ImageEnhanceAPI(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未认证"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 12<<20))
	var req struct {
		ImageB64       string `json:"image_b64"`
		Size           string `json:"size"`
		ResponseFormat string `json:"response_format"`
	}
	json.Unmarshal(body, &req)
	req.ImageB64 = strings.TrimSpace(req.ImageB64)
	if i := strings.Index(req.ImageB64, ","); strings.HasPrefix(req.ImageB64, "data:") && i > 0 {
		req.ImageB64 = req.ImageB64[i+1:]
	}
	if req.ImageB64 == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "image_b64 不能为空"})
		return
	}
	size := openaiSizeToRatio(req.Size)
	respFormat := req.ResponseFormat
	if respFormat == "" {
		respFormat = "b64_json"
	}

	settings, _ := h.MySQL.GetSettings()
	if settings == nil || strings.TrimSpace(settings.SVGModel) == "" {
		writeJSON(w, 503, model.APIResponse{Code: 503, Message: "智能增强未配置（需后台设置模型）"})
		return
	}

	// 令牌消耗（按一次图生图：tokens_per_image）
	user, _ := h.MySQL.GetUserByID(uid)
	capacity, refillRate, maxConcurrent := 50, 3, 1
	if user != nil {
		capacity = valOr(user.TokenCapacity, 50)
		refillRate = valOr(user.TokenRefillPerHour, 3)
		maxConcurrent = valOr(user.PlanConcurrency, 1)
	}
	cost := valOr(settings.TokensPerImage, 1)
	if _, _, okTok, waitSec, _ := h.Redis.ConsumeToken(uid, capacity, refillRate, cost); !okTok {
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: fmt.Sprintf("令牌不足（需%d个, 等待%ds）", cost, waitSec)})
		return
	}
	middleware.SetAPICallCost(r, cost, 1)
	refund := func() { h.Redis.RefundToken(uid, capacity, refillRate, cost) }

	svc := service.NewSVGGenService(h.MySQL, h.Redis)
	// 第一步：看图诊断 → 重构提示词
	prompt, err := svc.EnhanceDiagnose(r.Context(), settings.SVGModel, req.ImageB64)
	if err != nil || strings.TrimSpace(prompt) == "" {
		refund()
		writeJSON(w, 502, model.APIResponse{Code: 502, Message: "智能诊断失败：" + errMsg(err)})
		return
	}
	prompt = strings.TrimSpace(prompt)
	if extra := strings.TrimSpace(settings.ImageEnhancePrompt); extra != "" {
		prompt = prompt + "。" + extra
	}

	// 第二步：诊断提示词 + 原图 图生图（同步）
	sched := service.GetScheduler()
	if err := sched.Acquire(uid, maxConcurrent); err != nil {
		refund()
		writeJSON(w, 429, model.APIResponse{Code: 429, Message: err.Error()})
		return
	}
	defer sched.Release(uid)

	genID, dbErr := h.MySQL.CreateGeneration(uid, prompt, "gpt-image-2", size)
	if dbErr != nil {
		refund()
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "创建记录失败"})
		return
	}
	imgSvc := service.NewImageGenService(h.MySQL, h.Redis)
	imageB64, genErr := imgSvc.Generate(context.Background(), prompt, size, req.ImageB64)
	if genErr != nil {
		h.MySQL.UpdateGeneration(genID, "", "failed", genErr.Error(), "")
		refund()
		writeJSON(w, 502, model.APIResponse{Code: 502, Message: "增强生图失败：" + genErr.Error()})
		return
	}

	// 落库（与其它接口一致）
	respURL := ""
	storageCfg, _ := h.MySQL.GetStorageConfig()
	if storageCfg != nil && storageCfg.Type != "database" {
		if imgData, decErr := base64.StdEncoding.DecodeString(imageB64); decErr == nil {
			st := storage.FromConfig(storageCfg)
			path := storage.ObjectKey(uid, genID)
			if u, saveErr := st.Save(context.Background(), path, imgData); saveErr == nil && u != "" {
				h.MySQL.UpdateGeneration(genID, "", "completed", "", u)
				respURL = absoluteImageURL(r, genID)
			}
		}
	}
	if respURL == "" {
		h.MySQL.UpdateGeneration(genID, imageB64, "completed", "", "")
		respURL = absoluteImageURL(r, genID)
	}

	out := map[string]any{"prompt": prompt}
	if respFormat == "url" {
		out["url"] = respURL
	} else {
		out["b64_json"] = imageB64
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: out})
}

func errMsg(err error) string {
	if err != nil {
		return err.Error()
	}
	return "无返回"
}
