package store

import (
	"crypto/sha256"
	"database/sql"
	"fmt"

	"chatgpt2api-pro/internal/model"
)

// --- Plans ---

func (s *MySQLStore) ListPlans(enabledOnly bool) ([]model.Plan, error) {
	where := ""
	if enabledOnly {
		where = " WHERE enabled=1"
	}
	rows, err := s.db.Query("SELECT id, name, price_monthly, price_yearly, duration_days, COALESCE(duration_days_yearly,0), concurrency, token_capacity, token_refill_per_hour, COALESCE(rate_limit_per_min,0), COALESCE(monthly_quota,0), COALESCE(features,'[]'), sort_order, highlighted, enabled, created_at FROM plans" + where + " ORDER BY sort_order")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var plans []model.Plan
	for rows.Next() {
		var p model.Plan
		rows.Scan(&p.ID, &p.Name, &p.PriceMonthly, &p.PriceYearly, &p.DurationDays, &p.DurationDaysYearly, &p.Concurrency, &p.TokenCapacity, &p.TokenRefillPerHour, &p.RateLimitPerMin, &p.MonthlyQuota, &p.Features, &p.SortOrder, &p.Highlighted, &p.Enabled, &p.CreatedAt)
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return plans, nil
}

func (s *MySQLStore) CreatePlan(p *model.Plan) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO plans (name, price_monthly, price_yearly, duration_days, duration_days_yearly, concurrency, token_capacity, token_refill_per_hour, rate_limit_per_min, monthly_quota, features, sort_order, highlighted, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.Name, p.PriceMonthly, p.PriceYearly, p.DurationDays, p.DurationDaysYearly, p.Concurrency, p.TokenCapacity, p.TokenRefillPerHour, p.RateLimitPerMin, p.MonthlyQuota, p.Features, p.SortOrder, p.Highlighted, p.Enabled)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *MySQLStore) UpdatePlan(p *model.Plan) error {
	_, err := s.db.Exec(
		`UPDATE plans SET name=?, price_monthly=?, price_yearly=?, duration_days=?, duration_days_yearly=?, concurrency=?, token_capacity=?, token_refill_per_hour=?, rate_limit_per_min=?, monthly_quota=?, features=?, sort_order=?, highlighted=?, enabled=? WHERE id=?`,
		p.Name, p.PriceMonthly, p.PriceYearly, p.DurationDays, p.DurationDaysYearly, p.Concurrency, p.TokenCapacity, p.TokenRefillPerHour, p.RateLimitPerMin, p.MonthlyQuota, p.Features, p.SortOrder, p.Highlighted, p.Enabled, p.ID)
	return err
}

func (s *MySQLStore) DeletePlan(id int) error {
	_, err := s.db.Exec("DELETE FROM plans WHERE id=?", id)
	return err
}

func (s *MySQLStore) HashExists(hash string) (bool, error) {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE SHA2(access_token, 256) = ?", hash).Scan(&count)
	return count > 0, err
}

func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", h)
}

// RawExec 执行任意 SQL（迁移/管理工具用）
func (s *MySQLStore) RawExec(query string, args ...any) (int64, error) {
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// --- Admin ---

func (s *MySQLStore) GetAdminByUsername(username string) (*model.Admin, error) {
	var a model.Admin
	err := s.db.QueryRow("SELECT id, username, password_hash, created_at FROM admins WHERE username = ?",
		username).Scan(&a.ID, &a.Username, &a.PasswordHash, &a.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
