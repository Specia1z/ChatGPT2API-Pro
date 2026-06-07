package store

import (
	"database/sql"

	"chatgpt2api-pro/internal/model"
)

// pointsDB 抽象 *sql.DB / *sql.Tx 共有的方法，使流水写入既能独立执行、也能并入调用方事务。
type pointsDB interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// logPoints 写一条积分流水。balance 当场从 users 读取（确保与变动后余额一致）。
// q 传 *sql.Tx 时与积分变动同事务（推荐，保证原子）；传 s.db 时独立写入。
// 失败仅吞掉（流水是辅助记录，不应因它阻断主流程）；但同事务调用方可自行检查 err。
func logPoints(q pointsDB, userID int64, change int, typ, remark string) error {
	var balance int
	q.QueryRow("SELECT points FROM users WHERE id=?", userID).Scan(&balance)
	_, err := q.Exec(
		"INSERT INTO points_logs (user_id, change_amount, balance, type, remark) VALUES (?,?,?,?,?)",
		userID, change, balance, typ, remark)
	return err
}

// GetUserPointsLogs 分页查询用户积分流水（按时间倒序）。
func (s *MySQLStore) GetUserPointsLogs(userID int64, page, pageSize int) ([]model.PointsLog, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM points_logs WHERE user_id=?", userID).Scan(&total)
	rows, err := s.db.Query(
		"SELECT id, change_amount, balance, type, COALESCE(remark,''), created_at FROM points_logs WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
		userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var logs []model.PointsLog
	for rows.Next() {
		var l model.PointsLog
		if err := rows.Scan(&l.ID, &l.Change, &l.Balance, &l.Type, &l.Remark, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}
