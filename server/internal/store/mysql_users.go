package store

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Users ---

func (s *MySQLStore) CreateUser(email, passwordHash, name string) (int64, error) {
	// 从系统设置读取默认套餐，fallback 到第一个免费套餐
	var planID int
	var durationDays int
	s.db.QueryRow("SELECT COALESCE(default_plan_id,0) FROM settings WHERE id=1").Scan(&planID)
	if planID == 0 {
		s.db.QueryRow("SELECT id, COALESCE(duration_days,0) FROM plans WHERE price_monthly=0 AND enabled=1 ORDER BY sort_order LIMIT 1").Scan(&planID, &durationDays)
	} else {
		s.db.QueryRow("SELECT COALESCE(duration_days,0) FROM plans WHERE id=?", planID).Scan(&durationDays)
	}
	expiresSQL := "NULL"
	if durationDays > 0 {
		expiresSQL = "DATE_ADD(NOW(), INTERVAL ? DAY)"
	}
	query := fmt.Sprintf("INSERT INTO users (email, password_hash, name, plan_id, subscription_expires_at) VALUES (?, ?, ?, ?, %s)", expiresSQL)
	var args []any
	args = append(args, email, passwordHash, name, planID)
	if durationDays > 0 {
		args = append(args, durationDays)
	}
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *MySQLStore) GetUserByEmail(email string) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.role,0), COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),NULLIF(st.free_concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),NULLIF(st.free_token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),NULLIF(st.free_token_refill_per_hour,0),3), COALESCE(p2.name,''), u.created_at FROM users u LEFT JOIN plans p2 ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p2.id LEFT JOIN settings st ON st.id=1 WHERE u.email=?`,
		email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.Role, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *MySQLStore) ListUsers(search string, page, pageSize int) ([]model.User, int, error) {
	var conditions []string
	var args []any
	if search != "" {
		conditions = append(conditions, "(u.email LIKE ? OR u.name LIKE ?)")
		q := "%" + search + "%"
		args = append(args, q, q)
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM users "+where, args...).Scan(&total)

	allArgs := append([]any{}, args...)
	allArgs = append(allArgs, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.role,0), COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, COALESCE(p.name,''), u.created_at
		FROM users u LEFT JOIN plans p ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p.id
		`+where+" ORDER BY u.id DESC LIMIT ? OFFSET ?", allArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.Role, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.PlanName, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (s *MySQLStore) CreateUserWithDetails(email, passwordHash, name string, points int, planID int, durationDays int) (int64, error) {
	expiresSQL := "NULL"
	var expiresArgs []any
	if durationDays > 0 {
		expiresSQL = "DATE_ADD(NOW(), INTERVAL ? DAY)"
		expiresArgs = append(expiresArgs, durationDays)
	}
	query := fmt.Sprintf("INSERT INTO users (email, password_hash, name, points, plan_id, subscription_expires_at) VALUES (?, ?, ?, ?, ?, %s)", expiresSQL)
	args := []any{email, passwordHash, name, points, planID}
	args = append(args, expiresArgs...)
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// AdminSetUserSubscription 管理员为已有用户设置/续期/清除套餐订阅。
// mode:
//
//	"renew" — 在现有到期日上叠加 days 天（未过期则从原到期日累加，过期/无则从现在算起）；
//	          与购买/升级/兑换码同款续期语义。days>0 必填。
//	"set"   — 绝对设置：从现在起 days 天到期（days<=0 视为永久 NULL）。
//	"clear" — 清除订阅：plan_id=0 且到期日 NULL（退回无套餐）。
//
// planID<=0 且 mode!="clear" 时报错（续期/设置必须指定套餐）。
func (s *MySQLStore) AdminSetUserSubscription(userID int64, planID int, days int, mode string) error {
	switch mode {
	case "clear":
		_, err := s.db.Exec("UPDATE users SET plan_id=0, subscription_expires_at=NULL WHERE id=?", userID)
		return err
	case "renew":
		if planID <= 0 {
			return fmt.Errorf("续期需指定套餐")
		}
		if days <= 0 {
			// days=0 表示永久套餐：直接置 NULL（永不过期）
			_, err := s.db.Exec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", planID, userID)
			return err
		}
		// 续期：未过期从原到期日累加，过期/NULL 从现在算起（与购买/兑换码一致）
		_, err := s.db.Exec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`,
			planID, days, userID)
		return err
	case "set":
		if planID <= 0 {
			return fmt.Errorf("设置套餐需指定套餐")
		}
		if days <= 0 {
			_, err := s.db.Exec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", planID, userID)
			return err
		}
		_, err := s.db.Exec("UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id=?", planID, days, userID)
		return err
	default:
		return fmt.Errorf("无效的操作模式")
	}
}

func (s *MySQLStore) UpdateUser(id int64, name string) error {
	_, err := s.db.Exec("UPDATE users SET name=? WHERE id=?", name, id)
	return err
}

func (s *MySQLStore) ResetUserPassword(id int64, passwordHash string) error {
	_, err := s.db.Exec("UPDATE users SET password_hash=? WHERE id=?", passwordHash, id)
	return err
}

func (s *MySQLStore) AddUserPoints(id int64, delta int, typ, remark string) (int, error) {
	_, err := s.db.Exec("UPDATE users SET points = points + ? WHERE id=?", delta, id)
	if err != nil {
		return 0, err
	}
	var pts int
	s.db.QueryRow("SELECT points FROM users WHERE id=?", id).Scan(&pts)
	logPoints(s.db, id, delta, typ, remark)
	return pts, nil
}

// DeductUserPoints 原子扣减积分：仅当余额充足（points >= cost）才扣减，
// 防并发 TOCTOU 超扣。ok=false 表示余额不足未扣；返回扣减后余额。
func (s *MySQLStore) DeductUserPoints(id int64, cost int, typ, remark string) (remaining int, ok bool, err error) {
	if cost <= 0 {
		// 非扣减场景不应走此方法；直接读当前余额返回
		s.db.QueryRow("SELECT points FROM users WHERE id=?", id).Scan(&remaining)
		return remaining, true, nil
	}
	res, err := s.db.Exec("UPDATE users SET points = points - ? WHERE id=? AND points >= ?", cost, id, cost)
	if err != nil {
		return 0, false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// 余额不足，未扣减
		s.db.QueryRow("SELECT points FROM users WHERE id=?", id).Scan(&remaining)
		return remaining, false, nil
	}
	s.db.QueryRow("SELECT points FROM users WHERE id=?", id).Scan(&remaining)
	logPoints(s.db, id, -cost, typ, remark)
	return remaining, true, nil
}

func (s *MySQLStore) ToggleUserStatus(id int64, reason string) error {
	// 先读当前状态
	var status int
	s.db.QueryRow("SELECT status FROM users WHERE id=?", id).Scan(&status)
	// 封禁时设理由，解封时清空
	if status == 1 && reason != "" {
		s.db.Exec("UPDATE users SET ban_reason=?, status=0 WHERE id=?", reason, id)
	} else {
		s.db.Exec("UPDATE users SET ban_reason='', status=1 WHERE id=?", id)
	}
	return nil
}

// GetTodayCheckin 查询今日签到状态
func (s *MySQLStore) GetTodayCheckin(userID int64) (bool, int, error) {
	var streak int
	err := s.db.QueryRow("SELECT streak FROM checkins WHERE user_id=? AND checkin_date=CURDATE() ORDER BY id DESC LIMIT 1", userID).Scan(&streak)
	if err == sql.ErrNoRows {
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	return true, streak, nil
}

// CompleteCheckin 原子签到：插入记录 + 加积分，单事务
func (s *MySQLStore) CompleteCheckin(userID int64, points, streak int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO checkins (user_id, points_earned, streak, checkin_date) VALUES (?,?,?, CURDATE())", userID, points, streak)
	if err != nil {
		return err
	}

	_, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", points, userID)
	if err != nil {
		return err
	}
	logPoints(tx, userID, points, "checkin", "每日签到")

	return tx.Commit()
}

func (s *MySQLStore) GetLastCheckinStreak(userID int64) (int, error) {
	var streak int
	var lastDate string
	err := s.db.QueryRow("SELECT streak, DATE(created_at) FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 1", userID).Scan(&streak, &lastDate)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	// 检查是否昨天签到（连续）
	var today, yesterday string
	s.db.QueryRow("SELECT CURDATE(), DATE_SUB(CURDATE(), INTERVAL 1 DAY)").Scan(&today, &yesterday)
	if lastDate != today && lastDate != yesterday {
		return 0, nil // 断签，重置
	}
	return streak, err
}

func (s *MySQLStore) GetUserByID(id int64) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.role,0), COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),NULLIF(st.free_concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),NULLIF(st.free_token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),NULLIF(st.free_token_refill_per_hour,0),3), COALESCE(p2.rate_limit_per_min,0), COALESCE(p2.name,''), u.created_at FROM users u LEFT JOIN plans p2 ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p2.id LEFT JOIN settings st ON st.id=1 WHERE u.id=?`,
		id).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.Role, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.RateLimitPerMin, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// IsUserActive 轻量查询用户是否未被封禁（中间件每请求调用，仅查 status 列）。
// 用户不存在视为未激活（false）。
func (s *MySQLStore) IsUserActive(id int64) bool {
	var status bool
	err := s.db.QueryRow("SELECT status FROM users WHERE id=?", id).Scan(&status)
	if err != nil {
		return false
	}
	return status
}

// GetUserAuthInfo 轻量查询用户的鉴权信息（中间件每请求调用）：
// 返回 email、status（是否未封禁）、role（0 普通/1 admin）。用户不存在则 ok=false。
func (s *MySQLStore) GetUserAuthInfo(id int64) (email string, status bool, role int, ok bool) {
	err := s.db.QueryRow("SELECT email, status, COALESCE(role,0) FROM users WHERE id=?", id).Scan(&email, &status, &role)
	if err != nil {
		return "", false, 0, false
	}
	return email, status, role, true
}

// SetUserRole 设置用户角色（0=普通 1=admin）。superadmin 由 .env 判定，不经此方法。
func (s *MySQLStore) SetUserRole(id int64, role int) error {
	_, err := s.db.Exec("UPDATE users SET role=? WHERE id=?", role, id)
	return err
}

// --- User API Keys ---

func (s *MySQLStore) CreateAPIKey(userID int64, name string) (*model.UserAPIKey, error) {
	// 每用户 API Key 数量上限，防滥用造数据
	const maxKeysPerUser = 10
	var cnt int
	s.db.QueryRow("SELECT COUNT(*) FROM user_api_keys WHERE user_id=?", userID).Scan(&cnt)
	if cnt >= maxKeysPerUser {
		return nil, fmt.Errorf("API Key 数量已达上限（%d 个）", maxKeysPerUser)
	}
	key := generateAPIKey()
	res, err := s.db.Exec(`INSERT INTO user_api_keys (user_id, api_key, name) VALUES (?, ?, ?)`, userID, key, name)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &model.UserAPIKey{ID: id, UserID: userID, APIKey: key, Name: name, Enabled: true}, nil
}

func (s *MySQLStore) ListAPIKeys(userID int64) ([]model.UserAPIKey, error) {
	rows, err := s.db.Query(`SELECT id, user_id, api_key, name, enabled, COALESCE(last_used_at,''), created_at FROM user_api_keys WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []model.UserAPIKey
	for rows.Next() {
		var k model.UserAPIKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.APIKey, &k.Name, &k.Enabled, &k.LastUsedAt, &k.CreatedAt); err != nil {
			continue
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *MySQLStore) DeleteAPIKey(id, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM user_api_keys WHERE id=? AND user_id=?`, id, userID)
	return err
}

// SetAPIKeyEnabled 启用/禁用单个 API Key（带 user_id 防越权）。禁用后该 Key 立即无法认证。
func (s *MySQLStore) SetAPIKeyEnabled(id, userID int64, enabled bool) error {
	res, err := s.db.Exec(`UPDATE user_api_keys SET enabled=? WHERE id=? AND user_id=?`, enabled, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *MySQLStore) UpdateAPIKeyLastUsed(apiKey string) {
	// 节流：间隔内跳过写库（last_used 无需秒级精确，削减高频随机写）
	if thr := s.lastUsedThrottle.Load(); thr > 0 {
		now := time.Now()
		s.lastUsedMu.Lock()
		if last, ok := s.lastUsedAt[apiKey]; ok && now.Sub(last).Nanoseconds() < thr {
			s.lastUsedMu.Unlock()
			return
		}
		s.lastUsedAt[apiKey] = now
		// 顺手回收过期项，防 map 无限增长（容量超千且当前项已记录时清理过老条目）
		if len(s.lastUsedAt) > 1000 {
			for k, t := range s.lastUsedAt {
				if now.Sub(t).Nanoseconds() >= thr {
					delete(s.lastUsedAt, k)
				}
			}
		}
		s.lastUsedMu.Unlock()
	}
	s.db.Exec("UPDATE user_api_keys SET last_used_at = NOW() WHERE api_key = ?", apiKey)
}

func (s *MySQLStore) GetUserByAPIKey(apiKey string) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(`SELECT u.id, k.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),NULLIF(st.free_concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),NULLIF(st.free_token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),NULLIF(st.free_token_refill_per_hour,0),3), COALESCE(p2.rate_limit_per_min,0), COALESCE(p2.name,''), u.created_at FROM users u JOIN user_api_keys k ON u.id=k.user_id LEFT JOIN plans p2 ON u.plan_id=p2.id LEFT JOIN settings st ON st.id=1 WHERE k.api_key=? AND k.enabled=1 AND u.status=1 AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())`,
		apiKey).Scan(&u.ID, &u.APIKeyID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.RateLimitPerMin, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func generateAPIKey() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 44) // 44 bytes so bias is negligible (<0.01%)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return "sk-" + string(b)
}

// RedeemShopPlan 积分商城兑换套餐时长：单事务内原子扣积分 + 续期，保证钱-货一致。
// 仅当 points>=cost 才扣；扣成功才续期；任一步失败整体回滚。
// 返回 remaining=兑换后积分余额，ok=false 表示积分不足（未扣未发）。
func (s *MySQLStore) RedeemShopPlan(userID int64, planID, days, cost int) (remaining int, ok bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()

	// 1. 原子扣分（条件 points>=cost）
	res, err := tx.Exec("UPDATE users SET points = points - ? WHERE id=? AND points >= ?", cost, userID, cost)
	if err != nil {
		return 0, false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// 余额不足：读当前余额返回，不扣不发
		tx.QueryRow("SELECT points FROM users WHERE id=?", userID).Scan(&remaining)
		return remaining, false, nil
	}

	// 2. 续期（未过期从原到期日累加，过期/NULL 从现在算起；days<=0 视为永久 NULL）
	if days > 0 {
		_, err = tx.Exec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`,
			planID, days, userID)
	} else {
		_, err = tx.Exec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", planID, userID)
	}
	if err != nil {
		return 0, false, err
	}
	logPoints(tx, userID, -cost, "shop", "积分商城兑换套餐")

	if err = tx.Commit(); err != nil {
		return 0, false, err
	}
	s.db.QueryRow("SELECT points FROM users WHERE id=?", userID).Scan(&remaining)
	return remaining, true, nil
}
