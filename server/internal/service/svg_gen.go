package service

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// SVGGenService 走 ChatGPT 文本对话接口生成 SVG/矢量（复用账号池 + 同款后端协议）。
// 与生图 service 同构：从号池取号、PoW、SSE，但走文本模型、读流式文本。
type SVGGenService struct {
	mysql *store.MySQLStore
	redis *store.RedisStore
}

func NewSVGGenService(mysql *store.MySQLStore, redis *store.RedisStore) *SVGGenService {
	return &SVGGenService{mysql: mysql, redis: redis}
}

// ModelInfo 账号可用模型（slug + 展示名）。
type ModelInfo struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

// ListModels 用号池里一个可用账号拉取 /backend-api/models，返回可选模型列表。
func (s *SVGGenService) ListModels(ctx context.Context) ([]ModelInfo, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	candidates, err := GetAccountPool(s.mysql).PickCandidates(nil)
	if err != nil || len(candidates) == 0 {
		return nil, fmt.Errorf("无可用账号")
	}
	transport := getChromeTransport(regCfg.Proxy)
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	var lastErr error
	for i, acc := range candidates {
		if i >= 5 {
			break
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/backend-api/models?history_and_training_disabled=false", nil)
		req.Header.Set("User-Agent", ua)
		req.Header.Set("Authorization", "Bearer "+acc.AccessToken)
		req.Header.Set("Origin", "https://chatgpt.com")
		req.Header.Set("Referer", "https://chatgpt.com/")
		req.Header.Set("OAI-Device-Id", newUUID())
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		var data struct {
			Models []ModelInfo `json:"models"`
		}
		json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()
		if len(data.Models) > 0 {
			return data.Models, nil
		}
		lastErr = fmt.Errorf("账号 %s 返回空模型列表", acc.Email)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("拉取模型列表失败")
}

// GenerateSVG 用指定模型生成 SVG 文本。onDelta 每收到一段增量文本回调一次（用于 SSE 逐字透传）；
// 返回最终完整文本。账号池逐个尝试，失败按生图同款分级标记/换号。
func (s *SVGGenService) GenerateSVG(ctx context.Context, modelSlug, prompt string, onDelta func(string)) (string, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	proxy := regCfg.Proxy
	// 单账号并发上限：后台可配（scheduler_config.max_per_account），热更新。
	maxPerAccount := 3
	maxAttemptsCfg := 0
	if sched := GetScheduler(); sched != nil {
		maxPerAccount = sched.MaxPerAccount()
		maxAttemptsCfg = sched.MaxAttempts()
	}

	// 负载均衡选号：占用少的账号优先
	ap := GetAccountPool(s.mysql)
	candidates, err := ap.PickCandidates(s.redis.GetImageSlots(ctx, ap.AllAccountIDs()))
	if err != nil {
		return "", fmt.Errorf("无可用账号: %w", err)
	}
	maxAttempts := maxAttemptsCfg
	if maxAttempts <= 0 {
		maxAttempts = len(candidates)
		if maxAttempts > 30 {
			maxAttempts = 30
		}
	}
	if len(candidates) < maxAttempts {
		maxAttempts = len(candidates)
	}

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatText(ctx, modelSlug, svgSystemHint, prompt, acc.AccessToken, proxy, onDelta)
		return txt, true, e
	}

	var lastErr error
	attempt := 0
	for _, acc := range candidates {
		if attempt >= maxAttempts {
			break
		}
		txt, occupied, genErr := tryOne(acc)
		if !occupied {
			continue
		}
		attempt++
		if genErr == nil {
			acc.SuccessCount = 1
			acc.FailCount = 0
			now := time.Now()
			acc.LastUsedAt = &now
			s.mysql.UpdateAccountUsage(acc)
			return txt, nil
		}
		lastErr = genErr
		errStr := genErr.Error()
		mark := ""
		switch {
		case strings.Contains(errStr, "GPT 拒绝") || strings.Contains(errStr, "violate"):
			return "", genErr
		case isAuthBanned(errStr):
			mark = "异常"
		case isRateLimited(errStr):
			mark = "限流"
		}
		if mark != "" {
			acc.FailCount = 1
			acc.SuccessCount = 0
			acc.Status = mark
			s.mysql.UpdateAccountUsage(acc)
		}
	}
	if lastErr != nil {
		return "", fmt.Errorf("号池耗尽: %w", lastErr)
	}
	return "", fmt.Errorf("号池为空或全部繁忙")
}

// describePromptHint 图生文（反推提示词）系统指令：把图片反推成可直接用于生图的【中文】提示词。
// 强约束：高精度、分维度覆盖、纯中文、只输出提示词本身。
const describePromptHint = "你是顶级的 AI 绘画提示词逆向分析专家。请极其仔细地观察这张图片，反推出一段能让 AI 绘画模型重现高度相似画面的【中文】提示词。\n" +
	"要求：\n" +
	"1. 必须精确、细致、信息密度高，准确还原画面的真实内容，不要臆造图中不存在的元素，也不要遗漏关键特征。\n" +
	"2. 按以下维度逐项覆盖（融合成连贯的一段话，不要分点罗列）：主体对象及其外观/数量/姿态/表情、画面构图与视角、艺术风格与媒介（如写实摄影/3D渲染/动漫/油画/水彩等）、色彩与配色基调、光影与明暗、环境与背景、氛围与情绪、material质感与细节、画质特征（如高清、景深、镜头感）。\n" +
	"3. 全程使用中文描述（专有的艺术/摄影术语可保留通用英文词，如 bokeh、cyberpunk），语言专业、具体、可直接用于生图。\n" +
	"4. 只输出提示词正文本身，不要任何解释、引号、markdown 标记、序号或「提示词：」之类的前缀。"

// enhanceDiagnoseHint 一键智能增强（两步法第一步）系统指令：让视觉模型像专业修图师/艺术指导那样
// 诊断这张图的不足，并输出一段针对性的【中文】生图提示词，用于重构出更优秀的版本。
// 全面放开：允许大幅优化构图/光影/背景/氛围/细节，追求最佳观感，但保住主体识别度与原意。
const enhanceDiagnoseHint = "你是世界顶级的摄影后期师与视觉艺术指导。请专业、挑剔地审视这张图片，找出它在视觉表现上的所有不足，" +
	"然后输出一段用于 AI 绘画模型【重新生成】这张图升级版的【中文】提示词。\n" +
	"分析与优化要求：\n" +
	"1. 先在心里诊断这张图的短板：构图是否失衡、主体是否突出、光影是否平淡、色彩是否脏乱、背景是否杂乱、是否缺乏氛围与质感、细节是否粗糙、画质是否不足等。\n" +
	"2. 针对发现的每一处不足，在提示词里给出明确的改进方案：优化构图与主体聚焦、营造高级的光影层次、提升色彩高级感与协调度、净化或重塑背景使其衬托主体、补充氛围与情绪、强化材质与细节、提升到专业级高清画质。\n" +
	"3. 必须【保住画面的核心主体与基本意图】（人还是这个人、物还是这个物、主题不变），但其余维度（构图/光影/背景/氛围/风格质感）可以大胆地、全面地重构与美化，目标是产出一张明显更惊艳、更专业的图。\n" +
	"4. 全程使用中文（专有艺术/摄影术语可保留通用英文词，如 bokeh、rim light、cinematic）。描述要具体、专业、信息密度高，可直接用于生图。\n" +
	"5. 只输出最终提示词正文本身，不要诊断说明、不要分点、不要引号、不要 markdown、不要任何前缀。"

// EnhanceDiagnose 一键智能增强第一步：看图诊断不足并输出针对性的中文重构提示词。
// 复用 chatVision（上传图 + 视觉模型）。imageB64 为裸 base64。
func (s *SVGGenService) EnhanceDiagnose(ctx context.Context, modelSlug, imageB64 string) (string, error) {
	return s.describeWithHint(ctx, modelSlug, enhanceDiagnoseHint, imageB64, nil)
}

// DescribePrompt 图生文：上传一张图，用视觉模型反推出可用于生图的【中文】提示词。
// imageB64 为裸 base64。账号池逐个尝试，失败按生图同款分级标记/换号。复用 GenerateSVG 的选号逻辑。
func (s *SVGGenService) DescribePrompt(ctx context.Context, modelSlug, imageB64 string, onDelta func(string)) (string, error) {
	return s.describeWithHint(ctx, modelSlug, describePromptHint, imageB64, onDelta)
}

// describeWithHint 看图 → 出文本 的通用实现（systemHint 决定用途：反推提示词 / 增强诊断）。
func (s *SVGGenService) describeWithHint(ctx context.Context, modelSlug, systemHint, imageB64 string, onDelta func(string)) (string, error) {
	regCfg, _ := s.mysql.GetRegisterConfig()
	proxy := regCfg.Proxy
	maxPerAccount := 3
	maxAttemptsCfg := 0
	if sched := GetScheduler(); sched != nil {
		maxPerAccount = sched.MaxPerAccount()
		maxAttemptsCfg = sched.MaxAttempts()
	}

	ap := GetAccountPool(s.mysql)
	candidates, err := ap.PickCandidates(s.redis.GetImageSlots(ctx, ap.AllAccountIDs()))
	if err != nil {
		return "", fmt.Errorf("无可用账号: %w", err)
	}
	maxAttempts := maxAttemptsCfg
	if maxAttempts <= 0 {
		maxAttempts = len(candidates)
		if maxAttempts > 30 {
			maxAttempts = 30
		}
	}
	if len(candidates) < maxAttempts {
		maxAttempts = len(candidates)
	}

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatVision(ctx, modelSlug, systemHint, imageB64, acc.AccessToken, proxy, onDelta)
		return txt, true, e
	}

	var lastErr error
	attempt := 0
	for _, acc := range candidates {
		if attempt >= maxAttempts {
			break
		}
		txt, occupied, genErr := tryOne(acc)
		if !occupied {
			continue
		}
		attempt++
		if genErr == nil {
			acc.SuccessCount = 1
			acc.FailCount = 0
			now := time.Now()
			acc.LastUsedAt = &now
			s.mysql.UpdateAccountUsage(acc)
			return strings.TrimSpace(txt), nil
		}
		lastErr = genErr
		errStr := genErr.Error()
		mark := ""
		switch {
		case strings.Contains(errStr, "GPT 拒绝") || strings.Contains(errStr, "violate"):
			return "", genErr
		case isAuthBanned(errStr):
			mark = "异常"
		case isRateLimited(errStr):
			mark = "限流"
		}
		if mark != "" {
			acc.FailCount = 1
			acc.SuccessCount = 0
			acc.Status = mark
			s.mysql.UpdateAccountUsage(acc)
		}
	}
	if lastErr != nil {
		return "", fmt.Errorf("号池耗尽: %w", lastErr)
	}
	return "", fmt.Errorf("号池为空或全部繁忙")
}

