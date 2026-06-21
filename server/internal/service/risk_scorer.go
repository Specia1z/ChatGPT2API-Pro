package service

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// RiskScorer 用户风险评分定时器。
type RiskScorer struct {
	mysql *store.MySQLStore
	redis *store.RedisStore
}

func NewRiskScorer(mysql *store.MySQLStore, redis *store.RedisStore) *RiskScorer {
	return &RiskScorer{mysql: mysql, redis: redis}
}

// loadConfig 从 settings 加载风险配置，缺失时回退默认值。
func (rs *RiskScorer) loadConfig() model.RiskConfig {
	settings, _ := rs.mysql.GetSettings()
	if settings != nil && settings.RiskConfigJSON != "" {
		var cfg model.RiskConfig
		if json.Unmarshal([]byte(settings.RiskConfigJSON), &cfg) == nil {
			if cfg.ScoreIntervalMin <= 0 { cfg.ScoreIntervalMin = 5 }
			return cfg
		}
	}
	return model.DefaultRiskConfig()
}

// Start 启动评分定时器。
func (rs *RiskScorer) Start() {
	cfg := rs.loadConfig()
	interval := time.Duration(cfg.ScoreIntervalMin) * time.Minute
	go func() {
		rs.run()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			rs.run()
		}
	}()
	log.Printf("[risk] 评分定时器已启动，间隔 %v", interval)
}

func (rs *RiskScorer) run() {
	ctx := context.Background()
	cfg := rs.loadConfig()

	ids, err := rs.mysql.GetActiveUserIDs(1)
	if err != nil {
		log.Printf("[risk] 获取活跃用户失败: %v", err)
		return
	}

	var autoBanIDs []int64
	riskThrottled := map[int64]bool{}

	for _, uid := range ids {
		snap := rs.redis.GetRiskSnapshot(ctx, uid)

		scoreAPI := calcAPIScore(snap)
		scorePoints := rs.calcPointsScore(uid)
		scoreContent := rs.calcContentScore(uid)
		scoreAccount := rs.calcAccountScore(uid)

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

	// 自动封禁
	for _, uid := range autoBanIDs {
		user, _ := rs.mysql.GetUserByID(uid)
		if user != nil && user.Status {
			rs.mysql.BanUser(uid)
			rs.mysql.InsertAccountEvent(uid, "ban", "risk_score_auto",
				"风险评分 "+strconv.Itoa(totalScore(rs.mysql, uid))+" 分，自动封禁")
			log.Printf("[risk] 自动封禁 uid=%d (%s)", uid, user.Email)
		}
	}

	// 清理旧评分（超过 24h 未更新的自动重置）
	if n, _ := rs.mysql.BatchResetRiskScores(24 * time.Hour); n > 0 {
		log.Printf("[risk] 清理 %d 条过期评分", n)
	}

	log.Printf("[risk] 评分完成：活跃 %d，封禁 %d", len(ids), len(autoBanIDs))
}

func calcAPIScore(snap map[string]int) int {
	qps := snap["qps"]
	planLimit := 30
	scoreQPS := clamp(qps*30/max(planLimit, 1), 0, 30)
	errs := snap["errors"]
	total := max(qps, 1)
	scoreErr := clamp(errs*40/total, 0, 40)
	ips := snap["ips"]
	scoreIP := clamp(ips*30/10, 0, 30)
	tokens := snap["tokens"]
	scoreTokens := clamp(tokens*20/max(planLimit, 1), 0, 20)
	score := scoreQPS + scoreErr + scoreIP + scoreTokens
	if score > 100 {
		score = 100
	}
	return score
}

func (rs *RiskScorer) calcPointsScore(uid int64) int {
	inv := rs.mysql.CountInviteRegs(uid, 7)
	own := rs.mysql.CountOwnRegs(uid, 7)
	scoreInvite := 0
	if own > 0 {
		scoreInvite = clamp(inv*50/own, 0, 50)
	}
	sameIP := rs.mysql.CountSameIPUsers(uid)
	scoreIP := clamp(sameIP*15, 0, 50)
	return scoreInvite + scoreIP
}

func (rs *RiskScorer) calcContentScore(uid int64) int {
	failed := rs.mysql.CountFailedGens24h(uid)
	total := rs.mysql.CountTotalGens24h(uid)
	scoreFail := 0
	if total > 0 {
		scoreFail = clamp(failed*20/total, 0, 20)
	}
	dup := rs.mysql.CountDupPrompts24h(uid)
	scoreDup := clamp(dup*30, 0, 80)
	return scoreFail + scoreDup
}

func (rs *RiskScorer) calcAccountScore(uid int64) int {
	score := 0
	sameIP := rs.mysql.CountSameIPUsers(uid)
	score += clamp(sameIP*20, 0, 60)
	if rs.mysql.CountBanEvents(uid) > 0 {
		score += 50
	}
	if rs.mysql.AccountAgeHours(uid) < 24 {
		score += 30
	}
	return score
}

func totalScore(s *store.MySQLStore, uid int64) int {
	var t int
	s.RawQueryRow("SELECT total_score FROM user_risk_scores WHERE user_id=?", uid).Scan(&t)
	return t
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
