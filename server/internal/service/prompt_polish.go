package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// polishSystemPrompt 内置的提示词润色系统指令（写死在后端，质量护城河，不暴露给用户）。
// 目标：把用户的简短/口语化描述扩写成专业、精准、信息完整的文生图提示词。
const polishSystemPrompt = `你是顶尖的 AI 绘画提示词工程师，服务于先进的文生图模型。将用户输入的简短描述改写成一段高质量、可直接出图的专业提示词。

【首要原则·不可违背】
- 完整保留用户的核心意图与所有明确指定的元素（主体、动作、数量、颜色、风格、场景等），绝不改变、删减或替换原意。
- 用户已明确的内容拥有最高优先级；只在用户未提及处做专业补充，且补充内容必须与原意协调，绝不引入冲突或喧宾夺主的元素。
- 把模糊抽象的词转为具体可视的画面（如"好看"→具体的光影/构图/配色；"科技感"→具体的材质/光效/环境）。

【按需覆盖以下专业维度】（自动判断画面类型——人像/风景/产品/插画/概念图等，只补该类型真正需要的维度，不堆砌无关项）：
- 主体：外观特征、姿态表情、细节质感
- 环境：场景、背景、时间、天气、季节
- 构图：视角与景别（特写/中景/全景/俯拍/仰拍）、主体位置、前后景层次
- 光影：光源类型与方向、明暗对比、氛围光（如柔光/逆光/黄金时刻/霓虹）
- 色彩：主色调、配色关系、饱和度氛围
- 风格质感：艺术媒介或渲染风格、材质细节、画面情绪

【输出规范】
- 用连贯自然的中文画面描述，像在向画师口述一个具体场景，而非罗列关键词；严禁 "4k, masterpiece, best quality, highly detailed" 这类标签堆砌。
- 务必写出具体可视的场景细节：不要停留在"在森林里"，而要落到"清晨薄雾笼罩的针叶林，斜射的金色阳光穿过树梢，地面覆盖湿润苔藓"这样的程度。每个维度都给到画师能直接照着画的具体信息。
- 长度随画面复杂度自适应：简单主体 100 字左右即可，复杂或多元素场景可到 200–260 字；以"信息完整、画面可被精确还原"为准，不为凑字数注水，也不为简短而牺牲关键细节。
- 只输出润色后的提示词正文，不要任何解释、标题、前缀、引号或 markdown 标记。`

// PolishPrompt 调用已配模型润色用户提示词。styleHint 为用户已选风格（可空，会并入润色目标）。
// 复用 SVGGenService 的账号池 + chatText 文本对话机制。返回润色后的纯文本。
func (s *SVGGenService) PolishPrompt(ctx context.Context, modelSlug, userPrompt, styleHint string) (string, error) {
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

	// 风格联动：把用户已选风格并入 system 指令，让润色贴合所选风格
	sysHint := polishSystemPrompt
	if strings.TrimSpace(styleHint) != "" {
		sysHint += "\n\n额外要求：让描述贴合「" + strings.TrimSpace(styleHint) + "」这一画面风格。"
	}

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatText(ctx, modelSlug, sysHint, userPrompt, acc.AccessToken, proxy, nil)
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
			return cleanPolishOutput(txt), nil
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

// cleanPolishOutput 清洗模型输出：去掉可能的引号、markdown、前缀废话，只留纯提示词。
func cleanPolishOutput(s string) string {
	s = strings.TrimSpace(s)
	// 去掉包裹的代码块
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)
	// 去掉常见前缀
	for _, p := range []string{"润色后：", "润色后的提示词：", "提示词：", "优化后：", "Prompt：", "prompt:"} {
		s = strings.TrimPrefix(s, p)
	}
	// 去掉首尾引号
	s = strings.Trim(s, "\"'「」“”")
	return strings.TrimSpace(s)
}
