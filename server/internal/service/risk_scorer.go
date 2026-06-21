package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// RiskScorer 用户风险评分定时器。
type RiskScorer struct {
	mysql           *store.MySQLStore
	redis           *store.RedisStore
	superadminEmail string
}

func NewRiskScorer(mysql *store.MySQLStore, redis *store.RedisStore, superadminEmail string) *RiskScorer {
	return &RiskScorer{mysql: mysql, redis: redis, superadminEmail: superadminEmail}
}

// loadConfig 从 settings 加载风险配置。
// 采用 default-base 覆盖：以 DefaultRiskConfig 为底，再用 JSON 中显式提供的字段覆盖，
// 数值型字段遵循「0=用默认」（除权重外，权重允许显式 0），布尔/序列/字符串按 JSON 原值。
// 这样旧配置 JSON 升级后新增字段自动取默认，无需迁移，也无需在 calc* 里散落 if<=0。
func (rs *RiskScorer) loadConfig() model.RiskConfig {
	cfg := model.DefaultRiskConfig()
	settings, _ := rs.mysql.GetSettings()
	if settings == nil || settings.RiskConfigJSON == "" {
		return cfg
	}
	var raw model.RiskConfig
	if json.Unmarshal([]byte(settings.RiskConfigJSON), &raw) != nil {
		return cfg
	}
	// 阈值与窗口（0=保留默认）
	ovInt := func(dst *int, v int) { if v > 0 { *dst = v } }
	ovInt(&cfg.FlagThreshold, raw.FlagThreshold)
	ovInt(&cfg.LimitThreshold, raw.LimitThreshold)
	ovInt(&cfg.BanThreshold, raw.BanThreshold)
	ovInt(&cfg.ScoreIntervalMin, raw.ScoreIntervalMin)
	ovInt(&cfg.WindowMinutes, raw.WindowMinutes)
	// 权重：允许显式 0（某维度可被关掉），仅当四项全 0（旧配置无此段）才保留默认
	if raw.WeightAPI != 0 || raw.WeightPoints != 0 || raw.WeightContent != 0 || raw.WeightAccount != 0 {
		cfg.WeightAPI, cfg.WeightPoints = raw.WeightAPI, raw.WeightPoints
		cfg.WeightContent, cfg.WeightAccount = raw.WeightContent, raw.WeightAccount
	}
	// 灵敏度子参数（0=保留默认）
	ovInt(&cfg.APIRateBudgetMult, raw.APIRateBudgetMult)
	ovInt(&cfg.APIErrMinSamples, raw.APIErrMinSamples)
	ovInt(&cfg.APIIPThreshold, raw.APIIPThreshold)
	ovInt(&cfg.InviteWindowDays, raw.InviteWindowDays)
	ovInt(&cfg.DupPromptUnit, raw.DupPromptUnit)
	ovInt(&cfg.FailRateMax, raw.FailRateMax)
	ovInt(&cfg.SameIPUnit, raw.SameIPUnit)
	ovInt(&cfg.SameIPMax, raw.SameIPMax)
	ovInt(&cfg.BanHistoryScore, raw.BanHistoryScore)
	ovInt(&cfg.NewAccountHours, raw.NewAccountHours)
	ovInt(&cfg.NewAccountScore, raw.NewAccountScore)
	// 封禁策略
	cfg.BanDurationMinutes = raw.BanDurationMinutes // 允许显式 0=永久
	cfg.BanEscalation = raw.BanEscalation
	if len(raw.BanLadder) > 0 {
		cfg.BanLadder = raw.BanLadder
	}
	cfg.AppealContact = raw.AppealContact
	return cfg
}

// Start 启动评分定时器。
func (rs *RiskScorer) Start() {
	cfg := rs.loadConfig()
	interval := time.Duration(cfg.ScoreIntervalMin) * time.Minute
	// 启动即把采集窗口同步给 RiskRecorder，保证首轮前的采集就用正确窗口。
	middleware.SetRiskWindow(cfg.WindowMinutes)
	go func() {
		// 启动时先清空 Redis 中所有旧计数器，避免上次运行时积压的数据虚高首轮评分
		ids, _ := rs.mysql.GetActiveUserIDs(1)
		for _, uid := range ids {
			rs.redis.ResetRisk(context.Background(), uid)
		}
		// 等第一个间隔后再跑首轮，让中间件重新采集新鲜数据
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			rs.run()
		}
	}()
	log.Printf("[risk] 评分定时器已启动，间隔 %v（首轮将在 %v 后运行）", interval, interval)
}