const svgSystemHint = "你是一个 SVG 矢量图生成器。根据用户描述输出一段完整、合法、可独立渲染的 SVG 代码，" +
	"使用 viewBox，不要外部依赖。只输出 ```svg 代码块，不要任何多余解释。"

// chatText 用单个账号发起一次文本对话，SSE 流式累积 assistant 文本。
// systemHint 为系统提示词（SVG 生成 / 提示词润色等不同用途传不同 hint）。
func (s *SVGGenService) chatText(ctx context.Context, modelSlug, systemHint, prompt, accessToken, proxy string, onDelta func(string)) (string, error) {
	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 180 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	// bootstrap
	if r, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil); r != nil {
		r.Header.Set("User-Agent", ua)
		if resp, err := client.Do(r); err == nil {
			resp.Body.Close()
		}
	}
	// requirements + PoW
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements", map[string]string{"p": buildLegacyToken(ua)}, hdr, "", "", "")
	if err != nil {
		return "", fmt.Errorf("requirements: %w", err)
	}
	sentinel, _ := reqs["token"].(string)
	proof := solvePoWIfNeeded(reqs, ua)

	fullPrompt := systemHint + "\n\n用户描述：" + prompt
	msg := map[string]any{
		"id":      newUUID(),
		"author":  map[string]string{"role": "user"},
		"content": map[string]any{"content_type": "text", "parts": []string{fullPrompt}},
	}
	payload := map[string]any{
		"action":                        "next",
		"messages":                      []map[string]any{msg},
		"parent_message_id":             newUUID(),
		"model":                         modelSlug,
		"timezone_offset_min":           -480,
		"conversation_mode":             map[string]string{"kind": "primary_assistant"},
		"history_and_training_disabled": true,
	}

	txt, err := s.streamText(ctx, client, "/backend-api/f/conversation", payload, hdr, sentinel, proof, onDelta)
	if err != nil || txt == "" {
		txt, err = s.streamText(ctx, client, "/backend-api/conversation", payload, hdr, sentinel, proof, onDelta)
	}
	if err != nil {
		return "", err
	}
	if txt == "" {
		return "", fmt.Errorf("未获取到回复")
	}
	return txt, nil
}

