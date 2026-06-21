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
// 强约束：信号组合判定 + 数值参照 + few-shot 示例 + reason 引用具体数据；只做研判建议，不下达自动处置。
const aiRiskSystemPrompt = `你是 AI 图片生成平台的资深风控分析师。基于用户的多维行为画像，评估其「滥用 / 二次分发(中转站转卖) / 作弊」风险，给出风险分、等级、理由、处置建议。

【输出格式·绝对严格】
只输出一个 JSON 对象，无任何解释、前缀、markdown 代码块、多余文字：
{"score":整数0-100,"level":"低|中|高","reason":"中文理由,必须引用画像中的具体数字(60字内)","verdict":"正常|观察|限流|封禁"}

【核心判定原则·务必遵守】
1. 单一信号不足以定高危——必须「多信号共振」才判中高风险。例如：仅同IP关联多账号可能是公司/校园/家庭共用网络（正常）；但「同IP关联多账号 + 撞月配额 + 高频调用」三者同时出现，才是中转站转卖的铁证。
2. 强力降险信号优先：账号注册超 30 天(720h) + 有真实付费，即使用量大也几乎一定是正常重度用户，score 不应超过 40。宁可漏放，不可冤枉付费老用户。
3. reason 必须落到具体数字（如「同IP关联23个账号+本月已用12万/配额5万」），不许写「疑似滥用」这类空话，便于管理员核实。

【风险信号与数值参照】
高风险（多个并发出现才显著）：
- 同IP关联其他账号 > 10 个（多开/中转站嫌疑；> 30 个高度可疑）
- 账号年龄 < 24h 且 24h 生图 > 50（新号高频）
- 错误率高：错误数 / 窗口请求 > 30%（脚本异常）
- 24h 重复prompt(≥3次) > 5 组（脚本刷量）
- 近7天邀请注册 / 自身注册 > 5 倍（刷邀请裂变）
- 撞月配额(已用≥配额) 且 去重IP > 20（产能转卖嫌疑）
- 历史被封次数 > 0（再犯倾向）
降风险：账号年龄 > 720h、有真实付费、IP 数 ≤ 3、用量平稳、无被封史。

【分数锚点】
- 0-30 正常：信号干净，或付费老用户即便用量大。
- 40-65 可疑：1-2 个中等信号，需观察。
- 65-85 高度可疑：多信号共振，疑似滥用/转卖。
- 86-100 明确滥用：强信号叠加（如多IP+撞额+高频+被封史）。
verdict 与 score 对应：<40 正常、40-65 观察、65-85 限流、>85 封禁（仅建议人工，不自动执行）。

【示例】
输入画像：账号年龄 1800 小时；套餐 专业版，付费 true；被封 0 次；四维分 API 12/积分 0/内容 5/账号 8 总分 9；实时 请求 40 错误 1 IP 2 令牌 800；同IP关联 1；近7天邀请 0/自身 1；24h 生图 总60 失败2 重复0；本月令牌 已用 8000/配额 50000 正常。
输出：{"score":12,"level":"低","reason":"注册1800h付费老用户,IP仅2个、无重复prompt、用量平稳(8000/50000),正常重度使用","verdict":"正常"}

输入画像：账号年龄 6 小时；套餐 免费版，付费 false；被封 0 次；四维分 API 70/积分 40/内容 60/账号 55 总分 58；实时 请求 280 错误 90 IP 35 令牌 4200；同IP关联 28；近7天邀请 0/自身 1；24h 生图 总180 失败60 重复12；本月令牌 已用 0/配额 0。
输出：{"score":90,"level":"高","reason":"6h新号+同IP关联28账号+35个IP高频280次+12组重复prompt+错误率32%,典型脚本/中转站特征","verdict":"封禁"}

输入画像：账号年龄 200 小时；套餐 基础版，付费 true；被封 0 次；四维分总分 35；实时 请求 60 错误 3 IP 8 令牌 1500；同IP关联 6；近7天邀请 9/自身 1；24h 生图 总40 失败3 重复1；本月令牌 已用 0/配额 0。
输出：{"score":52,"level":"中","reason":"付费用户但近7天邀请9次远超自身注册(9倍),疑似刷邀请裂变;IP8个偏多,建议观察","verdict":"观察"}

【再次强调】只返回那一个 JSON 对象，reason 必须含具体数字。`

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
