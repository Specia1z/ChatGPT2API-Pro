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
	// 用事务确保 SET NAMES 和 INSERT 在同一连接上执行。
	// Windows GBK locale 下 go-sql-driver/mysql 可能不会对池中每条连接自动 SET NAMES，
	// 导致 prompt/image_url 中的中文被当作 GBK 存储为乱码。
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tx.Exec("SET NAMES utf8mb4")

	var sb strings.Builder
	sb.WriteString("INSERT INTO api_call_logs (user_id, api_key_id, endpoint, source, ip, prompt, image_url, status_code, tokens_cost, count, latency_ms) VALUES ")
	args := make([]any, 0, len(batch)*11)
	for i, r := range batch {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("(?,?,?,?,?,?,?,?,?,?,?)")
		source := r.Source
		if source == "" {
			source = "api"
		}
		args = append(args, r.UserID, r.APIKeyID, r.Endpoint, source, r.IP, r.Prompt, r.ImageURL, r.StatusCode, r.TokensCost, r.Count, r.LatencyMs)
	}
	if _, err := tx.Exec(sb.String(), args...); err != nil {
		return err
	}
	return tx.Commit()
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
		if rows.Err() != nil {
			return nil, rows.Err()
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
		if rows.Err() != nil {
			return nil, rows.Err()
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
		if rows.Err() != nil {
			return nil, rows.Err()
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

	q := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, l.ip, l.prompt, l.image_url, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') " +
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
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.IP, &l.Prompt, &l.ImageURL, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, total, rows.Err()
}

// GetAllAPICallLogs 全站分页查询 API 调用明细（Admin 视角，跨用户）。
// 支持按 user_id / email（LIKE 模糊）/ endpoint / status / key_id / source 筛选。
// email 非空时走子查询转 user_id 列表，避免 JOIN users 的全表扫。
func (s *MySQLStore) GetAllAPICallLogs(userID int64, email string, page, pageSize int, endpoint string, status int, keyID int64, source string) ([]model.APICallLog, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	where := "WHERE 1=1"
	args := []any{}

	if userID > 0 {
		where += " AND l.user_id=?"
		args = append(args, userID)
	}
	if email != "" {
		where += " AND l.user_id IN (SELECT id FROM users WHERE email LIKE ?)"
		args = append(args, "%"+email+"%")
	}
	if endpoint != "" {
		where += " AND l.endpoint=?"
		args = append(args, endpoint)
	}
	if status > 0 {
		where += " AND l.status_code=?"
		args = append(args, status)
	}
	if keyID > 0 {
		where += " AND l.api_key_id=?"
		args = append(args, keyID)
	}
	if source == "api" || source == "web" {
		where += " AND l.source=?"
		args = append(args, source)
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM api_call_logs l " + where
	s.db.QueryRow(countSQL, args...).Scan(&total)

	selectSQL := "SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, COALESCE(l.source,'api'), l.ip, l.prompt, l.image_url, l.user_id, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s'), COALESCE(u.email,'') " +
		"FROM api_call_logs l " +
		"LEFT JOIN user_api_keys k ON l.api_key_id=k.id " +
		"LEFT JOIN users u ON l.user_id=u.id " +
		where +
		" ORDER BY l.id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(selectSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.Source, &l.IP, &l.Prompt, &l.ImageURL, &l.UserID, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt, &l.UserEmail) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, total, rows.Err()
}

// GetAPIStatsGlobal 全站 API 调用聚合统计。minutes 为最近 N 分钟窗口（0=最近5分钟）。
func (s *MySQLStore) GetAPIStatsGlobal(minutes int) (*model.APIStatsGlobal, error) {
	if minutes <= 0 {
		minutes = 5
	}
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)

	st := &model.APIStatsGlobal{
		ByEndpoint:   []model.APIUsageDimension{},
		ByStatus:     []model.APIStatsStatusDim{},
		TopUsers:     []model.APIStatsUserDim{},
		TrendMinutes: []model.APIStatsTrendMinute{},
	}

	// 概览
	if err := s.db.QueryRow(`SELECT
		COUNT(*),
		COALESCE(SUM(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(tokens_cost),0),
		COUNT(DISTINCT user_id),
		COUNT(DISTINCT api_key_id)
		FROM api_call_logs WHERE created_at >= ?`, since).
		Scan(&st.TotalCalls, &st.SuccessCalls, &st.FailedCalls, &st.RateLimited, &st.TotalTokens, &st.ActiveUsers, &st.ActiveKeys); err != nil {
		return nil, err
	}

	// 按端点
	if rows, err := s.db.Query(`SELECT endpoint, COUNT(*), COALESCE(SUM(tokens_cost),0)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY endpoint ORDER BY COUNT(*) DESC LIMIT 20`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIUsageDimension
			if rows.Scan(&d.Name, &d.Calls, &d.Tokens) == nil {
				st.ByEndpoint = append(st.ByEndpoint, d)
			}
		}
		if rows.Err() != nil {
			return nil, rows.Err()
		}
	}

	// 按状态码
	if rows, err := s.db.Query(`SELECT status_code, COUNT(*)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY status_code ORDER BY COUNT(*) DESC`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsStatusDim
			if rows.Scan(&d.Code, &d.Count) == nil {
				st.ByStatus = append(st.ByStatus, d)
			}
		}
		if rows.Err() != nil {
			return nil, rows.Err()
		}
	}

	// Top 用户（按调用量）
	if rows, err := s.db.Query(`SELECT l.user_id, COALESCE(u.email,''), COUNT(*), COALESCE(SUM(l.tokens_cost),0)
		FROM api_call_logs l LEFT JOIN users u ON l.user_id=u.id
		WHERE l.created_at >= ?
		GROUP BY l.user_id, u.email ORDER BY COUNT(*) DESC LIMIT 10`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsUserDim
			if rows.Scan(&d.UserID, &d.Email, &d.Calls, &d.Tokens) == nil {
				st.TopUsers = append(st.TopUsers, d)
			}
		}
		if rows.Err() != nil {
			return nil, rows.Err()
		}
	}

	// 按分钟趋势（最近 N 分钟）
	if rows, err := s.db.Query(`SELECT DATE_FORMAT(created_at,'%H:%i') AS m, COUNT(*),
		COALESCE(SUM(CASE WHEN status_code NOT BETWEEN 200 AND 299 THEN 1 ELSE 0 END),0)
		FROM api_call_logs WHERE created_at >= ?
		GROUP BY m ORDER BY m`, since); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d model.APIStatsTrendMinute
			if rows.Scan(&d.Minute, &d.Calls, &d.Errors) == nil {
				st.TrendMinutes = append(st.TrendMinutes, d)
			}
		}
		if rows.Err() != nil {
			return nil, rows.Err()
		}
	}

	return st, nil
}