func (rs *RiskScorer) run() {
	ctx := context.Background()
	cfg := rs.loadConfig()

	// 热同步采集窗口给 RiskRecorder（后台改窗口后下一轮生效）。
	middleware.SetRiskWindow(cfg.WindowMinutes)

	ids, err := rs.mysql.GetActiveUserIDs(1)
	if err != nil {
		log.Printf("[risk] 获取活跃用户失败: %v", err)
		return
	}

	var autoBanIDs []int64
	riskThrottled := map[int64]bool{}

	for _, uid := range ids {
		user, _ := rs.mysql.GetUserByID(uid)
		// 跳过 superadmin（role=0 但 .env 指定，不受评分系统限制）
		if rs.superadminEmail != "" && user != nil && user.Email == rs.superadminEmail {
			continue
		}
		snap := rs.redis.GetRiskSnapshot(ctx, uid)

		scoreAPI := calcAPIScore(snap, user, cfg)
		scorePoints := rs.calcPointsScore(uid, cfg)
		scoreContent := rs.calcContentScore(uid, cfg)
		scoreAccount := rs.calcAccountScore(uid, cfg)

		total := (scoreAPI*cfg.WeightAPI + scorePoints*cfg.WeightPoints +
			scoreContent*cfg.WeightContent + scoreAccount*cfg.WeightAccount) / 100

		if err := rs.mysql.UpsertRiskScore(uid, scoreAPI, scorePoints, scoreContent, scoreAccount, total); err != nil {
			log.Printf("[risk] 写入 uid=%d 评分失败: %v", uid, err)
			continue
		}

		if total >= cfg.BanThreshold {
			autoBanIDs = append(autoBanIDs, uid)
		} else if total >= cfg.LimitThreshold {
			riskThrottled[uid] = true
		}
	}

	// 热更新：风险限流列表（≥ limit_threshold 且 < ban_threshold）
	middleware.SetRiskLimitedUIDs(riskThrottled)

	// 自动封禁（支持阶梯时长）
	for _, uid := range autoBanIDs {
		user, _ := rs.mysql.GetUserByID(uid)
		if user == nil || !user.Status {
			continue
		}
		score := totalScore(rs.mysql, uid)
		banCount := rs.mysql.GetUserBanCount(uid)

		// 读取各维度分数，生成易读的评分理由
		var s model.UserRiskScore
		rs.mysql.RawQueryRow("SELECT COALESCE(score_api,0), COALESCE(score_points,0), COALESCE(score_content,0), COALESCE(score_account,0) FROM user_risk_scores WHERE user_id=?", uid).
			Scan(&s.ScoreAPI, &s.ScorePoints, &s.ScoreContent, &s.ScoreAccount)
		reasons := store.ScoreReasons(s)
		if reasons == "" {
			reasons = "综合风险"
		}

		duration := cfg.BanDurationMinutes
		if cfg.BanEscalation && len(cfg.BanLadder) > 0 {
			// 阶梯：按历史封禁次数取对应档位；超出序列长度用最后一级。
			idx := banCount
			if idx >= len(cfg.BanLadder) {
				idx = len(cfg.BanLadder) - 1
			}
			duration = cfg.BanLadder[idx]
		}

		reason := buildBanReason(score, reasons, banCount+1, duration, cfg.AppealContact)
		rs.mysql.BanUserWithDuration(uid, reason, duration)
		rs.mysql.InsertAccountEvent(uid, "ban", "risk_score_auto",
			fmt.Sprintf("评分 %d，第 %d 次，%s", score, banCount+1, banDurationText(duration)))
		log.Printf("[risk] 自动封禁 uid=%d (%s) 评分=%d 第%d次 时长=%s", uid, user.Email, score, banCount+1, banDurationText(duration))
	}

	// 检查是否有已过期的临时封禁需自动解封
	if n, err := rs.mysql.UnbanExpired(); err == nil && n > 0 {
		log.Printf("[risk] 自动解封 %d 位用户（临时封禁到期）", n)
	}

	// 清理旧评分（超过 24h 未更新的自动重置）
	if n, _ := rs.mysql.BatchResetRiskScores(24 * time.Hour); n > 0 {
		log.Printf("[risk] 清理 %d 条过期评分", n)
	}

	log.Printf("[risk] 评分完成：活跃 %d，封禁 %d", len(ids), len(autoBanIDs))
}

// calcAPIScore 计算 API 滥用分（0-100）。
// 注意：snap["qps"] 实为窗口内的请求计数（RiskRecorder 每请求 +1），并非每秒 QPS。
func calcAPIScore(snap map[string]int, user *model.User, cfg model.RiskConfig) int {
	// reqCount: 采集窗口内的请求总数。
	reqCount := snap["qps"]

	// 镜像 UserRateLimit 的生效速率解析（套餐 > 后台默认 > 内置兜底 30），保持量纲一致。
	// 内置兜底 30/min 对齐 router.go 传入 UserRateLimit 的基线。
	ratePerMin := 30
	if d := middleware.GetDefaultUserRate(); d > 0 {
		ratePerMin = d
	}
	if user != nil && user.RateLimitPerMin > 0 {
		ratePerMin = user.RateLimitPerMin
	}
	reqBudget := ratePerMin * cfg.APIRateBudgetMult // 窗口配额 = 速率/min × 倍数
	scoreReq := clamp(reqCount*30/max(reqBudget, 1), 0, 30)

	// 错误率：需足够样本量，避免低频用户单次失败即满分。
	errs := snap["errors"]
	scoreErr := 0
	if reqCount >= cfg.APIErrMinSamples {
		scoreErr = clamp(errs*40/reqCount, 0, 40)
	}

	// IP 切换数：达到阈值个去重 IP 即触满。
	ips := snap["ips"]
	scoreIP := clamp(ips*30/max(cfg.APIIPThreshold, 1), 0, 30)

	// 令牌消耗：按套餐令牌桶容量衡量。
	tokenBudget := 50
	if user != nil && user.TokenCapacity > 0 {
		tokenBudget = user.TokenCapacity
	}
	tokens := snap["tokens"]
	scoreTokens := clamp(tokens*20/max(tokenBudget, 1), 0, 20)

	return clamp(scoreReq+scoreErr+scoreIP+scoreTokens, 0, 100)
}

