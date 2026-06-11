package store

import (
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/apilog"
	"chatgpt2api-pro/internal/model"
)

// BatchInsertAPICallLogs 多行 INSERT 一批调用日志。供 apilog.Writer 的 flush 回调使用。
func (s *MySQLStore) BatchInsertAPICallLogs(batch []apilog.Record) error {
	if len(batch) == 0 {
		return nil
	}
	var sb strings.Builder
	sb.WriteString("INSERT INTO api_call_logs (user_id, api_key_id, endpoint, status_code, tokens_cost, count, latency_ms) VALUES ")
	args := make([]any, 0, len(batch)*7)
	for i, r := range batch {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("(?,?,?,?,?,?,?)")
		args = append(args, r.UserID, r.APIKeyID, r.Endpoint, r.StatusCode, r.TokensCost, r.Count, r.LatencyMs)
	}
	_, err := s.db.Exec(sb.String(), args...)
	return err
}

// DeleteAPICallLogsBefore 删除 retentionDays 天前的调用日志，返回删除行数。
func (s *MySQLStore) DeleteAPICallLogsBefore(retentionDays int) (int64, error) {
	res, err := s.db.Exec("DELETE FROM api_call_logs WHERE created_at < NOW() - INTERVAL ? DAY", retentionDays)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// GetAPIUsageSummary 聚合指定用户近 days 天的 API 调用用量。
func (s *MySQLStore) GetAPIUsageSummary(userID int64, days int) (*model.APIUsageSummary, error) {
	sum := &model.APIUsageSummary{
		ByEndpoint: []model.APIUsageDimension{},
		ByKey:      []model.APIUsageKeyDim{},
		Trend:      []model.APIUsageTrendPoint{},
	}
	since := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	// 概览：总数/成功(2xx)/失败/429/令牌
	s.db.QueryRow(`SELECT
		COUNT(*),
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?`, userID, since).
		Scan(&sum.TotalCalls, &sum.SuccessCalls, &sum.FailedCalls, &sum.RateLimited, &sum.TotalTokens)

	// 按端点
	if rows, err := s.db.Query(`SELECT endpoint, COUNT(*), COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?
		GROUP BY endpoint ORDER BY COUNT(*) DESC`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageDimension
			if rows.Scan(&d.Name, &d.Calls, &d.Tokens) == nil {
				sum.ByEndpoint = append(sum.ByEndpoint, d)
			}
		}
	}

	// 按 Key（LEFT JOIN 取 Key 名；未解析 api_key_id=0 显示「未知」）
	if rows, err := s.db.Query(`SELECT l.api_key_id, COALESCE(k.name,''), COUNT(*), COALESCE(SUM(l.tokens_cost),0)
		FROM api_call_logs l LEFT JOIN user_api_keys k ON l.api_key_id=k.id
		WHERE l.user_id=? AND l.created_at >= ?
		GROUP BY l.api_key_id, k.name ORDER BY COUNT(*) DESC`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageKeyDim
			if rows.Scan(&d.KeyID, &d.KeyName, &d.Calls, &d.Tokens) == nil {
				if d.KeyName == "" {
					d.KeyName = "未知"
				}
				sum.ByKey = append(sum.ByKey, d)
			}
		}
	}

	// 每日趋势（成功 vs 失败），补零并归一化为 MM-DD
	trendMap := map[string][2]int{} // date -> [success, failed]
	if rows, err := s.db.Query(`SELECT DATE(created_at) AS d,
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0)
		FROM api_call_logs WHERE user_id=? AND created_at >= ?
		GROUP BY d ORDER BY d`, userID, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d string
			var ok, fail int
			if rows.Scan(&d, &ok, &fail) == nil {
				if len(d) >= 10 {
					d = d[5:10]
				}
				trendMap[d] = [2]int{ok, fail}
			}
		}
	}
	now := time.Now()
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("01-02")
		v := trendMap[d]
		sum.Trend = append(sum.Trend, model.APIUsageTrendPoint{Date: d, Success: v[0], Failed: v[1]})
	}

	return sum, nil
}

// GetAPICallLogs 分页查询调用明细，支持按 Key/端点/状态筛选。返回 (items, total)。
// page/pageSize/keyID/status 均为已 clamp 的整数，拼接安全；其余值走参数化占位符。
func (s *MySQLStore) GetAPICallLogs(userID int64, page, pageSize int, keyID int64, endpoint string, status int) ([]model.APICallLog, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	where := "WHERE l.user_id=?"
	args := []any{userID}
	if keyID > 0 {
		where += " AND l.api_key_id=?"
		args = append(args, keyID)
	}
	if endpoint != "" {
		where += " AND l.endpoint=?"
		args = append(args, endpoint)
	}
	if status > 0 {
		where += " AND l.status_code=?"
		args = append(args, status)
	}

	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM api_call_logs l "+where, args...).Scan(&total)

	q := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') " +
		"FROM api_call_logs l LEFT JOIN user_api_keys k ON l.api_key_id=k.id " + where +
		" ORDER BY l.id DESC LIMIT " + strconv.Itoa(pageSize) + " OFFSET " + strconv.Itoa((page-1)*pageSize)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, total, rows.Err()
}
