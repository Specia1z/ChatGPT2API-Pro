package store

import (
	"math"
	"sort"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Stats ---

func (s *MySQLStore) GetAdminStats() (*model.AdminStats, error) {
	var st model.AdminStats

	s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&st.TotalUsers)
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE DATE(created_at)=CURDATE()").Scan(&st.TodayUsers)
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE status=1").Scan(&st.ActiveUsers)

	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='image'").Scan(&st.TotalGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='image' AND DATE(created_at)=CURDATE()").Scan(&st.TodayGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='image' AND status='completed' AND DATE(created_at)=CURDATE()").Scan(&st.TodaySuccess)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='image' AND status='failed' AND DATE(created_at)=CURDATE()").Scan(&st.TodayFailed)

	// 矢量(SVG)生成量：与图片分开统计
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='svg'").Scan(&st.TotalSvg)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='svg' AND DATE(created_at)=CURDATE()").Scan(&st.TodaySvg)

	s.db.QueryRow("SELECT COUNT(*) FROM orders").Scan(&st.TotalOrders)
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE status='paid'").Scan(&st.PaidOrders)
	s.db.QueryRow("SELECT COUNT(DISTINCT user_id) FROM orders WHERE status='paid'").Scan(&st.PaidUsers)
	s.db.QueryRow("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND DATE(created_at)=CURDATE()").Scan(&st.TodayRevenue)
	s.db.QueryRow("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid'").Scan(&st.TotalRevenue)

	s.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&st.TotalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='正常'").Scan(&st.NormalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='限流'").Scan(&st.LimitedAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='异常'").Scan(&st.AbnormalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='禁用'").Scan(&st.DisabledAccounts)

	return &st, nil
}

func (s *MySQLStore) GetStatsTrends(days int) (*model.TrendsData, error) {
	td := &model.TrendsData{}
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	type row struct {
		Date  string
		Value float64
	}
	query := func(q string) ([]model.TrendPoint, error) {
		rows, err := s.db.Query(q, startDate)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var pts []model.TrendPoint
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.Date, &r.Value); err != nil {
				continue
			}
			pts = append(pts, model.TrendPoint{Date: r.Date, Value: r.Value})
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return pts, nil
	}

	var err error
	td.Generations, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE gen_type='image' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.Success, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE gen_type='image' AND status='completed' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.Failed, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE gen_type='image' AND status='failed' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.Revenue, err = query("SELECT DATE(created_at) as d, COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.Users, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM users WHERE created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.Svg, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE gen_type='svg' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.PointsIssued, err = query("SELECT DATE(created_at) as d, COALESCE(SUM(change_amount),0) FROM points_logs WHERE change_amount > 0 AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}
	td.PointsConsumed, err = query("SELECT DATE(created_at) as d, COALESCE(-SUM(change_amount),0) FROM points_logs WHERE change_amount < 0 AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil {
		return nil, err
	}

	// Fill missing days with zero, normalize all dates to MM-DD
	fillDays := func(pts []model.TrendPoint, n int) []model.TrendPoint {
		byDate := map[string]float64{}
		for _, p := range pts {
			d := p.Date
			if len(d) >= 10 {
				d = d[5:10]
			}
			byDate[d] = p.Value
		}
		out := make([]model.TrendPoint, 0, n)
		now := time.Now()
		for i := n - 1; i >= 0; i-- {
			d := now.AddDate(0, 0, -i).Format("01-02")
			v, ok := byDate[d]
			if !ok {
				v = 0
			}
			out = append(out, model.TrendPoint{Date: d, Value: v})
		}
		return out
	}
	td.Generations = fillDays(td.Generations, days)
	td.Success = fillDays(td.Success, days)
	td.Failed = fillDays(td.Failed, days)
	td.Revenue = fillDays(td.Revenue, days)
	td.Users = fillDays(td.Users, days)
	td.Svg = fillDays(td.Svg, days)
	td.PointsIssued = fillDays(td.PointsIssued, days)
	td.PointsConsumed = fillDays(td.PointsConsumed, days)

	return td, nil
}

// GetGenerationsAgeDays 返回最早一条生图记录距今的天数（至少 1）
func (s *MySQLStore) GetGenerationsAgeDays() int {
	var days *int
	s.db.QueryRow("SELECT DATEDIFF(CURDATE(), DATE(MIN(created_at))) FROM generations WHERE gen_type='image'").Scan(&days)
	if days == nil || *days < 1 {
		return 1
	}
	return *days
}