func (rs *RiskScorer) calcPointsScore(uid int64, cfg model.RiskConfig) int {
	// 积分滥用维度：聚焦邀请裂变作弊（邀请注册数 / 自身相关注册数 的异常比例）。
	// 同 IP 多号信号统一归入「账号异常」维度（calcAccountScore），此处不再重复计分。
	inv := rs.mysql.CountInviteRegs(uid, cfg.InviteWindowDays)
	own := rs.mysql.CountOwnRegs(uid, cfg.InviteWindowDays)
	if own <= 0 {
		return 0
	}
	return clamp(inv*100/own, 0, 100)
}

func (rs *RiskScorer) calcContentScore(uid int64, cfg model.RiskConfig) int {
	failed := rs.mysql.CountFailedGens24h(uid)
	total := rs.mysql.CountTotalGens24h(uid)
	scoreFail := 0
	if total > 0 {
		scoreFail = clamp(failed*cfg.FailRateMax/total, 0, cfg.FailRateMax)
	}
	dup := rs.mysql.CountDupPrompts24h(uid)
	// 重复 prompt 子项上限 = 100 - 失败率上限，保证两项相加不超 100。
	dupMax := clamp(100-cfg.FailRateMax, 0, 100)
	scoreDup := clamp(dup*cfg.DupPromptUnit, 0, dupMax)
	return clamp(scoreFail+scoreDup, 0, 100)
}

func (rs *RiskScorer) calcAccountScore(uid int64, cfg model.RiskConfig) int {
	score := 0
	sameIP := rs.mysql.CountSameIPUsers(uid)
	score += clamp(sameIP*cfg.SameIPUnit, 0, cfg.SameIPMax)
	if rs.mysql.CountBanEvents(uid) > 0 {
		score += cfg.BanHistoryScore
	}
	if rs.mysql.AccountAgeHours(uid) < float64(cfg.NewAccountHours) {
		score += cfg.NewAccountScore
	}
	// 各子项相加可能超 100，需夹到 0-100，否则代入加权公式会使总分超过 100，破坏阈值语义。
	return clamp(score, 0, 100)
}

func totalScore(s *store.MySQLStore, uid int64) int {
	var t int
	s.RawQueryRow("SELECT total_score FROM user_risk_scores WHERE user_id=?", uid).Scan(&t)
	return t
}

// banDurationText 把封禁时长（分钟）格式化为人性化文案。0=永久。
func banDurationText(minutes int) string {
	switch {
	case minutes <= 0:
		return "永久封禁"
	case minutes < 60:
		return fmt.Sprintf("封禁 %d 分钟", minutes)
	case minutes%1440 == 0:
		return fmt.Sprintf("封禁 %d 天", minutes/1440)
	case minutes%60 == 0:
		return fmt.Sprintf("封禁 %d 小时", minutes/60)
	default:
		return fmt.Sprintf("封禁 %d 小时 %d 分钟", minutes/60, minutes%60)
	}
}

// buildBanReason 组装面向用户的封禁提示：处置结果 + 触发原因 + 解封说明 + 申诉入口。
func buildBanReason(score int, reasons string, violationNo, durationMin int, appeal string) string {
	var b strings.Builder
	// 1) 处置结果（放最前，用户一眼看到）
	b.WriteString("您的账号已被系统自动")
	b.WriteString(banDurationText(durationMin))
	b.WriteString("。")
	// 2) 触发原因（去掉裸分数，改为风险类型；分数仅作技术参考保留括号内）
	if reasons != "" && reasons != "综合风险" {
		b.WriteString(fmt.Sprintf("触发原因：%s（风险评分 %d）。", reasons, score))
	} else {
		b.WriteString(fmt.Sprintf("触发原因：综合风险评分过高（%d）。", score))
	}
	// 3) 次数与解封说明
	if durationMin > 0 {
		b.WriteString(fmt.Sprintf("这是第 %d 次触发，到期后将自动解封；若再次触发，封禁时长会升级。", violationNo))
	} else {
		b.WriteString(fmt.Sprintf("这是第 %d 次触发，已永久封禁。", violationNo))
	}
	// 4) 申诉入口
	if appeal != "" {
		b.WriteString(fmt.Sprintf("如系误判，请通过 %s 联系管理员申诉。", appeal))
	} else {
		b.WriteString("如有疑问或认为系误判，请联系管理员申诉。")
	}
	return b.String()
}

func clamp(v, lo, hi int) int {
	if v < lo { return lo }
	if v > hi { return hi }
	return v
}

func max(a, b int) int {
	if a > b { return a }
	return b
}
