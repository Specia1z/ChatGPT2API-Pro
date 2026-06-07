package store

import (
	"database/sql"
	"fmt"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Redeem Codes ---

func (s *MySQLStore) CreateRedeemCode(code string, req *model.GenerateRedeemRequest, adminID int64) (*model.RedeemCode, error) {
	expiresSQL := "NULL"
	var args []any
	args = append(args, code, req.Type, req.PlanID, req.PlanDurationDays, req.Points, req.MaxUses, 0, 1, adminID)
	if req.ExpiresInHours > 0 {
		expiresSQL = "DATE_ADD(NOW(), INTERVAL ? HOUR)"
		args = append(args, req.ExpiresInHours)
	}
	query := fmt.Sprintf(`INSERT INTO redeem_codes (code, type, plan_id, plan_duration_days, points, max_uses, use_count, status, created_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?,%s)`, expiresSQL)
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &model.RedeemCode{ID: id, Code: code, Type: req.Type, Status: true}, nil
}

func (s *MySQLStore) ListRedeemCodes() ([]model.RedeemCode, error) {
	rows, err := s.db.Query(`SELECT rc.id, rc.code, rc.type, rc.plan_id, rc.plan_duration_days, rc.points, rc.max_uses, rc.use_count, rc.status, COALESCE(rc.expires_at,''), rc.created_by, rc.created_at, rc.updated_at, COALESCE(p.name,'') FROM redeem_codes rc LEFT JOIN plans p ON rc.plan_id=p.id ORDER BY rc.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var codes []model.RedeemCode
	for rows.Next() {
		var c model.RedeemCode
		if err := rows.Scan(&c.ID, &c.Code, &c.Type, &c.PlanID, &c.PlanDurationDays, &c.Points, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt, &c.PlanName); err != nil {
			continue
		}
		codes = append(codes, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return codes, nil
}

func (s *MySQLStore) DisableRedeemCode(id int64) error {
	_, err := s.db.Exec("UPDATE redeem_codes SET status=0 WHERE id=?", id)
	return err
}

func (s *MySQLStore) GetRedeemCodeByCode(code string) (*model.RedeemCode, error) {
	var c model.RedeemCode
	err := s.db.QueryRow(`SELECT id, code, type, plan_id, plan_duration_days, points, max_uses, use_count, status, COALESCE(expires_at,''), created_at FROM redeem_codes WHERE code=?`, code).
		Scan(&c.ID, &c.Code, &c.Type, &c.PlanID, &c.PlanDurationDays, &c.Points, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *MySQLStore) IncrementRedeemUseCount(id int64) error {
	_, err := s.db.Exec("UPDATE redeem_codes SET use_count = use_count + 1 WHERE id=?", id)
	return err
}

// AtomicRedeemUseCount 原子递增 use_count，仅当 status=1 且未超限时成功
// 返回 (ok, newCount, error)
func (s *MySQLStore) AtomicRedeemUseCount(id int64) (bool, int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, 0, err
	}
	defer tx.Rollback()

	var status bool
	var useCount, maxUses int
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT status, use_count, max_uses, expires_at FROM redeem_codes WHERE id=? FOR UPDATE", id).
		Scan(&status, &useCount, &maxUses, &expiresAt)
	if err != nil {
		return false, 0, err
	}

	if !status {
		return false, useCount, nil
	}
	if useCount >= maxUses {
		return false, useCount, nil
	}
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.UTC)
		if time.Now().UTC().After(exp) {
			return false, useCount, nil
		}
	}

	_, err = tx.Exec("UPDATE redeem_codes SET use_count = use_count + 1 WHERE id=?", id)
	if err != nil {
		return false, 0, err
	}

	if err := tx.Commit(); err != nil {
		return false, 0, err
	}
	return true, useCount + 1, nil
}

// CompleteRedeem 原子完成兑换：检查状态 → 递增计数 → 应用权益 → 写日志，单事务
func (s *MySQLStore) CompleteRedeem(codeID, userID int64, code string) (string, string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()

	// 1. 锁定兑换码并检查
	var status bool
	var useCount, maxUses, planID, planDurationDays, points int
	var rtype string
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT type, status, use_count, max_uses, plan_id, plan_duration_days, points, expires_at FROM redeem_codes WHERE id=? FOR UPDATE", codeID).
		Scan(&rtype, &status, &useCount, &maxUses, &planID, &planDurationDays, &points, &expiresAt)
	if err != nil {
		return "", "", err
	}
	if !status {
		return "", "", nil
	}
	if useCount >= maxUses {
		return "", "", nil
	}
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.UTC)
		if time.Now().UTC().After(exp) {
			return "", "", nil
		}
	}

	// 防同一用户重复兑换同一码（事务内、持有码行锁时检查，避免并发重复领取）
	var dup int
	if err = tx.QueryRow("SELECT COUNT(*) FROM redeem_logs WHERE redeem_code_id=? AND user_id=?", codeID, userID).Scan(&dup); err != nil {
		return "", "", err
	}
	if dup > 0 {
		return "", "", nil
	}

	// 2. 递增使用次数
	_, err = tx.Exec("UPDATE redeem_codes SET use_count = use_count + 1 WHERE id=?", codeID)
	if err != nil {
		return "", "", err
	}

	// 3. 应用权益
	var value string
	switch rtype {
	case "plan":
		var planName string
		var planEnabled bool
		var planDefaultDays int
		err := tx.QueryRow("SELECT name, enabled, COALESCE(duration_days,0) FROM plans WHERE id=?", planID).
			Scan(&planName, &planEnabled, &planDefaultDays)
		if err != nil || !planEnabled {
			return "", "", fmt.Errorf("关联套餐无效")
		}
		duration := planDurationDays
		if duration <= 0 {
			duration = planDefaultDays
		}
		value = fmt.Sprintf("%s (%d天)", planName, duration)
		if duration > 0 {
			_, err = tx.Exec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`,
				planID, duration, userID)
		} else {
			_, err = tx.Exec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", planID, userID)
		}
		if err != nil {
			return "", "", err
		}
	case "points":
		value = fmt.Sprintf("+%d 积分", points)
		_, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", points, userID)
		if err != nil {
			return "", "", err
		}
	}

	// 4. 写入兑换日志
	_, err = tx.Exec("INSERT INTO redeem_logs (redeem_code_id, user_id, code, type, value) VALUES (?,?,?,?,?)",
		codeID, userID, code, rtype, value)
	if err != nil {
		return "", "", err
	}

	if err := tx.Commit(); err != nil {
		return "", "", err
	}
	return rtype, value, nil
}