func (s *MySQLStore) GetModelBreakdown() ([]model.ModelBreakdown, error) {
	rows, err := s.db.Query("SELECT COALESCE(model,'unknown') as m, COUNT(*) FROM generations WHERE gen_type='image' GROUP BY m ORDER BY COUNT(*) DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ModelBreakdown
	for rows.Next() {
		var mb model.ModelBreakdown
		rows.Scan(&mb.Model, &mb.Count)
		out = append(out, mb)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []model.ModelBreakdown{}
	}
	return out, nil
}

// GetPointsStats 积分经济看板：今日/累计 发放 vs 消耗，并按 type 拆解。
func (s *MySQLStore) GetPointsStats() (*model.PointsStats, error) {
	var ps model.PointsStats
	s.db.QueryRow("SELECT COALESCE(SUM(change_amount),0) FROM points_logs WHERE change_amount > 0 AND DATE(created_at)=CURDATE()").Scan(&ps.TodayIssued)
	s.db.QueryRow("SELECT COALESCE(-SUM(change_amount),0) FROM points_logs WHERE change_amount < 0 AND DATE(created_at)=CURDATE()").Scan(&ps.TodayConsumed)
	s.db.QueryRow("SELECT COALESCE(SUM(change_amount),0) FROM points_logs WHERE change_amount > 0").Scan(&ps.TotalIssued)
	s.db.QueryRow("SELECT COALESCE(-SUM(change_amount),0) FROM points_logs WHERE change_amount < 0").Scan(&ps.TotalConsumed)

	rows, err := s.db.Query(`SELECT type,
		COALESCE(SUM(CASE WHEN change_amount > 0 THEN change_amount ELSE 0 END),0) AS issued,
		COALESCE(-SUM(CASE WHEN change_amount < 0 THEN change_amount ELSE 0 END),0) AS consumed
		FROM points_logs GROUP BY type ORDER BY (issued + consumed) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t model.PointsTypeStat
		if err := rows.Scan(&t.Type, &t.Issued, &t.Consumed); err != nil {
			continue
		}
		ps.ByType = append(ps.ByType, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if ps.ByType == nil {
		ps.ByType = []model.PointsTypeStat{}
	}
	return &ps, nil
}

// GetUserStats 返回指定用户的统计概览
func (s *MySQLStore) GetUserStats(userID int64) (*model.UserStats, error) {
	var st model.UserStats
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image'", userID).Scan(&st.TotalGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND DATE(created_at)=CURDATE()", userID).Scan(&st.TodayGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)", userID).Scan(&st.WeekGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND status='completed'", userID).Scan(&st.TotalSuccess)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND status='failed'", userID).Scan(&st.TotalFailed)
	return &st, nil
}

// GetUserTrends 返回指定用户近 n 天的每日生成趋势
func (s *MySQLStore) GetUserTrends(userID, days int) ([]model.TrendPoint, error) {
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	rows, err := s.db.Query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND created_at >= ? GROUP BY d ORDER BY d", userID, startDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byDate := map[string]float64{}
	for rows.Next() {
		var date string
		var count float64
		if err := rows.Scan(&date, &count); err != nil {
			continue
		}
		if len(date) >= 10 {
			date = date[5:10]
		}
		byDate[date] = count
	}

	out := make([]model.TrendPoint, 0, days)
	now := time.Now()
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("01-02")
		v, ok := byDate[d]
		if !ok {
			v = 0
		}
		out = append(out, model.TrendPoint{Date: d, Value: v})
	}
	return out, nil
}

// GetUserSuccessRate 返回指定用户今日成功率
func (s *MySQLStore) GetUserSuccessRate(userID int64) float64 {
	var total, success int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND DATE(created_at)=CURDATE()", userID).Scan(&total)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND status='completed' AND DATE(created_at)=CURDATE()", userID).Scan(&success)
	if total == 0 {
		return 100
	}
	return float64(success) / float64(total) * 100
}

// GetFailureReasons 近 days 天失败生成按 error_msg 关键词归类。
// error_msg 是自由文本（超时/号池/并发/HTTP码/内部错误…），直接 GROUP BY 会碎，故用 CASE 归桶。
func (s *MySQLStore) GetFailureReasons(days int) ([]model.FailureReason, error) {
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	rows, err := s.db.Query(`SELECT
		CASE
			WHEN error_msg LIKE '%超时%' THEN '生成超时'
			WHEN error_msg LIKE '%号池%' OR error_msg LIKE '%无可用账号%' THEN '号池耗尽'
			WHEN error_msg LIKE '%并发%' OR error_msg LIKE '%系统繁忙%' THEN '并发受限'
			WHEN error_msg LIKE '%401%' OR error_msg LIKE '%banned%' THEN '账号失效(401)'
			WHEN error_msg LIKE '%429%' OR error_msg LIKE '%限流%' OR error_msg LIKE '%rate%' THEN '限流(429)'
			WHEN error_msg LIKE '%内部错误%' THEN '内部错误'
			WHEN error_msg LIKE '%HTTP%' OR error_msg LIKE '%http%' THEN '上游 HTTP 错误'
			WHEN error_msg IS NULL OR error_msg='' THEN '未知'
			ELSE '其它'
		END AS reason, COUNT(*) AS cnt
		FROM generations
		WHERE status='failed' AND created_at >= ?
		GROUP BY reason ORDER BY cnt DESC`, startDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.FailureReason
	for rows.Next() {
		var f model.FailureReason
		if err := rows.Scan(&f.Reason, &f.Count); err != nil {
			continue
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []model.FailureReason{}
	}
	return out, nil
}

// GetAccountProductivity 账号产能排行：按累计成功数倒序取前 limit 个。
func (s *MySQLStore) GetAccountProductivity(limit int) ([]model.AccountProductivity, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(email,''), status, plan_type,
		success_count, fail_count, COALESCE(DATE_FORMAT(last_used_at,'%Y-%m-%d %H:%i'),'')
		FROM accounts ORDER BY success_count DESC, id ASC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AccountProductivity
	for rows.Next() {
		var a model.AccountProductivity
		if err := rows.Scan(&a.ID, &a.Email, &a.Status, &a.PlanType, &a.SuccessCount, &a.FailCount, &a.LastUsedAt); err != nil {
			continue
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []model.AccountProductivity{}
	}
	return out, nil
}

// GetRetentionStats 留存：基于 generations 出图行为推断（users 无 last_active 字段）。
// 次日留存：注册满 1 天的用户中，在注册后第 1 天（注册日 +1）有出图的比例。
// 7 日留存：注册满 7 天的用户中，在注册后第 7 天有出图的比例。
func (s *MySQLStore) GetRetentionStats() (*model.RetentionStats, error) {
	var rs model.RetentionStats
	s.db.QueryRow("SELECT COUNT(DISTINCT user_id) FROM generations WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)").Scan(&rs.ActiveUsers7d)

	// D1：注册满 1 天的用户为分母；其中注册次日（DATE(reg)+1）有出图为分子。
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE created_at < DATE_SUB(CURDATE(), INTERVAL 1 DAY)").Scan(&rs.D1Cohort)
	s.db.QueryRow(`SELECT COUNT(DISTINCT u.id) FROM users u
		JOIN generations g ON g.user_id=u.id
		WHERE u.created_at < DATE_SUB(CURDATE(), INTERVAL 1 DAY)
		AND DATE(g.created_at) = DATE(u.created_at) + INTERVAL 1 DAY`).Scan(&rs.D1Retained)

	// D7：注册满 7 天的用户为分母；其中注册后第 7 天有出图为分子。
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)").Scan(&rs.D7Cohort)
	s.db.QueryRow(`SELECT COUNT(DISTINCT u.id) FROM users u
		JOIN generations g ON g.user_id=u.id
		WHERE u.created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
		AND DATE(g.created_at) = DATE(u.created_at) + INTERVAL 7 DAY`).Scan(&rs.D7Retained)

	return &rs, nil
}

// GetTokenUsageDistribution ͳ�ƽ� days �졸ÿ�û����������������ֲ�����Դ api_call_logs.tokens_cost����
// ��ͳ�Ƴɹ����ã�status 2xx��tokens_cost>0���������������ھ�һ�¡�
// �ٷ�λ�� Go ����㣨MySQL 8 �ޱ�ݷ�λ�ۺϣ���
func (s *MySQLStore) GetTokenUsageDistribution(days int) (*model.TokenUsageDistribution, error) {
	if days <= 0 {
		days = 30
	}
	d := &model.TokenUsageDistribution{Days: days}
	rows, err := s.db.Query(`SELECT COALESCE(SUM(tokens_cost),0) AS used
		FROM api_call_logs
		WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
		  AND status_code BETWEEN 200 AND 299 AND tokens_cost > 0
		GROUP BY user_id`, days)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	var vals []int
	for rows.Next() {
		var v int
		if rows.Scan(&v) == nil && v > 0 {
			vals = append(vals, v)
		}
	}
	if err := rows.Err(); err != nil {
		return d, err
	}
	d.UserCount = len(vals)
	if d.UserCount == 0 {
		return d, nil
	}
	sort.Ints(vals)
	pct := func(p float64) int {
		// ����ȷ���idx = ceil(p/100 * n) - 1
		idx := int(math.Ceil(p/100*float64(len(vals)))) - 1
		if idx < 0 {
			idx = 0
		}
		if idx >= len(vals) {
			idx = len(vals) - 1
		}
		return vals[idx]
	}
	d.P50 = pct(50)
	d.P90 = pct(90)
	d.P95 = pct(95)
	d.P99 = pct(99)
	d.Max = vals[len(vals)-1]
	// 建议月配额 = P99 × 4，按量级自适应向上取整（避免小数值被粗暴抬高）。
	sug := d.P99 * 4
	if sug > 0 {
		var step int
		switch {
		case sug < 100:
			step = 10
		case sug < 1000:
			step = 50
		default:
			step = 100
		}
		sug = ((sug + step - 1) / step) * step
	}
	d.Suggested = sug
	return d, nil
}
