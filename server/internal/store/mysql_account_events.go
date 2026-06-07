package store

import (
	"time"

	"chatgpt2api-pro/internal/model"
)

// logAccountEvent 写一条账号事件流水。失败仅吞掉（辅助记录，不阻断主流程）。
// event 取值：register（注册/添加）/ ban（401 封禁）/ delete（删除：手动/异常/禁用清理）。
func (s *MySQLStore) logAccountEvent(accountID int64, email, event, reason string) {
	s.db.Exec(
		"INSERT INTO account_events (account_id, email, event, reason) VALUES (?,?,?,?)",
		accountID, email, event, reason)
}

// GetAccountEventStats 账号事件累计统计：今日/累计 注册、封禁、删除数。
func (s *MySQLStore) GetAccountEventStats() (*model.AccountEventStats, error) {
	var es model.AccountEventStats
	q := func(event, when string) int {
		var n int
		s.db.QueryRow("SELECT COUNT(*) FROM account_events WHERE event=? "+when, event).Scan(&n)
		return n
	}
	es.TodayRegistered = q("register", "AND DATE(created_at)=CURDATE()")
	es.TotalRegistered = q("register", "")
	es.TodayBanned = q("ban", "AND DATE(created_at)=CURDATE()")
	es.TotalBanned = q("ban", "")
	es.TodayDeleted = q("delete", "AND DATE(created_at)=CURDATE()")
	es.TotalDeleted = q("delete", "")
	return &es, nil
}

// GetAccountEventTrends 近 days 天 注册/封禁/删除 每日趋势（补零、MM-DD）。
func (s *MySQLStore) GetAccountEventTrends(days int) (*model.AccountEventTrends, error) {
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	series := func(event string) ([]model.TrendPoint, error) {
		rows, err := s.db.Query(
			"SELECT DATE(created_at) as d, COUNT(*) FROM account_events WHERE event=? AND created_at >= ? GROUP BY d ORDER BY d",
			event, startDate)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		byDate := map[string]float64{}
		for rows.Next() {
			var d string
			var c float64
			if rows.Scan(&d, &c) != nil {
				continue
			}
			if len(d) >= 10 {
				d = d[5:10]
			}
			byDate[d] = c
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		out := make([]model.TrendPoint, 0, days)
		now := time.Now()
		for i := days - 1; i >= 0; i-- {
			d := now.AddDate(0, 0, -i).Format("01-02")
			out = append(out, model.TrendPoint{Date: d, Value: byDate[d]})
		}
		return out, nil
	}

	td := &model.AccountEventTrends{}
	var err error
	if td.Registered, err = series("register"); err != nil {
		return nil, err
	}
	if td.Banned, err = series("ban"); err != nil {
		return nil, err
	}
	if td.Deleted, err = series("delete"); err != nil {
		return nil, err
	}
	return td, nil
}