// chatVision 用单个账号发起一次「带图片」的多模态对话（图生文/反推提示词）。
// 先把图片上传到 ChatGPT 拿 file_id，再构造含 image_asset_pointer 的 multimodal 消息，
// 用视觉模型(modelSlug)走 conversation 流式返回文本。imageB64 为裸 base64。
func (s *SVGGenService) chatVision(ctx context.Context, modelSlug, systemHint, imageB64, accessToken, proxy string, onDelta func(string)) (string, error) {
	transport := getChromeTransport(proxy)
	client := &http.Client{Transport: transport, Timeout: 180 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	// bootstrap
	if r, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil); r != nil {
		r.Header.Set("User-Agent", ua)
		if resp, err := client.Do(r); err == nil {
			resp.Body.Close()
		}
	}

	// 上传图片拿 file_id（复用生图链路的 uploadImage）
	fileID, err := uploadImage(ctx, client, imageB64, accessToken, deviceID, ua)
	if err != nil {
		return "", fmt.Errorf("上传图片失败: %w", err)
	}

	// requirements + PoW
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements", map[string]string{"p": buildLegacyToken(ua)}, hdr, "", "", "")
	if err != nil {
		return "", fmt.Errorf("requirements: %w", err)
	}
	sentinel, _ := reqs["token"].(string)
	proof := solvePoWIfNeeded(reqs, ua)

	// multimodal 消息：文本指令 + 图片资源指针
	parts := []any{
		map[string]any{
			"content_type":  "image_asset_pointer",
			"asset_pointer": "file-service://" + fileID,
			"size_bytes":    float64(0),
			"width":         float64(1024),
			"height":        float64(1024),
		},
		systemHint,
	}
	msg := map[string]any{
		"id":      newUUID(),
		"author":  map[string]string{"role": "user"},
		"content": map[string]any{"content_type": "multimodal_text", "parts": parts},
	}
	payload := map[string]any{
		"action":                        "next",
		"messages":                      []map[string]any{msg},
		"parent_message_id":             newUUID(),
		"model":                         modelSlug,
		"timezone_offset_min":           -480,
		"conversation_mode":             map[string]string{"kind": "primary_assistant"},
		"history_and_training_disabled": true,
	}

	txt, err := s.streamText(ctx, client, "/backend-api/f/conversation", payload, hdr, sentinel, proof, onDelta)
	if err != nil || txt == "" {
		txt, err = s.streamText(ctx, client, "/backend-api/conversation", payload, hdr, sentinel, proof, onDelta)
	}
	if err != nil {
		return "", err
	}
	if txt == "" {
		return "", fmt.Errorf("未获取到回复")
	}
	return txt, nil
}