// GetRecentAPICallLogs 取最近 N 条全站调用日志（SSE 首帧历史用）。
func (s *MySQLStore) GetRecentAPICallLogs(limit int) ([]model.APICallLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(
		"SELECT l.id, l.api_key_id, COALESCE(k.name,''), l.endpoint, COALESCE(l.source,'api'), l.ip, l.prompt, l.image_url, l.user_id, l.status_code, l.tokens_cost, l.count, l.latency_ms, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s'), COALESCE(u.email,'') "+
			"FROM api_call_logs l "+
			"LEFT JOIN user_api_keys k ON l.api_key_id=k.id "+
			"LEFT JOIN users u ON l.user_id=u.id "+
			"ORDER BY l.id DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.APICallLog{}
	for rows.Next() {
		var l model.APICallLog
		if rows.Scan(&l.ID, &l.APIKeyID, &l.KeyName, &l.Endpoint, &l.Source, &l.IP, &l.Prompt, &l.ImageURL, &l.UserID, &l.StatusCode, &l.TokensCost, &l.Count, &l.LatencyMs, &l.CreatedAt, &l.UserEmail) == nil {
			if l.KeyName == "" {
				l.KeyName = "未知"
			}
			out = append(out, l)
		}
	}
	return out, rows.Err()
}