func (s *MySQLStore) CreateRedeemLog(codeID, userID int64, code, rtype, value string) error {
	_, err := s.db.Exec("INSERT INTO redeem_logs (redeem_code_id, user_id, code, type, value) VALUES (?,?,?,?,?)",
		codeID, userID, code, rtype, value)
	return err
}

func (s *MySQLStore) GetRedeemLogsByUser(userID int64) ([]model.RedeemLog, error) {
	rows, err := s.db.Query(`SELECT rl.id, rl.redeem_code_id, rl.user_id, rl.code, rl.type, rl.value, COALESCE(u.email,''), rl.created_at FROM redeem_logs rl LEFT JOIN users u ON rl.user_id=u.id WHERE rl.user_id=? ORDER BY rl.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []model.RedeemLog
	for rows.Next() {
		var l model.RedeemLog
		if err := rows.Scan(&l.ID, &l.RedeemCodeID, &l.UserID, &l.Code, &l.Type, &l.Value, &l.UserEmail, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return logs, nil
}

func (s *MySQLStore) GetRedeemLogsByCode(codeID int64) ([]model.RedeemLog, error) {
	rows, err := s.db.Query(`SELECT rl.id, rl.redeem_code_id, rl.user_id, rl.code, rl.type, rl.value, COALESCE(u.email,''), rl.created_at FROM redeem_logs rl LEFT JOIN users u ON rl.user_id=u.id WHERE rl.redeem_code_id=? ORDER BY rl.id DESC`, codeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []model.RedeemLog
	for rows.Next() {
		var l model.RedeemLog
		if err := rows.Scan(&l.ID, &l.RedeemCodeID, &l.UserID, &l.Code, &l.Type, &l.Value, &l.UserEmail, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return logs, nil
}

func (s *MySQLStore) GetPlanByID(id int) (*model.Plan, error) {
	var p model.Plan
	err := s.db.QueryRow("SELECT id, name, price_monthly, price_yearly, duration_days, COALESCE(duration_days_yearly,0), concurrency, token_capacity, token_refill_per_hour, features, enabled FROM plans WHERE id=?", id).
		Scan(&p.ID, &p.Name, &p.PriceMonthly, &p.PriceYearly, &p.DurationDays, &p.DurationDaysYearly, &p.Concurrency, &p.TokenCapacity, &p.TokenRefillPerHour, &p.Features, &p.Enabled)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}
