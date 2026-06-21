package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// stylePresetSystemPrompt 风格预设智能生成的系统指令（强约束，保证可直接落库使用）。
// 输入：一个风格名称（中文或英文）。输出：严格 JSON，含 icon / desc / hint 三字段。
const stylePresetSystemPrompt = `你是一个「AI 文生图风格预设」生成器。用户只给你一个风格名称，你要为它生成一条可直接用于文生图平台的风格预设配置。

【输出格式·绝对严格】
只输出一个 JSON 对象，不要任何解释、前缀、markdown 代码块或多余文字。格式：
{"icon":"图标名","desc":"中文简短描述","hint":"英文提示词"}

【字段要求】
1. icon：必须是 lucide-react 图标库中真实存在的图标名，使用精确的 PascalCase 拼写（首字母大写、驼峰式）。只能从下面这批常用图标中选最贴合风格语义的一个：
   Palette, Sparkles, Brush, PenTool, Camera, Aperture, Film, Clapperboard, Image, Wand2, Wand, Star, Sun, Moon, Cloud, Cloudy, Snowflake, Flame, Zap, Droplet, Leaf, Flower, Flower2, TreePine, Mountain, Waves, Heart, Ghost, Skull, Bot, Cpu, Gamepad2, Joystick, Rocket, Atom, Gem, Crown, Castle, Building2, Landmark, Coffee, IceCream, Cake, Cat, Dog, Bird, Fish, Bug, Rabbit, Feather, Music, Headphones, Gift, PartyPopper, Rainbow, Snail, Glasses, Shirt, Footprints, Eye, Orbit, Telescope, Compass, Anchor, Sailboat, Plane, Car, Bike, Train, Swords, Shield, Target, Dice5, Puzzle, Shapes, Hexagon, Triangle, Circle, Square, Spline, Scan, Layers, Grid3x3, Contrast, Sunrise, Sunset, Stars, Sparkle, Bolt, Wind, Umbrella, Tent, Trees, Sprout, Pizza, Cherry, Grape, Citrus
   若没有特别贴合的，用 Palette。
2. desc：中文，极简短（6-14 字），用「·」分隔 2-3 个关键意象，体现该风格的核心视觉感受。例如「霓虹都市·赛博未来」「水墨晕染·东方意境」。不要句子、不要标点结尾。
3. hint：英文，文生图风格提示词，逗号分隔的关键词/短语（6-14 个），覆盖该风格的：艺术媒介/渲染方式、光影、色调、质感、氛围。专业、可直接出图。不含画面主体（主体由用户输入提供），只描述「风格」本身。例如对「赛博朋克」：cyberpunk style, neon lights, futuristic city, rain-soaked streets, high contrast, glowing magenta and cyan, cinematic lighting, volumetric fog, detailed reflections。

【再次强调】只返回那一个 JSON 对象，不要 markdown，不要解释。`

// StylePresetResult 风格预设 AI 生成结果。
type StylePresetResult struct {
	Icon string `json:"icon"`
	Desc string `json:"desc"`
	Hint string `json:"hint"`
}

// GenerateStylePreset 根据风格名称用 AI 生成 icon/desc/hint。复用账号池 + chatText 文本通道。
func (s *SVGGenService) GenerateStylePreset(ctx context.Context, modelSlug, styleName string) (*StylePresetResult, error) {
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
		return nil, fmt.Errorf("无可用账号: %w", err)
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

	userMsg := "风格名称：" + strings.TrimSpace(styleName)

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatText(ctx, modelSlug, stylePresetSystemPrompt, userMsg, acc.AccessToken, proxy, nil)
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
			res, perr := parseStylePresetJSON(txt)
			if perr != nil {
				lastErr = perr
				continue // 解析失败换个账号重试
			}
			acc.SuccessCount = 1
			acc.FailCount = 0
			now := time.Now()
			acc.LastUsedAt = &now
			s.mysql.UpdateAccountUsage(acc)
			return res, nil
		}
		lastErr = genErr
		errStr := genErr.Error()
		mark := ""
		switch {
		case strings.Contains(errStr, "GPT 拒绝") || strings.Contains(errStr, "violate"):
			return nil, genErr
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
		return nil, fmt.Errorf("生成失败: %w", lastErr)
	}
	return nil, fmt.Errorf("号池为空或全部繁忙")
}

// parseStylePresetJSON 从模型输出中提取并解析风格预设 JSON（容忍 markdown 包裹/前后废话）。
func parseStylePresetJSON(raw string) (*StylePresetResult, error) {
	s := strings.TrimSpace(raw)
	// 去掉 ```json ... ``` 代码块包裹
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	}
	// 截取第一个 { 到最后一个 } 之间的内容，容忍模型在 JSON 前后加废话
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start < 0 || end < 0 || end <= start {
		return nil, fmt.Errorf("未找到 JSON")
	}
	s = s[start : end+1]

	var res StylePresetResult
	if err := json.Unmarshal([]byte(s), &res); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	res.Icon = strings.TrimSpace(res.Icon)
	res.Desc = strings.TrimSpace(res.Desc)
	res.Hint = strings.TrimSpace(res.Hint)
	if res.Desc == "" && res.Hint == "" {
		return nil, fmt.Errorf("生成内容为空")
	}
	if res.Icon == "" {
		res.Icon = "Palette"
	}
	return &res, nil
}
