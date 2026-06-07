package store

import (
	"encoding/json"
	"fmt"
	"strings"

	"chatgpt2api-pro/internal/model"
)

// --- Accounts ---

func (s *MySQLStore) ListAccounts(status string, search string, offset, limit int) ([]model.Account, int, error) {
	var conditions []string
	var args []any

	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if search != "" {
		conditions = append(conditions, "(email LIKE ? OR access_token LIKE ?)")
		q := "%" + search + "%"
		args = append(args, q, q)
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM accounts %s", where)
	if err := s.db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`SELECT id, access_token, COALESCE(refresh_token,''), COALESCE(id_token,''), 
		COALESCE(email,''), COALESCE(user_id,''), plan_type, status, quota, image_quota_unknown,
		source_type, COALESCE(proxy,''), COALESCE(default_model_slug,''), COALESCE(restore_at,''),
		success_count, fail_count, invalid_count, last_used_at, created_at, updated_at
		FROM accounts %s ORDER BY id DESC LIMIT ? OFFSET ?`, where)

	args = append(args, limit, offset)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var accounts []model.Account
	for rows.Next() {
		var a model.Account
		if err := rows.Scan(&a.ID, &a.AccessToken, &a.RefreshToken, &a.IDToken,
			&a.Email, &a.UserID, &a.PlanType, &a.Status, &a.Quota, &a.ImageQuotaUnknown,
			&a.SourceType, &a.Proxy, &a.DefaultModelSlug, &a.RestoreAt,
			&a.SuccessCount, &a.FailCount, &a.InvalidCount, &a.LastUsedAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, 0, err
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return accounts, total, nil
}

func (s *MySQLStore) AddAccounts(tokens []string, sourceType string) (int, error) {
	stmt, err := s.db.Prepare(`INSERT IGNORE INTO accounts (access_token, source_type, status, plan_type) 
		VALUES (?, ?, '正常', 'free')`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	added := 0
	for _, token := range tokens {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		res, err := stmt.Exec(token, sourceType)
		if err != nil {
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}
	return added, nil
}

func (s *MySQLStore) DeleteAccounts(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf("DELETE FROM accounts WHERE id IN (%s)", strings.Join(placeholders, ","))
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *MySQLStore) UpdateAccountByToken(acc *model.Account) error {
	_, err := s.db.Exec(`UPDATE accounts SET 
		email=?, user_id=?, plan_type=?, status=?, quota=?, image_quota_unknown=?,
		default_model_slug=?, restore_at=?
		WHERE access_token=?`,
		acc.Email, acc.UserID, acc.PlanType, acc.Status, acc.Quota, acc.ImageQuotaUnknown,
		acc.DefaultModelSlug, acc.RestoreAt, acc.AccessToken)
	return err
}

func (s *MySQLStore) UpdateAccountInfo(acc *model.Account) error {
	_, err := s.db.Exec(`UPDATE accounts SET
		email=?, user_id=?, plan_type=?, status=?, quota=?, image_quota_unknown=?,
		success_count = success_count + ?, fail_count = fail_count + ?, last_used_at=NOW(),
		default_model_slug=?, restore_at=?
		WHERE id=?`,
		acc.Email, acc.UserID, acc.PlanType, acc.Status, acc.Quota, acc.ImageQuotaUnknown,
		acc.SuccessCount, acc.FailCount,
		acc.DefaultModelSlug, acc.RestoreAt, acc.ID)
	return err
}

// UpdateAccountUsage 仅更新生图过程中确实变动的字段（状态/计数/使用时间），
// 不触碰 user_id/default_model_slug/restore_at——因为生图选号路径（GetAccountsForRefresh）
// 并未加载这些列，用 UpdateAccountInfo 会把它们清空。
func (s *MySQLStore) UpdateAccountUsage(acc *model.Account) error {
	_, err := s.db.Exec(`UPDATE accounts SET
		status=?, success_count = success_count + ?, fail_count = fail_count + ?, last_used_at=NOW()
		WHERE id=?`,
		acc.Status, acc.SuccessCount, acc.FailCount, acc.ID)
	return err
}

func (s *MySQLStore) GetAccountsByIDs(ids []int64) ([]model.Account, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(`SELECT id, access_token FROM accounts WHERE id IN (%s)`, strings.Join(placeholders, ","))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []model.Account
	for rows.Next() {
		var a model.Account
		if err := rows.Scan(&a.ID, &a.AccessToken); err != nil {
			continue
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return accounts, nil
}

func (s *MySQLStore) GetAccountsForRefresh() ([]model.Account, error) {
	rows, err := s.db.Query(`SELECT id, access_token, COALESCE(email,''), plan_type, status, quota, image_quota_unknown FROM accounts WHERE status != '禁用'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []model.Account
	for rows.Next() {
		var a model.Account
		if err := rows.Scan(&a.ID, &a.AccessToken, &a.Email, &a.PlanType, &a.Status, &a.Quota, &a.ImageQuotaUnknown); err != nil {
			continue
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return accounts, nil
}

func (s *MySQLStore) GetAccountStats() (*model.AccountStats, error) {
	stats := &model.AccountStats{ByType: make(map[string]int)}

	rows, err := s.db.Query(`SELECT status, plan_type, quota, image_quota_unknown, success_count, fail_count FROM accounts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var status, planType string
		var quota int
		var imgUnk bool
		var succ, fail int
		if err := rows.Scan(&status, &planType, &quota, &imgUnk, &succ, &fail); err != nil {
			continue
		}
		stats.Total++
		switch status {
		case "正常":
			stats.Active++
		case "限流":
			stats.Limited++
		case "异常":
			stats.Abnormal++
		case "禁用":
			stats.Disabled++
		}
		stats.TotalQuota += quota
		if imgUnk {
			stats.UnlimitedCount++
		}
		stats.TotalSuccess += succ
		stats.TotalFail += fail
		stats.ByType[planType]++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return stats, nil
}

// --- Register Config ---

func (s *MySQLStore) GetRegisterConfig() (*model.RegisterConfig, error) {
	cfg := &model.RegisterConfig{}
	var mailJSON string
	err := s.db.QueryRow(`SELECT mail_providers, proxy, total, threads, mode, target_quota, target_available, check_interval, enabled, wait_timeout FROM register_config WHERE id=1`).
		Scan(&mailJSON, &cfg.Proxy, &cfg.Total, &cfg.Threads, &cfg.Mode, &cfg.TargetQuota, &cfg.TargetAvailable, &cfg.CheckInterval, &cfg.Enabled, &cfg.WaitTimeout)
	if err != nil {
		return cfg, nil // 返回默认值
	}
	if mailJSON != "" {
		json.Unmarshal([]byte(mailJSON), &cfg.Mail)
	}
	return cfg, nil
}

func (s *MySQLStore) SaveRegisterConfig(cfg *model.RegisterConfig) error {
	mailJSON, _ := json.Marshal(cfg.Mail)
	_, err := s.db.Exec(`UPDATE register_config SET mail_providers=?, proxy=?, total=?, threads=?, mode=?, target_quota=?, target_available=?, check_interval=?, enabled=?, wait_timeout=? WHERE id=1`,
		string(mailJSON), cfg.Proxy, cfg.Total, cfg.Threads, cfg.Mode, cfg.TargetQuota, cfg.TargetAvailable, cfg.CheckInterval, cfg.Enabled, cfg.WaitTimeout)
	return err
}
