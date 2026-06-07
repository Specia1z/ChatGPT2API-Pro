package store

import (
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

	s.db.QueryRow("SELECT COUNT(*) FROM orders").Scan(&st.TotalOrders)
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE status='paid'").Scan(&st.PaidOrders)
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
