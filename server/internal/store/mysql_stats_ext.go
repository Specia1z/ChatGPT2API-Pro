package store

import (
	"chatgpt2api-pro/internal/model"
)

// AccountSlotInfo 账号占用统计用的轻量信息（id/email/状态）。
type AccountSlotInfo struct {
	ID     int64
	Email  string
	Status string
}

// ListAccountSlotInfo 返回所有账号的轻量信息（供号池占用统计关联 Redis 槽位）。
func (s *MySQLStore) ListAccountSlotInfo() ([]AccountSlotInfo, error) {
	rows, err := s.db.Query("SELECT id, COALESCE(email,''), status FROM accounts")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccountSlotInfo
	for rows.Next() {
		var a AccountSlotInfo
		if rows.Scan(&a.ID, &a.Email, &a.Status) != nil {
			continue
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// GetHourlyHeat 出图时段分布：按小时(0-23)聚合 image 生成量（累计，含全部历史）。
func (s *MySQLStore) GetHourlyHeat() ([]model.HourlyHeat, error) {
	rows, err := s.db.Query("SELECT HOUR(created_at) AS h, COUNT(*) FROM generations WHERE gen_type='image' GROUP BY h")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byHour := map[int]int{}
	for rows.Next() {
		var h, c int
		if rows.Scan(&h, &c) != nil {
			continue
		}
		byHour[h] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.HourlyHeat, 24)
	for h := 0; h < 24; h++ {
		out[h] = model.HourlyHeat{Hour: h, Count: byHour[h]}
	}
	return out, nil
}

// GetPlanDistribution 套餐订阅分布：按 plan 统计当前活跃（未过期/永久）与已过期订阅数。
// 仅统计 plan_id>0 的付费用户；subscription_expires_at 为 NULL 视为永久=活跃。
func (s *MySQLStore) GetPlanDistribution() ([]model.PlanDistribution, error) {
	rows, err := s.db.Query(`SELECT COALESCE(p.name, CONCAT('套餐#', u.plan_id)) AS plan_name,
		SUM(CASE WHEN u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW() THEN 1 ELSE 0 END) AS active,
		SUM(CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at <= NOW() THEN 1 ELSE 0 END) AS expired
		FROM users u LEFT JOIN plans p ON u.plan_id = p.id
		WHERE u.plan_id > 0
		GROUP BY u.plan_id, plan_name
		ORDER BY active DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.PlanDistribution
	for rows.Next() {
		var d model.PlanDistribution
		if rows.Scan(&d.PlanName, &d.Active, &d.Expired) != nil {
			continue
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []model.PlanDistribution{}
	}
	return out, nil
}

// GetRevenueComposition 营收构成：各套餐已付订单数/金额 + 优惠券使用占比。
func (s *MySQLStore) GetRevenueComposition() (*model.RevenueComposition, error) {
	rc := &model.RevenueComposition{ByPlan: []model.RevenueByPlan{}}
	rows, err := s.db.Query(`SELECT COALESCE(NULLIF(plan_name,''),'未知套餐') AS pn, COUNT(*), COALESCE(SUM(amount),0)
		FROM orders WHERE status='paid' GROUP BY pn ORDER BY SUM(amount) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r model.RevenueByPlan
		if rows.Scan(&r.PlanName, &r.Orders, &r.Amount) != nil {
			continue
		}
		rc.ByPlan = append(rc.ByPlan, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE status='paid'").Scan(&rc.TotalPaid)
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE status='paid' AND coupon_code != ''").Scan(&rc.CouponOrders)
	return rc, nil
}

// GetInviteLeaderboard 邀请裂变榜：Top limit 邀请人，含邀请数、首充转化数、累计积分。
func (s *MySQLStore) GetInviteLeaderboard(limit int) ([]model.InviteLeader, error) {
	rows, err := s.db.Query(`SELECT COALESCE(u.email,CONCAT('用户#',il.inviter_id)) AS email,
		COUNT(*) AS invites,
		SUM(il.rewarded_recharge) AS recharged,
		COALESCE(SUM(il.reward_register + il.reward_recharge),0) AS reward_sum
		FROM invite_logs il LEFT JOIN users u ON il.inviter_id = u.id
		GROUP BY il.inviter_id, email
		ORDER BY invites DESC, reward_sum DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.InviteLeader
	for rows.Next() {
		var l model.InviteLeader
		if rows.Scan(&l.Email, &l.Invites, &l.Recharged, &l.RewardSum) != nil {
			continue
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []model.InviteLeader{}
	}
	return out, nil
}