func (s *SVGGenService) streamText(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof string, onDelta func(string)) (string, error) {
	j, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com"+path, strings.NewReader(string(j)))
	for k, v := range hdrFn(path) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if sentinel != "" {
		req.Header.Set("OpenAI-Sentinel-Chat-Requirements-Token", sentinel)
	}
	if proof != "" {
		req.Header.Set("OpenAI-Sentinel-Proof-Token", proof)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b[:minI(300, len(b))]))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	last := ""
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var ev map[string]any
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		msg, _ := ev["message"].(map[string]any)
		if msg == nil {
			if v, _ := ev["v"].(map[string]any); v != nil {
				msg, _ = v["message"].(map[string]any)
			}
		}
		if msg == nil {
			continue
		}
		author, _ := msg["author"].(map[string]any)
		if role, _ := author["role"].(string); role != "assistant" {
			continue
		}
		content, _ := msg["content"].(map[string]any)
		if content == nil {
			continue
		}
		parts, _ := content["parts"].([]any)
		var sb strings.Builder
		for _, p := range parts {
			if str, ok := p.(string); ok {
				sb.WriteString(str)
			}
		}
		cur := sb.String()
		if cur != "" && cur != last {
			// 全量快照：计算相对上次的增量回调
			if onDelta != nil && strings.HasPrefix(cur, last) {
				onDelta(cur[len(last):])
			} else if onDelta != nil {
				onDelta(cur)
			}
			last = cur
		}
	}
	return strings.TrimSpace(last), nil
}
