package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// aiRiskSystemPrompt AI 风控评估的系统指令。输入用户多维风险画像，输出严格 JSON 风险评估。
// 强约束：只做研判建议，不下达自动处置；输出可解释理由。
const aiRiskSystemPrompt = `你是一个 AI 图片生成平台的风控分析师。根据用户的多维行为画像，评估其「滥用/二次分发/作弊」风险，给出风险分、等级、理由和处置建议。

【输出格式·绝对严格】
只输出一个 JSON 对象，不要任何解释、前缀、markdown 代码块：
{"score":0-100整数,"level":"低|中|高","reason":"简短中文理由(50字内)","verdict":"正常|观察|限流|封禁"}

【评估要点】
- 高风险信号：同 IP 关联大量账号（疑似多开/中转站）、新账号短时间高频调用、错误率异常高、24h 大量重复 prompt（脚本刷量）、邀请注册数远超自身正常注册（刷邀请裂变）、撞月配额且 IP 分散（疑似转卖）。
- 降低风险的信号：账号注册时间长、有真实付费、用量平稳、IP 集中、无被封历史。
- score 与各信号强度正相关：正常用户应给 0-30；可疑给 40-65；明确滥用给 80+。
- verdict 是给人工的「建议」，不是命令：正常/观察/限流/封禁四选一，与 score 大致对应（<40 正常、40-65 观察、65-85 限流、>85 封禁）。
- reason 要具体指出是哪些信号触发，便于管理员核实。务必客观，宁可保守不可冤枉——付费老用户即使用量大也通常是正常的。

【再次强调】只返回那一个 JSON 对象。`

// AnalyzeUserRisk 用上游大模型对用户风险画像评估。复用账号池 + chatText 通道。
// 仅在管理员按需触发、且后台开启 ai_scoring_enabled 时调用（开关判断在 handler 层）。
func (s *SVGGenService) AnalyzeUserRisk(ctx context.Context, modelSlug string, profile *model.UserRiskProfile) (*model.AIRiskResult, error) {
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

	userMsg := buildRiskProfileSummary(profile)

	tryOne := func(acc *model.Account) (string, bool, error) {
		if _, slotErr := s.redis.IncrImageSlot(ctx, acc.ID, maxPerAccount); slotErr != nil {
			return "", false, nil
		}
		defer s.redis.DecrImageSlot(ctx, acc.ID)
		txt, e := s.chatText(ctx, modelSlug, aiRiskSystemPrompt, userMsg, acc.AccessToken, proxy, nil)
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
			res, perr := parseAIRiskJSON(txt)
			if perr != nil {
				lastErr = perr
				continue
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
		return nil, fmt.Errorf("AI 分析失败: %w", lastErr)
	}
	return nil, fmt.Errorf("号池为空或全部繁忙")
}

// buildRiskProfileSummary 把画像结构化成给模型的简明文本。
func buildRiskProfileSummary(p *model.UserRiskProfile) string {
	var b strings.Builder
	b.WriteString("用户风险画像：\n")
	fmt.Fprintf(&b, "- 账号年龄：%.0f 小时\n", p.AccountAgeHours)
	fmt.Fprintf(&b, "- 套餐：%s，是否付费：%v，积分：%d\n", nz(p.PlanName), p.IsPaid, p.Points)
	fmt.Fprintf(&b, "- 历史被封次数：%d，当前是否封禁：%v\n", p.BanCount, p.Banned)
	fmt.Fprintf(&b, "- 风控四维分(0-100)：API滥用 %d / 积分滥用 %d / 内容滥用 %d / 账号异常 %d，总分 %d\n",
		p.ScoreAPI, p.ScorePoints, p.ScoreContent, p.ScoreAccount, p.TotalScore)
	fmt.Fprintf(&b, "- 实时信号：窗口请求 %d，错误 %d，去重IP %d，令牌消耗 %d\n",
		p.Snapshots["qps"], p.Snapshots["errors"], p.Snapshots["ips"], p.Snapshots["tokens"])
	fmt.Fprintf(&b, "- 同IP关联其他账号(24h)：%d\n", p.SameIPUsers)
	fmt.Fprintf(&b, "- 近7天邀请注册 %d / 自身注册事件 %d\n", p.InviteRegs7d, p.OwnRegs7d)
	fmt.Fprintf(&b, "- 24h 生图：总 %d / 失败 %d / 重复prompt(≥3次) %d\n", p.TotalGens24h, p.FailedGens24h, p.DupPrompts24h)
	if p.MonthlyQuota > 0 {
		fmt.Fprintf(&b, "- 本月令牌：已用 %d / 配额 %d（%s）\n", p.MonthlyUsed, p.MonthlyQuota,
			ternary(p.MonthlyUsed >= p.MonthlyQuota, "已撞额", "正常"))
	}
	return b.String()
}

func nz(s string) string {
	if s == "" {
		return "无"
	}
	return s
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}

// parseAIRiskJSON 解析模型返回的风险评估 JSON（容忍 markdown 包裹/前后废话）。
func parseAIRiskJSON(raw string) (*model.AIRiskResult, error) {
	s := strings.TrimSpace(raw)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	}
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start < 0 || end < 0 || end <= start {
		return nil, fmt.Errorf("未找到 JSON")
	}
	var res model.AIRiskResult
	if err := json.Unmarshal([]byte(s[start:end+1]), &res); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	if res.Score < 0 {
		res.Score = 0
	}
	if res.Score > 100 {
		res.Score = 100
	}
	res.Level = strings.TrimSpace(res.Level)
	res.Reason = strings.TrimSpace(res.Reason)
	res.Verdict = strings.TrimSpace(res.Verdict)
	if res.Level == "" {
		// 兜底按分数推等级
		switch {
		case res.Score >= 80:
			res.Level = "高"
		case res.Score >= 40:
			res.Level = "中"
		default:
			res.Level = "低"
		}
	}
	return &res, nil
}
