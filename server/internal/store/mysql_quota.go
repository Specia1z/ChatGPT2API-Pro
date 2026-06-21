package store

// QuotaPlanUser 有月配额套餐的活跃订阅用户（撞额名单候选）。
type QuotaPlanUser struct {
	UserID       int64
	Email        string
	PlanName     string
	MonthlyQuota int
}

// ListQuotaPlanUsers 返回当前订阅有效、且套餐设了月配额(>0)的用户。
// 仅这些用户才可能撞额，把 Redis 比对范围限定在此集合，避免全表扫。
func (s *MySQLStore) ListQuotaPlanUsers() ([]QuotaPlanUser, error) {
	rows, err := s.db.Query(`SELECT u.id, COALESCE(u.email,''), COALESCE(p.name,''), p.monthly_quota
		FROM users u JOIN plans p ON u.plan_id = p.id
		WHERE p.monthly_quota > 0 AND u.status = 1
		  AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuotaPlanUser
	for rows.Next() {
		var q QuotaPlanUser
		if rows.Scan(&q.UserID, &q.Email, &q.PlanName, &q.MonthlyQuota) == nil {
			out = append(out, q)
		}
	}
	return out, rows.Err()
}

// EnabledAPIKey 启用中的 API Key（用于单 Key 多 IP 告警扫描）。
type EnabledAPIKey struct {
	KeyID    int64
	UserID   int64
	KeyName  string
	Email    string
}

// ListEnabledAPIKeys 返回所有启用中的 API Key（带所属用户邮箱），供多 IP 告警逐个查 Redis。
func (s *MySQLStore) ListEnabledAPIKeys() ([]EnabledAPIKey, error) {
	rows, err := s.db.Query(`SELECT k.id, k.user_id, COALESCE(k.name,''), COALESCE(u.email,'')
		FROM user_api_keys k JOIN users u ON k.user_id = u.id
		WHERE k.enabled = 1 AND u.status = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EnabledAPIKey
	for rows.Next() {
		var k EnabledAPIKey
		if rows.Scan(&k.KeyID, &k.UserID, &k.KeyName, &k.Email) == nil {
			out = append(out, k)
		}
	}
	return out, rows.Err()
}
