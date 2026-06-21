package store

import (
	"context"

	"chatgpt2api-pro/internal/model"
)

// GetUserRiskProfile 聚合单个用户的多维风险画像（供人工研判 + AI 风控输入）。
// 复用既有的各维度计数函数 + Redis 实时快照，不引入新查询口径。
func (s *MySQLStore) GetUserRiskProfile(ctx context.Context, redis *RedisStore, uid int64) (*model.UserRiskProfile, error) {
	user, err := s.GetUserByID(uid)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, nil
	}

	p := &model.UserRiskProfile{
		UserID:   uid,
		Email:    user.Email,
		PlanName: user.PlanName,
		Points:   user.Points,
		Banned:   !user.Status,
	}

	// 账号基础
	p.AccountAgeHours = s.AccountAgeHours(uid)
	p.BanCount = s.CountBanEvents(uid)
	p.MonthlyQuota = user.MonthlyQuota
	if user.CreatedAt != "" {
		p.CreatedAt = user.CreatedAt
	}
	// 是否付费：有过 paid 订单
	var paidCnt int
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE user_id=? AND status='paid'", uid).Scan(&paidCnt)
	p.IsPaid = paidCnt > 0

	// 风控四维分（可能无记录，零值即可）
	s.db.QueryRow(`SELECT COALESCE(score_api,0), COALESCE(score_points,0), COALESCE(score_content,0), COALESCE(score_account,0), COALESCE(total_score,0)
		FROM user_risk_scores WHERE user_id=?`, uid).
		Scan(&p.ScoreAPI, &p.ScorePoints, &p.ScoreContent, &p.ScoreAccount, &p.TotalScore)

	// 行为信号
	p.SameIPUsers = s.CountSameIPUsers(uid)
	p.InviteRegs7d = s.CountInviteRegs(uid, 7)
	p.OwnRegs7d = s.CountOwnRegs(uid, 7)
	p.FailedGens24h = s.CountFailedGens24h(uid)
	p.TotalGens24h = s.CountTotalGens24h(uid)
	p.DupPrompts24h = s.CountDupPrompts24h(uid)

	// 实时快照 + 月用量
	if redis != nil {
		p.Snapshots = redis.GetRiskSnapshot(ctx, uid)
		if p.MonthlyQuota > 0 {
			p.MonthlyUsed = redis.GetMonthlyUsage(ctx, uid)
		}
	}
	if p.Snapshots == nil {
		p.Snapshots = map[string]int{}
	}

	return p, nil
}
