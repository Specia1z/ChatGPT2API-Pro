package store

import (
	"database/sql"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// UpsertRiskScore 写入/更新用户风险评分（幂等）。
func (s *MySQLStore) UpsertRiskScore(uid int64, scoreAPI, scorePoints, scoreContent, scoreAccount, total int) error {
	_, err := s.db.Exec(`INSERT INTO user_risk_scores (user_id, score_api, score_points, score_content, score_account, total_score, updated_at)
		VALUES (?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE
		score_api=VALUES(score_api), score_points=VALUES(score_points),
		score_content=VALUES(score_content), score_account=VALUES(score_account),
		total_score=VALUES(total_score), updated_at=NOW()`,
		uid, scoreAPI, scorePoints, scoreContent, scoreAccount, total)
	return err
}

// GetRiskScores 分页查询风险评分排行（按总分降序）。
func (s *MySQLStore) GetRiskScores(page, pageSize int, minScore int) ([]model.UserRiskScore, int, error) {
	if page < 1 { page = 1 }
	if pageSize < 1 || pageSize > 100 { pageSize = 20 }

	where := "WHERE r.total_score >= ?"
	args := []any{minScore}
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM user_risk_scores r JOIN users u ON r.user_id=u.id "+where, args...).Scan(&total)

	rows, err := s.db.Query(`SELECT u.id, COALESCE(u.email,''), r.score_api, r.score_points, r.score_content, r.score_account, r.total_score,
		DATE_FORMAT(r.updated_at,'%Y-%m-%d %H:%i:%s'),
		u.status, COALESCE(DATE_FORMAT(u.ban_until,'%Y-%m-%d %H:%i:%s'),''), COALESCE(u.ban_reason,'')
		FROM user_risk_scores r JOIN users u ON r.user_id=u.id `+where+
		` ORDER BY r.total_score DESC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	scores := make([]model.UserRiskScore, 0)
	for rows.Next() {
		var s model.UserRiskScore
		var status bool
		if rows.Scan(&s.UserID, &s.Email, &s.ScoreAPI, &s.ScorePoints, &s.ScoreContent, &s.ScoreAccount, &s.TotalScore, &s.UpdatedAt, &status, &s.BanUntil, &s.BanReason) == nil {
			s.Reasons = ScoreReasons(s)
			s.Banned = !status
			scores = append(scores, s)
		}
	}
	return scores, total, rows.Err()
}

// GetHighRiskUserIDs 返回超过阈值的用户 ID 列表（供自动封禁使用）。
func (s *MySQLStore) GetHighRiskUserIDs(threshold int) ([]int64, error) {
	rows, err := s.db.Query("SELECT user_id FROM user_risk_scores WHERE total_score >= ? AND updated_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)", threshold)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

// BatchResetRiskScores 清除超时的旧评分（长时间无更新的用户自动归零）。
func (s *MySQLStore) BatchResetRiskScores(olderThan time.Duration) (int64, error) {
	res, err := s.db.Exec("DELETE FROM user_risk_scores WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)", int(olderThan.Seconds()))
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ── 评分辅助查询 ──

// GetActiveUserIDs 返回最近 N 小时内有过 API 调用的普通用户（排除管理员）。
func (s *MySQLStore) GetActiveUserIDs(sinceHours int) ([]int64, error) {
	rows, err := s.db.Query(`SELECT DISTINCT l.user_id FROM api_call_logs l
		JOIN users u ON l.user_id=u.id
		WHERE l.user_id > 0 AND u.role=0 AND l.created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`, sinceHours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

// CountInviteRegs 统计用户近 N 天的邀请注册数。
func (s *MySQLStore) CountInviteRegs(uid int64, days int) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM invite_logs WHERE inviter_id=? AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)", uid, days).Scan(&n)
	return n
}

// CountOwnRegs 统计用户近 N 天的自身注册事件数（用于计算邀请占比）。
func (s *MySQLStore) CountOwnRegs(uid int64, days int) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM account_events WHERE user_id=? AND event_type='register' AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)", uid, days).Scan(&n)
	return n
}

// CountSameIPUsers 统计与指定用户共享 IP 的其他用户数（24h 窗口）。
func (s *MySQLStore) CountSameIPUsers(uid int64) int {
	var n int
	s.db.QueryRow(`SELECT COUNT(DISTINCT user_id) FROM api_call_logs
		WHERE ip IN (SELECT DISTINCT ip FROM api_call_logs WHERE user_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR))
		AND user_id != ? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`, uid, uid).Scan(&n)
	return n
}

// CountFailedGens24h 统计用户 24h 内的失败生图数。
func (s *MySQLStore) CountFailedGens24h(uid int64) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND status='failed' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)", uid).Scan(&n)
	return n
}

// CountTotalGens24h 统计用户 24h 内的总生图数。
func (s *MySQLStore) CountTotalGens24h(uid int64) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)", uid).Scan(&n)
	return n
}

// CountDupPrompts24h 统计用户 24h 内出现 ≥3 次的重复 prompt 数。
func (s *MySQLStore) CountDupPrompts24h(uid int64) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM (SELECT prompt FROM api_call_logs WHERE user_id=? AND prompt != '' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY prompt HAVING COUNT(*) >= 3) t", uid).Scan(&n)
	return n
}

// CountBanEvents 统计用户被封次数。
func (s *MySQLStore) CountBanEvents(uid int64) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM account_events WHERE user_id=? AND event_type='ban'", uid).Scan(&n)
	return n
}

// AccountAgeHours 返回账号注册时间距今的小时数。
func (s *MySQLStore) AccountAgeHours(uid int64) float64 {
	var h float64
	s.db.QueryRow("SELECT COALESCE(TIMESTAMPDIFF(HOUR, (SELECT MIN(created_at) FROM account_events WHERE user_id=? AND event_type='register'), NOW()), 9999)", uid).Scan(&h)
	return h
}

// ScoreReasons 根据各维度分数生成简短评分理由（如"QPS超限+多IP+刷邀请"）。
func ScoreReasons(s model.UserRiskScore) string {
	var parts []string
	add := func(label string, v int, threshold int) {
		if v >= threshold {
			parts = append(parts, label)
		}
	}
	add("API滥用", s.ScoreAPI, 30)
	add("刷邀请", s.ScorePoints, 20)
	add("重复prompt", s.ScoreContent, 20)
	add("高失败率", s.ScoreContent, 10)
	add("账号异常", s.ScoreAccount, 30)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "+")
}
func (s *MySQLStore) BanUser(uid int64, reason string) error {
	_, err := s.db.Exec("UPDATE users SET status=0, ban_reason=? WHERE id=?", reason, uid)
	return err
}

// InsertAccountEvent 记录账号事件（封禁/解封等）。
func (s *MySQLStore) InsertAccountEvent(uid int64, eventType, source, reason string) {
	s.db.Exec("INSERT INTO account_events (user_id, event_type, source, reason, created_at) VALUES (?,?,?,?,NOW())", uid, eventType, source, reason)
}

// RawQueryRow 原始查询单行（供内部使用）。
func (s *MySQLStore) RawQueryRow(query string, args ...any) *sql.Row {
	return s.db.QueryRow(query, args...)
}

// UnbanUser 解封用户（恢复 status=1 + 清除封禁原因 + 删除评分记录）。
func (s *MySQLStore) UnbanUser(uid int64) error {
	_, err := s.db.Exec("UPDATE users SET status=1, ban_reason='' WHERE id=?", uid)
	if err != nil {
		return err
	}
	s.db.Exec("DELETE FROM user_risk_scores WHERE user_id=?", uid)
	return nil
}

// BatchUnbanRisk 批量解封所有风险评分低于阈值的用户（用于误封恢复）。
func (s *MySQLStore) BatchUnbanRisk(maxScore int) (int64, error) {
	rows, err := s.db.Query("SELECT user_id FROM user_risk_scores r JOIN users u ON r.user_id=u.id WHERE u.status=0 AND r.total_score <= ?", maxScore)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, id := range ids {
		s.UnbanUser(id)
	}
	return int64(len(ids)), nil
}

// GetUserBanCount 返回用户被自动封禁的次数（用于阶梯封禁计数）。
func (s *MySQLStore) GetUserBanCount(uid int64) int {
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM account_events WHERE user_id=? AND event_type='ban' AND source='risk_score_auto'", uid).Scan(&n)
	return n
}

// BanUserWithDuration 封禁用户并设置解封时间（0=永久）。
func (s *MySQLStore) BanUserWithDuration(uid int64, reason string, durationMinutes int) error {
	if durationMinutes <= 0 {
		return s.BanUser(uid, reason)
	}
	_, err := s.db.Exec("UPDATE users SET status=0, ban_reason=?, ban_until=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?",
		reason, durationMinutes, uid)
	return err
}

// UnbanExpired 解封所有已过期的临时封禁。返回解封人数。
func (s *MySQLStore) UnbanExpired() (int64, error) {
	res, err := s.db.Exec("UPDATE users SET status=1, ban_reason='' WHERE status=0 AND ban_until IS NOT NULL AND ban_until <= NOW()")
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
