package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"chatgpt2api-pro/internal/model"
)

type MySQLStore struct {
	db *sql.DB
}

func NewMySQLStore(dsn string) (*MySQLStore, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("mysql open: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("mysql ping: %w", err)
	}

	s := &MySQLStore{db: db}
	s.autoMigrate()
	return s, nil
}

func (s *MySQLStore) autoMigrate() {
	s.db.Exec(`CREATE TABLE IF NOT EXISTS register_config (
		id INT PRIMARY KEY DEFAULT 1,
		mail_providers JSON,
		proxy VARCHAR(512) DEFAULT '',
		total INT NOT NULL DEFAULT 10,
		threads INT NOT NULL DEFAULT 3,
		mode VARCHAR(16) NOT NULL DEFAULT 'total',
		target_quota INT NOT NULL DEFAULT 100,
		target_available INT NOT NULL DEFAULT 10,
		check_interval INT NOT NULL DEFAULT 5,
		enabled TINYINT(1) NOT NULL DEFAULT 0,
		wait_timeout INT NOT NULL DEFAULT 300,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`INSERT IGNORE INTO register_config (id) VALUES (1)`)

	s.db.Exec(`CREATE TABLE IF NOT EXISTS monitor_config (
		id INT PRIMARY KEY DEFAULT 1,
		enabled TINYINT(1) NOT NULL DEFAULT 1,
		interval_minutes INT NOT NULL DEFAULT 10,
		auto_remove_abnormal TINYINT(1) NOT NULL DEFAULT 1,
		auto_remove_disabled TINYINT(1) NOT NULL DEFAULT 1,
		auto_refill TINYINT(1) NOT NULL DEFAULT 0,
		refill_mode VARCHAR(16) NOT NULL DEFAULT 'total',
		refill_target INT NOT NULL DEFAULT 10,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`INSERT IGNORE INTO monitor_config (id) VALUES (1)`)
	// ALTER 兼容：旧表补「智能补号」两列（列定义与上面 CREATE 保持一致）。
	// MySQL 的 ADD COLUMN 不支持 IF NOT EXISTS，故先用 information_schema 判存在性，
	// 避免全新安装（列已由 CREATE 建好）时每次启动吞一个 Duplicate column 错误。
	mcDB := s.currentDBName()
	if !s.columnExists(mcDB, "monitor_config", "refill_mode") {
		s.db.Exec("ALTER TABLE monitor_config ADD COLUMN refill_mode VARCHAR(16) NOT NULL DEFAULT 'total' AFTER auto_refill")
	}
	if !s.columnExists(mcDB, "monitor_config", "refill_target") {
		s.db.Exec("ALTER TABLE monitor_config ADD COLUMN refill_target INT NOT NULL DEFAULT 10 AFTER refill_mode")
	}

	s.db.Exec(`CREATE TABLE IF NOT EXISTS scheduler_config (
		id INT PRIMARY KEY DEFAULT 1,
		max_global INT NOT NULL DEFAULT 20,
		max_per_user INT NOT NULL DEFAULT 5,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`INSERT IGNORE INTO scheduler_config (id) VALUES (1)`)


	s.db.Exec(`CREATE TABLE IF NOT EXISTS plans (
		id INT PRIMARY KEY AUTO_INCREMENT,
		name VARCHAR(64) NOT NULL,
		price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
		price_yearly DECIMAL(10,2) NOT NULL DEFAULT 0,
		duration_days INT DEFAULT 0,
		duration_days_yearly INT DEFAULT 0,
		token_capacity INT DEFAULT 50,
		token_refill_per_hour INT DEFAULT 3,
		concurrency INT NOT NULL DEFAULT 1,
		features JSON,
		sort_order INT NOT NULL DEFAULT 0,
		highlighted TINYINT(1) NOT NULL DEFAULT 0,
		enabled TINYINT(1) NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

	s.db.Exec("ALTER TABLE plans ADD COLUMN duration_days_yearly INT DEFAULT 0 AFTER duration_days")

	// ALTER plans 加冷却时间
	s.db.Exec("ALTER TABLE plans ADD COLUMN cooldown_minutes INT DEFAULT 0 AFTER sort_order")
	// 检查列是否存在
	var colExists int
	s.db.QueryRow("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='plans' AND COLUMN_NAME='token_capacity'").Scan(&colExists)
	if colExists == 0 {
		s.db.Exec("ALTER TABLE plans ADD COLUMN token_capacity INT DEFAULT 50 AFTER cooldown_minutes")
		s.db.Exec("ALTER TABLE plans ADD COLUMN token_refill_per_hour INT DEFAULT 3 AFTER token_capacity")
	s.db.Exec("ALTER TABLE plans MODIFY COLUMN price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0")
	s.db.Exec("ALTER TABLE plans MODIFY COLUMN price_yearly DECIMAL(10,2) NOT NULL DEFAULT 0")
	s.db.Exec("ALTER TABLE plans ADD COLUMN duration_days INT DEFAULT 0 AFTER price_yearly")
	}
	if _, err := s.db.Exec("UPDATE plans SET token_capacity=50, token_refill_per_hour=3 WHERE token_capacity IS NULL OR token_capacity=0"); err != nil {
		fmt.Printf("[migrate] UPDATE token_capacity: %v\n", err)
	}
	if _, err := s.db.Exec("UPDATE plans SET token_refill_per_hour=3 WHERE token_refill_per_hour IS NULL OR token_refill_per_hour=0"); err != nil {
			fmt.Printf("[migrate] UPDATE token_refill: %v\n", err)
		}

	s.db.Exec(`CREATE TABLE IF NOT EXISTS settings (
		id INT PRIMARY KEY DEFAULT 1,
		site_title VARCHAR(128) NOT NULL DEFAULT 'ChatGPT2API Pro',
		site_subtitle VARCHAR(256) NOT NULL DEFAULT 'AI 图片生成服务',
		site_description TEXT,
		cf_turnstile_enabled TINYINT(1) NOT NULL DEFAULT 0,
		cf_turnstile_site_key VARCHAR(128) DEFAULT '',
		cf_turnstile_secret_key VARCHAR(128) DEFAULT '',
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`INSERT IGNORE INTO settings (id) VALUES (1)`)
	// ALTER 兼容
	s.db.Exec("ALTER TABLE settings ADD COLUMN default_plan_id INT DEFAULT 0 AFTER cf_turnstile_secret_key")
	s.db.Exec("ALTER TABLE settings ADD COLUMN banned_words TEXT AFTER default_plan_id")
	s.db.Exec("ALTER TABLE settings ADD COLUMN checkin_enabled TINYINT(1) DEFAULT 1 AFTER banned_words")
	s.db.Exec("ALTER TABLE settings ADD COLUMN checkin_base INT DEFAULT 10 AFTER checkin_enabled")
	s.db.Exec("ALTER TABLE settings ADD COLUMN checkin_streak_bonus INT DEFAULT 5 AFTER checkin_base")

	s.db.Exec(`CREATE TABLE IF NOT EXISTS checkins (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		user_id BIGINT NOT NULL,
		points_earned INT NOT NULL DEFAULT 0,
		streak INT NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_user_date (user_id, created_at)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	// 防并发重复签到：显式 checkin_date 列 + (user_id, checkin_date) 唯一索引。
	// 全部用 information_schema 存在性判断，保证幂等——避免每次启动 DROP/重建列导致
	// 唯一索引被连带拆除（退化为 UNIQUE(user_id) 会让用户次日无法签到）及全表重建。
	dbName := s.currentDBName()
	// 1. 清理历史遗留的旧函数索引（如存在）
	if s.indexExists(dbName, "checkins", "idx_user_checkin_day") {
		s.db.Exec("ALTER TABLE checkins DROP INDEX idx_user_checkin_day")
	}
	// 2. 补 checkin_date 列（仅当缺失）
	if !s.columnExists(dbName, "checkins", "checkin_date") {
		s.db.Exec("ALTER TABLE checkins ADD COLUMN checkin_date DATE NOT NULL DEFAULT '2000-01-01'")
		s.db.Exec("UPDATE checkins SET checkin_date = DATE(created_at) WHERE checkin_date = '2000-01-01'")
	}
	// 3. 建唯一索引（仅当缺失；CompleteCheckin 依赖它触发 1062 拦截同日并发双签）
	if !s.indexExists(dbName, "checkins", "uk_user_checkin_day") {
		s.db.Exec("ALTER TABLE checkins ADD UNIQUE INDEX uk_user_checkin_day (user_id, checkin_date)")
	}

	// 支付
	s.db.Exec("ALTER TABLE settings ADD COLUMN alipay_enabled TINYINT(1) DEFAULT 0")
	s.db.Exec(`ALTER TABLE settings ADD COLUMN alipay_app_id VARCHAR(64) DEFAULT ''`)
	s.db.Exec("ALTER TABLE settings ADD COLUMN alipay_app_private_key TEXT")
	s.db.Exec("ALTER TABLE settings ADD COLUMN alipay_alipay_public_key TEXT")
	s.db.Exec("ALTER TABLE settings ADD COLUMN alipay_notify_url VARCHAR(256) DEFAULT ''")
	s.db.Exec("ALTER TABLE settings ADD COLUMN storage_config JSON AFTER alipay_notify_url")
	s.db.Exec("ALTER TABLE settings ADD COLUMN site_logo_type VARCHAR(8) NOT NULL DEFAULT 'text'")
	s.db.Exec("ALTER TABLE settings ADD COLUMN site_logo_text VARCHAR(32) NOT NULL DEFAULT 'C2'")
	s.db.Exec("ALTER TABLE settings ADD COLUMN site_logo_url TEXT")
	s.db.Exec("ALTER TABLE settings ADD COLUMN storage_cleanup_days INT NOT NULL DEFAULT 0")
	s.db.Exec("ALTER TABLE settings ADD COLUMN points_exchange_rate INT NOT NULL DEFAULT 10 AFTER storage_cleanup_days")
	s.db.Exec("ALTER TABLE settings ADD COLUMN points_exchange_bonus INT NOT NULL DEFAULT 0 AFTER points_exchange_rate")
	if !s.columnExists(dbName, "settings", "style_presets") {
		s.db.Exec("ALTER TABLE settings ADD COLUMN style_presets TEXT AFTER points_exchange_bonus")
	}
	if !s.columnExists(dbName, "settings", "email_config") {
		s.db.Exec("ALTER TABLE settings ADD COLUMN email_config TEXT AFTER style_presets")
	}
	s.db.Exec(`CREATE TABLE IF NOT EXISTS orders (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		order_no VARCHAR(32) NOT NULL UNIQUE,
		user_id BIGINT NOT NULL,
		plan_id INT NOT NULL DEFAULT 0,
		plan_name VARCHAR(64) DEFAULT '',
		duration_days INT DEFAULT 0,
		amount DECIMAL(10,2) NOT NULL DEFAULT 0,
		status VARCHAR(16) NOT NULL DEFAULT 'pending',
		alipay_trade_no VARCHAR(64) DEFAULT '',
		coupon_code VARCHAR(32) DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		INDEX idx_user_id (user_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`CREATE TABLE IF NOT EXISTS user_coupons (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		user_id BIGINT NOT NULL,
		coupon_id BIGINT NOT NULL,
		code VARCHAR(32) NOT NULL,
		discount_type VARCHAR(8) NOT NULL,
		discount_value DECIMAL(10,2) NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'active',
		claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		used_at DATETIME NULL,
		INDEX idx_user_status (user_id, status),
		INDEX idx_user_coupon (user_id, coupon_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

	s.db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		email VARCHAR(255) NOT NULL UNIQUE,
		password_hash VARCHAR(255) NOT NULL,
		name VARCHAR(128) DEFAULT '',
		points INT NOT NULL DEFAULT 0,
		status TINYINT(1) NOT NULL DEFAULT 1,
		plan_id INT DEFAULT 0,
		subscription_expires_at DATETIME NULL,
		cooldown_until DATETIME NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		INDEX idx_email (email)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	if !s.columnExists(dbName, "users", "ban_reason") {
		s.db.Exec("ALTER TABLE users ADD COLUMN ban_reason VARCHAR(512) DEFAULT '' AFTER status")
	}

	s.db.Exec(`CREATE TABLE IF NOT EXISTS user_api_keys (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		user_id BIGINT NOT NULL,
		api_key VARCHAR(64) NOT NULL UNIQUE,
		name VARCHAR(128) DEFAULT 'Default',
		enabled TINYINT(1) NOT NULL DEFAULT 1,
		last_used_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_user_id (user_id),
		INDEX idx_api_key (api_key)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

	s.db.Exec(`CREATE TABLE IF NOT EXISTS generations (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		user_id BIGINT NOT NULL,
		prompt TEXT NOT NULL,
		model VARCHAR(64) DEFAULT 'gpt-image-2',
		size VARCHAR(16) DEFAULT '1:1',
		image_b64 MEDIUMTEXT,
		image_url VARCHAR(512) DEFAULT '',
		shared TINYINT(1) NOT NULL DEFAULT 0,
		status VARCHAR(16) DEFAULT 'pending',
		error_msg TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_user_id (user_id),
		INDEX idx_created_at (created_at)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	// ALTER 兼容已存在的表
	_, err := s.db.Exec("ALTER TABLE generations ADD COLUMN size VARCHAR(16) DEFAULT '1:1' AFTER model")
	if err != nil {
		if !strings.Contains(err.Error(), "Duplicate column") {
			fmt.Printf("[migrate] ALTER generations size: %v\n", err)
		}
	}
	_, err = s.db.Exec("ALTER TABLE generations ADD COLUMN shared TINYINT(1) NOT NULL DEFAULT 0")
	if err != nil {
		if !strings.Contains(err.Error(), "Duplicate column") {
			fmt.Printf("[migrate] ALTER generations shared: %v\n", err)
		}
	}
	s.db.Exec("ALTER TABLE generations ADD COLUMN image_url VARCHAR(512) DEFAULT '' AFTER image_b64")

	s.db.Exec(`CREATE TABLE IF NOT EXISTS accounts (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		access_token TEXT NOT NULL,
		access_token_hash CHAR(64) AS (SHA2(access_token, 256)) STORED,
		refresh_token TEXT,
		id_token TEXT,
		email VARCHAR(255),
		user_id VARCHAR(128),
		plan_type VARCHAR(32) NOT NULL DEFAULT 'free',
		status VARCHAR(16) NOT NULL DEFAULT '正常',
		quota INT NOT NULL DEFAULT 0,
		image_quota_unknown TINYINT(1) NOT NULL DEFAULT 0,
		source_type VARCHAR(32) NOT NULL DEFAULT 'web',
		proxy VARCHAR(512) DEFAULT '',
		default_model_slug VARCHAR(64),
		restore_at VARCHAR(32),
		success_count INT NOT NULL DEFAULT 0,
		fail_count INT NOT NULL DEFAULT 0,
		invalid_count INT NOT NULL DEFAULT 0,
		last_used_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE INDEX idx_access_token_hash (access_token_hash),
		INDEX idx_status (status),
		INDEX idx_plan_type (plan_type),
		INDEX idx_email (email)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	// 迁移已有表：access_token 扩容为 TEXT（ChatGPT JWT 长度 1000+，旧的 VARCHAR(512) 会静默截断）
	// 用 information_schema 判断当前类型，幂等执行，避免每次启动重复 ALTER。
	if dbn := s.currentDBName(); dbn != "" {
		var colType string
		s.db.QueryRow(
			"SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='accounts' AND COLUMN_NAME='access_token'",
			dbn).Scan(&colType)
		if colType != "" && colType != "text" {
			// 1. 删旧的、建在被截断 VARCHAR 上的唯一索引（如存在）
			if s.indexExists(dbn, "accounts", "idx_access_token") {
				s.db.Exec("ALTER TABLE accounts DROP INDEX idx_access_token")
			}
			// 2. 清理被截断的废 token（长度 512 且不是完整 JWT：点号 < 2），它们已损坏不可恢复
			s.db.Exec("DELETE FROM accounts WHERE LENGTH(access_token) >= 512 AND (LENGTH(access_token) - LENGTH(REPLACE(access_token,'.',''))) < 2")
			// 3. 列扩容为 TEXT
			s.db.Exec("ALTER TABLE accounts MODIFY COLUMN access_token TEXT NOT NULL")
		}
		// 4. 补哈希生成列（如缺失）
		if !s.columnExists(dbn, "accounts", "access_token_hash") {
			s.db.Exec("ALTER TABLE accounts ADD COLUMN access_token_hash CHAR(64) AS (SHA2(access_token, 256)) STORED")
		}
		// 5. 在哈希列上建唯一索引（如缺失）——替代原来直接建在 access_token 上的唯一约束
		if !s.indexExists(dbn, "accounts", "idx_access_token_hash") {
			s.db.Exec("ALTER TABLE accounts ADD UNIQUE INDEX idx_access_token_hash (access_token_hash)")
		}
	}

	s.db.Exec(`CREATE TABLE IF NOT EXISTS admins (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		username VARCHAR(64) NOT NULL UNIQUE,
		password_hash VARCHAR(255) NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	// 默认管理员种子: admin / admin123（INSERT IGNORE 保证幂等，裸 MySQL 与 Docker 两条路径一致）
	// 生产环境务必通过 cmd/reset_admin 立即改密
	s.db.Exec(`INSERT IGNORE INTO admins (username, password_hash) VALUES
		('admin', '$2a$10$CHVZQtMykzHOWd6gluYYyunsXGdjxSQbAJF3lGc30o63pP4Syf5mW')`)

	s.db.Exec(`CREATE TABLE IF NOT EXISTS redeem_codes (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		code VARCHAR(32) NOT NULL UNIQUE,
		type VARCHAR(16) NOT NULL,
		plan_id INT DEFAULT 0,
		plan_duration_days INT DEFAULT 0,
		points INT DEFAULT 0,
		max_uses INT NOT NULL DEFAULT 1,
		use_count INT NOT NULL DEFAULT 0,
		status TINYINT(1) NOT NULL DEFAULT 1,
		expires_at DATETIME NULL,
		created_by BIGINT NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		INDEX idx_code (code),
		INDEX idx_status (status)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

	s.db.Exec(`CREATE TABLE IF NOT EXISTS redeem_logs (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		redeem_code_id BIGINT NOT NULL,
		user_id BIGINT NOT NULL,
		code VARCHAR(32) NOT NULL,
		type VARCHAR(16) NOT NULL,
		value VARCHAR(255) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_code (code),
		INDEX idx_user_id (user_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	s.db.Exec(`CREATE TABLE IF NOT EXISTS coupon_codes (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		code VARCHAR(32) NOT NULL UNIQUE,
		discount_type VARCHAR(8) NOT NULL,
		discount_value DECIMAL(10,2) NOT NULL,
		min_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
		max_uses INT NOT NULL DEFAULT 0,
		use_count INT NOT NULL DEFAULT 0,
		status TINYINT(1) NOT NULL DEFAULT 1,
		expires_at DATETIME NULL,
		created_by BIGINT NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		INDEX idx_code (code),
		INDEX idx_status (status)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}

// currentDBName 返回当前连接的数据库名（用于 information_schema 查询）
func (s *MySQLStore) currentDBName() string {
	var name string
	s.db.QueryRow("SELECT DATABASE()").Scan(&name)
	return name
}

// columnExists 判断表中是否存在指定列（幂等迁移用）
func (s *MySQLStore) columnExists(db, table, column string) bool {
	var n int
	s.db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
		db, table, column).Scan(&n)
	return n > 0
}

// indexExists 判断表中是否存在指定索引（幂等迁移用）
func (s *MySQLStore) indexExists(db, table, index string) bool {
	var n int
	s.db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?",
		db, table, index).Scan(&n)
	return n > 0
}

func (s *MySQLStore) Close() { s.db.Close() }

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

// --- Generations ---

func (s *MySQLStore) CreateGeneration(userID int64, prompt, model, size string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO generations (user_id, prompt, model, size, status) VALUES (?, ?, ?, ?, 'pending')`, userID, prompt, model, size)
	if err != nil { return 0, err }
	return res.LastInsertId()
}

func (s *MySQLStore) SetUserCooldown(userID int64, minutes int) error {
	_, err := s.db.Exec("UPDATE users SET cooldown_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?", minutes, userID)
	return err
}

func (s *MySQLStore) CountUserGenerations(userID int64) (today, week int) {
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND created_at >= CURDATE()", userID).Scan(&today)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)", userID).Scan(&week)
	return
}

func (s *MySQLStore) CleanupStaleGenerations(timeoutMinutes int) (int64, error) {
	res, err := s.db.Exec(`UPDATE generations SET status='failed', error_msg='生成超时' WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`, timeoutMinutes)
	if err != nil { return 0, err }
	return res.RowsAffected()
}

func (s *MySQLStore) DeleteUserGeneration(id, userID int64) error {
	res, err := s.db.Exec(`DELETE FROM generations WHERE id=? AND user_id=?`, id, userID)
	if err != nil { return err }
	n, _ := res.RowsAffected()
	if n == 0 { return sql.ErrNoRows }
	return nil
}

// ListExpiredLocalGenerations 取早于 before 的「外部存储」记录（image_url 非空），用于过期清理。
// 跳过已分享到广场的图（shared=0），按 created_at 升序优先清理最旧的，limit 分批控制单次量。
func (s *MySQLStore) ListExpiredLocalGenerations(before time.Time, limit int) ([]model.Generation, error) {
	rows, err := s.db.Query(
		`SELECT id, COALESCE(image_url,'') FROM generations
		 WHERE image_url IS NOT NULL AND image_url != '' AND shared=0 AND created_at < ?
		 ORDER BY created_at ASC LIMIT ?`, before, limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		if err := rows.Scan(&g.ID, &g.ImageURL); err != nil { return nil, err }
		gens = append(gens, g)
	}
	return gens, rows.Err()
}

// DeleteGenerationsByIDs 按 id 批量删除记录，返回删除行数。
func (s *MySQLStore) DeleteGenerationsByIDs(ids []int64) (int64, error) {
	if len(ids) == 0 { return 0, nil }
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	res, err := s.db.Exec(`DELETE FROM generations WHERE id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil { return 0, err }
	return res.RowsAffected()
}

func (s *MySQLStore) GetGenerationByID(id int64) (*model.Generation, error) {
	var g model.Generation
	err := s.db.QueryRow("SELECT id, user_id, prompt, model, COALESCE(size,''), COALESCE(image_b64,''), COALESCE(image_url,''), status, COALESCE(error_msg,''), shared, created_at FROM generations WHERE id=?", id).
		Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.Shared, &g.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (s *MySQLStore) UpdateGeneration(id int64, imageB64, status, errMsg, imageURL string) error {
	_, err := s.db.Exec("UPDATE generations SET image_b64=?, image_url=?, status=?, error_msg=? WHERE id=?", imageB64, imageURL, status, errMsg, id)
	return err
}

func (s *MySQLStore) GetUserGenerations(userID int64, page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=?", userID).Scan(&total)
	rows, err := s.db.Query("SELECT id, user_id, prompt, model, COALESCE(size,''), COALESCE(image_b64,''), COALESCE(image_url,''), status, COALESCE(error_msg,''), created_at, shared FROM generations WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?", userID, pageSize, (page-1)*pageSize)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.CreatedAt, &g.Shared)
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

func (s *MySQLStore) GetAllGenerations(page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations").Scan(&total)
	rows, err := s.db.Query("SELECT g.id, g.user_id, g.prompt, g.model, COALESCE(g.size,''), COALESCE(g.image_b64,''), COALESCE(g.image_url,''), g.status, COALESCE(g.error_msg,''), g.created_at, COALESCE(u.email,''), COALESCE(u.name,''), g.shared FROM generations g LEFT JOIN users u ON g.user_id=u.id ORDER BY g.id DESC LIMIT ? OFFSET ?", pageSize, (page-1)*pageSize)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.CreatedAt, &g.UserEmail, &g.UserName, &g.Shared)
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

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
	if durationDays > 0 { args = append(args, durationDays) }
	res, err := s.db.Exec(query, args...)
	if err != nil { return 0, err }
	return res.LastInsertId()
}

func (s *MySQLStore) GetUserByEmail(email string) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),3), COALESCE(p2.name,''), u.created_at FROM users u LEFT JOIN plans p2 ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p2.id WHERE u.email=?`,
		email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
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
	if len(conditions) > 0 { where = "WHERE " + strings.Join(conditions, " AND ") }

	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM users "+where, args...).Scan(&total)

	allArgs := append([]any{}, args...)
	allArgs = append(allArgs, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, COALESCE(p.name,''), u.created_at
		FROM users u LEFT JOIN plans p ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p.id
		`+where+" ORDER BY u.id DESC LIMIT ? OFFSET ?", allArgs...)
	if err != nil { return nil, 0, err }
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.PlanName, &u.CreatedAt); err != nil { continue }
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
	if err != nil { return 0, err }
	return res.LastInsertId()
}

func (s *MySQLStore) UpdateUser(id int64, name string) error {
	_, err := s.db.Exec("UPDATE users SET name=? WHERE id=?", name, id)
	return err
}

func (s *MySQLStore) ResetUserPassword(id int64, passwordHash string) error {
	_, err := s.db.Exec("UPDATE users SET password_hash=? WHERE id=?", passwordHash, id)
	return err
}

func (s *MySQLStore) AddUserPoints(id int64, delta int) (int, error) {
	_, err := s.db.Exec("UPDATE users SET points = points + ? WHERE id=?", delta, id)
	if err != nil { return 0, err }
	var pts int
	s.db.QueryRow("SELECT points FROM users WHERE id=?", id).Scan(&pts)
	return pts, nil
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

	return tx.Commit()
}

func (s *MySQLStore) GetLastCheckinStreak(userID int64) (int, error) {
	var streak int
	var lastDate string
	err := s.db.QueryRow("SELECT streak, DATE(created_at) FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 1", userID).Scan(&streak, &lastDate)
	if err == sql.ErrNoRows { return 0, nil }
	if err != nil { return 0, err }
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
	err := s.db.QueryRow(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, COALESCE(u.ban_reason,''), u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),3), COALESCE(p2.name,''), u.created_at FROM users u LEFT JOIN plans p2 ON (CASE WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at < NOW() THEN NULL ELSE u.plan_id END) = p2.id WHERE u.id=?`,
		id).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.BanReason, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	return &u, nil
}

// --- User API Keys ---

func (s *MySQLStore) CreateAPIKey(userID int64, name string) (*model.UserAPIKey, error) {
	key := generateAPIKey()
	res, err := s.db.Exec(`INSERT INTO user_api_keys (user_id, api_key, name) VALUES (?, ?, ?)`, userID, key, name)
	if err != nil { return nil, err }
	id, _ := res.LastInsertId()
	return &model.UserAPIKey{ID: id, UserID: userID, APIKey: key, Name: name, Enabled: true}, nil
}

func (s *MySQLStore) ListAPIKeys(userID int64) ([]model.UserAPIKey, error) {
	rows, err := s.db.Query(`SELECT id, user_id, api_key, name, enabled, COALESCE(last_used_at,''), created_at FROM user_api_keys WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil { return nil, err }
	defer rows.Close()
	var keys []model.UserAPIKey
	for rows.Next() {
		var k model.UserAPIKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.APIKey, &k.Name, &k.Enabled, &k.LastUsedAt, &k.CreatedAt); err != nil { continue }
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

func (s *MySQLStore) UpdateAPIKeyLastUsed(apiKey string) {
	s.db.Exec("UPDATE user_api_keys SET last_used_at = NOW() WHERE api_key = ?", apiKey)
}

func (s *MySQLStore) GetUserByAPIKey(apiKey string) (*model.User, error) {
	var u model.User
	err := s.db.QueryRow(`SELECT u.id, u.email, u.password_hash, COALESCE(u.name,''), u.points, u.status, u.plan_id, u.subscription_expires_at, u.cooldown_until, COALESCE(NULLIF(p2.concurrency,0),1), COALESCE(NULLIF(p2.token_capacity,0),50), COALESCE(NULLIF(p2.token_refill_per_hour,0),3), COALESCE(p2.name,''), u.created_at FROM users u JOIN user_api_keys k ON u.id=k.user_id LEFT JOIN plans p2 ON u.plan_id=p2.id WHERE k.api_key=? AND k.enabled=1 AND u.status=1 AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())`,
		apiKey).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Points, &u.Status, &u.PlanID, &u.SubscriptionExpiresAt, &u.CooldownUntil, &u.PlanConcurrency, &u.TokenCapacity, &u.TokenRefillPerHour, &u.PlanName, &u.CreatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
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


// --- Storage Config ---

func (s *MySQLStore) GetStorageConfig() (*model.StorageConfig, error) {
	var cfgJSON sql.NullString
	err := s.db.QueryRow("SELECT COALESCE(storage_config,'') FROM settings WHERE id=1").Scan(&cfgJSON)
	if err != nil || !cfgJSON.Valid || cfgJSON.String == "" {
		return &model.StorageConfig{Type: "database"}, nil
	}
	var cfg model.StorageConfig
	json.Unmarshal([]byte(cfgJSON.String), &cfg)
	if cfg.Type == "" { cfg.Type = "database" }
	return &cfg, nil
}

func (s *MySQLStore) SaveStorageConfig(cfg *model.StorageConfig) error {
	j, _ := json.Marshal(cfg)
	_, err := s.db.Exec("UPDATE settings SET storage_config=? WHERE id=1", string(j))
	return err
}

// --- Settings ---

func (s *MySQLStore) GetSettings() (*model.Settings, error) {
	cfg := &model.Settings{}
	err := s.db.QueryRow(`SELECT site_title, site_subtitle, COALESCE(site_description,''), cf_turnstile_enabled, cf_turnstile_site_key, cf_turnstile_secret_key, COALESCE(default_plan_id,0), COALESCE(banned_words,''), COALESCE(checkin_enabled,1), COALESCE(checkin_base,10), COALESCE(checkin_streak_bonus,5), COALESCE(alipay_enabled,0), COALESCE(alipay_app_id,''), COALESCE(alipay_app_private_key,''), COALESCE(alipay_alipay_public_key,''), COALESCE(alipay_notify_url,''), COALESCE(site_logo_type,'text'), COALESCE(site_logo_text,'C2'), COALESCE(site_logo_url,''), COALESCE(storage_cleanup_days,0), COALESCE(points_exchange_rate,10), COALESCE(points_exchange_bonus,0), COALESCE(style_presets,''), COALESCE(email_config,'') FROM settings WHERE id=1`).
		Scan(&cfg.SiteTitle, &cfg.SiteSubtitle, &cfg.SiteDescription, &cfg.CFTurnstileEnabled, &cfg.CFTurnstileSiteKey, &cfg.CFTurnstileSecretKey, &cfg.DefaultPlanID, &cfg.BannedWords, &cfg.CheckinEnabled, &cfg.CheckinBase, &cfg.CheckinStreakBonus, &cfg.AlipayEnabled, &cfg.AlipayAppID, &cfg.AlipayAppPrivateKey, &cfg.AlipayPublicKey, &cfg.AlipayNotifyURL, &cfg.SiteLogoType, &cfg.SiteLogoText, &cfg.SiteLogoURL, &cfg.StorageCleanupDays, &cfg.PointsExchangeRate, &cfg.PointsExchangeBonus, &cfg.StylePresets, &cfg.EmailConfig)
	if err != nil { return cfg, nil }
	return cfg, nil
}

func (s *MySQLStore) SaveSettings(cfg *model.Settings) error {
	// 保护敏感字段：如果传入为空则保留 DB 中现有值（防止 GET 清空后被覆盖）
	existing, _ := s.GetSettings()
	if existing != nil {
		if cfg.CFTurnstileSecretKey == "" && existing.CFTurnstileSecretKey != "" {
			cfg.CFTurnstileSecretKey = existing.CFTurnstileSecretKey
		}
		if cfg.AlipayAppPrivateKey == "" && existing.AlipayAppPrivateKey != "" {
			cfg.AlipayAppPrivateKey = existing.AlipayAppPrivateKey
		}
		if cfg.AlipayPublicKey == "" && existing.AlipayPublicKey != "" {
			cfg.AlipayPublicKey = existing.AlipayPublicKey
		}
	}
	_, err := s.db.Exec(`UPDATE settings SET site_title=?, site_subtitle=?, site_description=?, cf_turnstile_enabled=?, cf_turnstile_site_key=?, cf_turnstile_secret_key=?, default_plan_id=?, banned_words=?, checkin_enabled=?, checkin_base=?, checkin_streak_bonus=?, alipay_enabled=?, alipay_app_id=?, alipay_app_private_key=?, alipay_alipay_public_key=?, alipay_notify_url=?, site_logo_type=?, site_logo_text=?, site_logo_url=?, storage_cleanup_days=?, points_exchange_rate=?, points_exchange_bonus=?, style_presets=?, email_config=? WHERE id=1`,
		cfg.SiteTitle, cfg.SiteSubtitle, cfg.SiteDescription, cfg.CFTurnstileEnabled, cfg.CFTurnstileSiteKey, cfg.CFTurnstileSecretKey, cfg.DefaultPlanID, cfg.BannedWords, cfg.CheckinEnabled, cfg.CheckinBase, cfg.CheckinStreakBonus, cfg.AlipayEnabled, cfg.AlipayAppID, cfg.AlipayAppPrivateKey, cfg.AlipayPublicKey, cfg.AlipayNotifyURL, cfg.SiteLogoType, cfg.SiteLogoText, cfg.SiteLogoURL, cfg.StorageCleanupDays, cfg.PointsExchangeRate, cfg.PointsExchangeBonus, cfg.StylePresets, cfg.EmailConfig)
	return err
}

// --- Monitor Config ---

func (s *MySQLStore) GetMonitorConfig() (*model.MonitorConfig, error) {
	cfg := &model.MonitorConfig{}
	err := s.db.QueryRow(`SELECT enabled, interval_minutes, auto_remove_abnormal, auto_remove_disabled, auto_refill, refill_mode, refill_target FROM monitor_config WHERE id=1`).
		Scan(&cfg.Enabled, &cfg.IntervalMinutes, &cfg.AutoRemoveAbnormal, &cfg.AutoRemoveDisabled, &cfg.AutoRefill, &cfg.RefillMode, &cfg.RefillTarget)
	if err != nil {
		return cfg, nil
	}
	return cfg, nil
}

func (s *MySQLStore) SaveMonitorConfig(cfg *model.MonitorConfig) error {
	_, err := s.db.Exec(`UPDATE monitor_config SET enabled=?, interval_minutes=?, auto_remove_abnormal=?, auto_remove_disabled=?, auto_refill=?, refill_mode=?, refill_target=? WHERE id=1`,
		cfg.Enabled, cfg.IntervalMinutes, cfg.AutoRemoveAbnormal, cfg.AutoRemoveDisabled, cfg.AutoRefill, cfg.RefillMode, cfg.RefillTarget)
	return err
}

// --- Scheduler Config ---

func (s *MySQLStore) GetSchedulerConfig() (maxGlobal, maxPerUser int) {
	err := s.db.QueryRow("SELECT max_global, max_per_user FROM scheduler_config WHERE id=1").
		Scan(&maxGlobal, &maxPerUser)
	if err != nil { return 20, 5 }
	return
}

func (s *MySQLStore) SaveSchedulerConfig(maxGlobal, maxPerUser int) error {
	_, err := s.db.Exec("UPDATE scheduler_config SET max_global=?, max_per_user=? WHERE id=1", maxGlobal, maxPerUser)
	return err
}

// --- Plans ---

func (s *MySQLStore) ListPlans(enabledOnly bool) ([]model.Plan, error) {
	where := ""
	if enabledOnly { where = " WHERE enabled=1" }
	rows, err := s.db.Query("SELECT id, name, price_monthly, price_yearly, duration_days, COALESCE(duration_days_yearly,0), concurrency, token_capacity, token_refill_per_hour, COALESCE(features,'[]'), sort_order, highlighted, enabled, created_at FROM plans" + where + " ORDER BY sort_order")
	if err != nil { return nil, err }
	defer rows.Close()
	var plans []model.Plan
	for rows.Next() {
		var p model.Plan
		rows.Scan(&p.ID, &p.Name, &p.PriceMonthly, &p.PriceYearly, &p.DurationDays, &p.DurationDaysYearly, &p.Concurrency, &p.TokenCapacity, &p.TokenRefillPerHour, &p.Features, &p.SortOrder, &p.Highlighted, &p.Enabled, &p.CreatedAt)
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return plans, nil
}

func (s *MySQLStore) CreatePlan(p *model.Plan) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO plans (name, price_monthly, price_yearly, duration_days, duration_days_yearly, concurrency, token_capacity, token_refill_per_hour, features, sort_order, highlighted, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.Name, p.PriceMonthly, p.PriceYearly, p.DurationDays, p.DurationDaysYearly, p.Concurrency, p.TokenCapacity, p.TokenRefillPerHour, p.Features, p.SortOrder, p.Highlighted, p.Enabled)
	if err != nil { return 0, err }
	return res.LastInsertId()
}

func (s *MySQLStore) UpdatePlan(p *model.Plan) error {
	_, err := s.db.Exec(
		`UPDATE plans SET name=?, price_monthly=?, price_yearly=?, duration_days=?, duration_days_yearly=?, concurrency=?, token_capacity=?, token_refill_per_hour=?, features=?, sort_order=?, highlighted=?, enabled=? WHERE id=?`,
		p.Name, p.PriceMonthly, p.PriceYearly, p.DurationDays, p.DurationDaysYearly, p.Concurrency, p.TokenCapacity, p.TokenRefillPerHour, p.Features, p.SortOrder, p.Highlighted, p.Enabled, p.ID)
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

// --- Share / Gallery ---

func (s *MySQLStore) ToggleShare(genID, userID int64, shared bool) error {
	res, err := s.db.Exec("UPDATE generations SET shared=? WHERE id=? AND user_id=?", shared, genID, userID)
	if err != nil { return err }
	n, _ := res.RowsAffected()
	if n == 0 { return sql.ErrNoRows }
	return nil
}

func (s *MySQLStore) AdminUnshare(genID int64) error {
	_, err := s.db.Exec("UPDATE generations SET shared=0 WHERE id=?", genID)
	return err
}

func (s *MySQLStore) ListSharedGalleries(page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE shared=1 AND status=\"completed\" AND ((image_b64 IS NOT NULL AND LENGTH(image_b64) > 100) OR (image_url IS NOT NULL AND image_url != \"\"))").Scan(&total)
	rows, err := s.db.Query("SELECT g.id, g.user_id, g.prompt, g.model, COALESCE(g.size,\"\"), COALESCE(g.image_b64,\"\"), COALESCE(g.image_url,\"\"), g.status, COALESCE(u.email,\"\"), COALESCE(u.name,\"\"), g.shared, g.created_at FROM generations g LEFT JOIN users u ON g.user_id=u.id WHERE g.shared=1 AND g.status=\"completed\" AND ((g.image_b64 IS NOT NULL AND LENGTH(g.image_b64) > 100) OR (g.image_url IS NOT NULL AND g.image_url != \"\")) ORDER BY g.id DESC LIMIT ? OFFSET ?", pageSize, (page-1)*pageSize)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		if err := rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.UserEmail, &g.UserName, &g.Shared, &g.CreatedAt); err != nil {
			continue
		}
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

// --- Orders ---

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}

func (s *MySQLStore) CreateOrder(userID int64, plan *model.Plan, orderNo, billing string) (*model.Order, error) {
	duration := plan.DurationDays
	amount := plan.PriceMonthly
	if duration > 0 {
		amount = round2(plan.PriceMonthly * float64(duration) / 30)
	}
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			duration = plan.DurationDaysYearly
			amount = round2(plan.PriceYearly * 12 * float64(duration) / 365)
		} else {
			duration = 0
			amount = round2(plan.PriceYearly * 12)
		}
	}
	res, err := s.db.Exec(`INSERT INTO orders (order_no, user_id, plan_id, plan_name, duration_days, amount, status) VALUES (?,?,?,?,?,?,'pending')`,
		orderNo, userID, plan.ID, plan.Name, duration, amount)
	if err != nil { return nil, err }
	id, _ := res.LastInsertId()
	return &model.Order{
		ID: id, OrderNo: orderNo, UserID: userID, PlanID: plan.ID,
		PlanName: plan.Name, DurationDays: duration, Amount: amount,
		Status: "pending",
	}, nil
}

func (s *MySQLStore) GetOrderByOrderNo(orderNo string) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE order_no=?`, orderNo).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	return &o, nil
}

func (s *MySQLStore) GetOrderByID(id int64) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE id=?`, id).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	return &o, nil
}

func (s *MySQLStore) GetUserOrders(userID int64, page, pageSize int) ([]model.Order, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE user_id=?", userID).Scan(&total)
	rows, err := s.db.Query("SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?", userID, pageSize, (page-1)*pageSize)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var orders []model.Order
	for rows.Next() {
		var o model.Order
		if err := rows.Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

func (s *MySQLStore) GetLastPaidOrder(userID int64) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE user_id=? AND status='paid' ORDER BY id DESC LIMIT 1`, userID).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	return &o, nil
}

func (s *MySQLStore) CreateUpgradeOrder(userID int64, plan *model.Plan, orderNo, billing string, price float64) (*model.Order, error) {
	duration := plan.DurationDays
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			duration = plan.DurationDaysYearly
		} else {
			duration = 0
		}
	}
	res, err := s.db.Exec(`INSERT INTO orders (order_no, user_id, plan_id, plan_name, duration_days, amount, status) VALUES (?,?,?,?,?,?,'pending')`,
		orderNo, userID, plan.ID, plan.Name, duration, price)
	if err != nil { return nil, err }
	id, _ := res.LastInsertId()
	return &model.Order{
		ID: id, OrderNo: orderNo, UserID: userID, PlanID: plan.ID,
		PlanName: plan.Name, DurationDays: duration, Amount: price,
		Status: "pending",
	}, nil
}

func (s *MySQLStore) UpdateOrderAmount(orderNo string, amount float64, couponCode string) error {
	_, err := s.db.Exec("UPDATE orders SET amount=?, coupon_code=? WHERE order_no=?", amount, couponCode, orderNo)
	return err
}

func (s *MySQLStore) MarkOrderPaid(orderNo, alipayTradeNo string) (bool, error) {
	res, err := s.db.Exec("UPDATE orders SET status='paid', alipay_trade_no=? WHERE order_no=? AND status='pending'", alipayTradeNo, orderNo)
	if err != nil { return false, err }
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *MySQLStore) GetAllOrders(page, pageSize int, status string) ([]model.Order, int, error) {
	var total int
	where := ""
	args := []any{}
	if status != "" {
		where = " WHERE o.status=?"
		args = append(args, status)
	}
	s.db.QueryRow("SELECT COUNT(*) FROM orders o"+where, args...).Scan(&total)
	query := `SELECT o.id, o.order_no, o.user_id, COALESCE(u.email,''), COALESCE(u.name,''),
		o.plan_id, COALESCE(o.plan_name,''), COALESCE(o.duration_days,0), o.amount, o.status,
		COALESCE(o.alipay_trade_no,''), COALESCE(o.coupon_code,''), o.created_at, o.updated_at
		FROM orders o LEFT JOIN users u ON o.user_id=u.id` + where +
		` ORDER BY o.id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var orders []model.Order
	for rows.Next() {
		var o model.Order
		if err := rows.Scan(&o.ID, &o.OrderNo, &o.UserID, &o.UserEmail, &o.UserName,
			&o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status,
			&o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

// --- Coupons ---

func (s *MySQLStore) CreateCoupon(c *model.CouponCode) (int64, error) {
	_, err := s.db.Exec("INSERT INTO coupon_codes (code, discount_type, discount_value, min_amount, max_uses, created_by) VALUES (?,?,?,?,?,?)",
		c.Code, c.DiscountType, c.DiscountValue, c.MinAmount, c.MaxUses, c.CreatedBy)
	if err != nil { return 0, err }
	return 0, nil
}

func (s *MySQLStore) ListCoupons() ([]model.CouponCode, error) {
	rows, err := s.db.Query("SELECT id, code, discount_type, discount_value, min_amount, max_uses, use_count, status, COALESCE(expires_at,''), created_by, created_at, updated_at FROM coupon_codes ORDER BY id DESC")
	if err != nil { return nil, err }
	defer rows.Close()
	var list []model.CouponCode
	for rows.Next() {
		var c model.CouponCode
		if err := rows.Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.MinAmount, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *MySQLStore) DisableCoupon(id int64) error {
	_, err := s.db.Exec("UPDATE coupon_codes SET status=0 WHERE id=?", id)
	return err
}

func (s *MySQLStore) ValidateCoupon(code string, amount float64) (*model.CouponCode, error) {
	var c model.CouponCode
	err := s.db.QueryRow("SELECT id, code, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=?", code).
		Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.MinAmount, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	if !c.Status { return nil, nil }
	if c.MaxUses > 0 && c.UseCount >= c.MaxUses { return nil, nil }
	if c.ExpiresAt != nil && *c.ExpiresAt != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", *c.ExpiresAt, time.Local)
		if time.Now().After(exp) { return nil, nil }
	}
	if amount < c.MinAmount { return nil, nil }
	return &c, nil
}

func (s *MySQLStore) AtomicUseCoupon(code string, amount float64) (discountType string, discountValue float64, ok bool, err error) {
	tx, err := s.db.Begin()
	if err != nil { return "", 0, false, err }
	defer tx.Rollback()

	var id int64
	var dtype string
	var dval, minAmt float64
	var maxUses, useCount int
	var status bool
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT id, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=? FOR UPDATE", code).
		Scan(&id, &dtype, &dval, &minAmt, &maxUses, &useCount, &status, &expiresAt)
	if err == sql.ErrNoRows { return "", 0, false, nil }
	if err != nil { return "", 0, false, err }

	if !status { return "", 0, false, nil }
	if maxUses > 0 && useCount >= maxUses { return "", 0, false, nil }
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.Local)
		if time.Now().After(exp) { return "", 0, false, nil }
	}
	if amount < minAmt { return "", 0, false, nil }

	_, err = tx.Exec("UPDATE coupon_codes SET use_count=use_count+1 WHERE id=?", id)
	if err != nil { return "", 0, false, err }

	if err := tx.Commit(); err != nil { return "", 0, false, err }
	return dtype, dval, true, nil
}


// --- User Coupons ---

func (s *MySQLStore) ClaimCoupon(userID int64, code string) (*model.UserCoupon, error) {
	// 原子地校验优惠码并绑定到用户
	tx, err := s.db.Begin()
	if err != nil { return nil, err }
	defer tx.Rollback()

	var id int64
	var dtype string
	var dval, minAmt float64
	var maxUses, useCount int
	var status bool
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT id, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=? FOR UPDATE", code).
		Scan(&id, &dtype, &dval, &minAmt, &maxUses, &useCount, &status, &expiresAt)
	if err == sql.ErrNoRows { return nil, nil }
	if err != nil { return nil, err }
	if !status { return nil, nil }
	if maxUses > 0 && useCount >= maxUses { return nil, nil }
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.Local)
		if time.Now().After(exp) { return nil, nil }
	}

	// 检查用户是否已领过
	var existing int
	tx.QueryRow("SELECT COUNT(*) FROM user_coupons WHERE user_id=? AND coupon_id=? AND status='active'", userID, id).Scan(&existing)
	if existing > 0 { return nil, nil }

	// 创建用户优惠券记录
	res, err := tx.Exec("INSERT INTO user_coupons (user_id, coupon_id, code, discount_type, discount_value) VALUES (?,?,?,?,?)", userID, id, code, dtype, dval)
	if err != nil { return nil, err }
	cpID, _ := res.LastInsertId()

	if err := tx.Commit(); err != nil { return nil, err }
	return &model.UserCoupon{ID: cpID, UserID: userID, CouponID: id, Code: code, DiscountType: dtype, DiscountValue: dval, Status: "active"}, nil
}

func (s *MySQLStore) ListUserCoupons(userID int64) ([]model.UserCoupon, error) {
	rows, err := s.db.Query("SELECT id, user_id, coupon_id, code, discount_type, discount_value, status, claimed_at, COALESCE(used_at,'') FROM user_coupons WHERE user_id=? ORDER BY FIELD(status,'active','used','expired'), claimed_at DESC", userID)
	if err != nil { return nil, err }
	defer rows.Close()
	var list []model.UserCoupon
	for rows.Next() {
		var c model.UserCoupon
		if err := rows.Scan(&c.ID, &c.UserID, &c.CouponID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.Status, &c.ClaimedAt, &c.UsedAt); err != nil {
			continue
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *MySQLStore) UseUserCoupon(couponID, userID int64) error {
	_, err := s.db.Exec("UPDATE user_coupons SET status='used', used_at=NOW() WHERE id=? AND user_id=? AND status='active'", couponID, userID)
	return err
}

// --- Stats ---

func (s *MySQLStore) GetAdminStats() (*model.AdminStats, error) {
	var st model.AdminStats

	s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&st.TotalUsers)
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE DATE(created_at)=CURDATE()").Scan(&st.TodayUsers)
	s.db.QueryRow("SELECT COUNT(*) FROM users WHERE status=1").Scan(&st.ActiveUsers)

	s.db.QueryRow("SELECT COUNT(*) FROM generations").Scan(&st.TotalGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE DATE(created_at)=CURDATE()").Scan(&st.TodayGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE status='completed' AND DATE(created_at)=CURDATE()").Scan(&st.TodaySuccess)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE status='failed' AND DATE(created_at)=CURDATE()").Scan(&st.TodayFailed)

	s.db.QueryRow("SELECT COUNT(*) FROM orders").Scan(&st.TotalOrders)
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE status='paid'").Scan(&st.PaidOrders)
	s.db.QueryRow("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND DATE(created_at)=CURDATE()").Scan(&st.TodayRevenue)
	s.db.QueryRow("SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid'").Scan(&st.TotalRevenue)

	s.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&st.TotalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='正常'").Scan(&st.NormalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='限流'").Scan(&st.LimitedAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='异常'").Scan(&st.AbnormalAccounts)
	s.db.QueryRow("SELECT COUNT(*) FROM accounts WHERE status='禁用'").Scan(&st.DisabledAccounts)

	return &st, nil
}

func (s *MySQLStore) GetStatsTrends(days int) (*model.TrendsData, error) {
	td := &model.TrendsData{}
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	type row struct{ Date string; Value float64 }
	query := func(q string) ([]model.TrendPoint, error) {
		rows, err := s.db.Query(q, startDate)
		if err != nil { return nil, err }
		defer rows.Close()
		var pts []model.TrendPoint
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.Date, &r.Value); err != nil { continue }
			pts = append(pts, model.TrendPoint{Date: r.Date, Value: r.Value})
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return pts, nil
	}

	var err error
	td.Generations, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE created_at >= ? GROUP BY d ORDER BY d")
	if err != nil { return nil, err }
	td.Success, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE status='completed' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil { return nil, err }
	td.Failed, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE status='failed' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil { return nil, err }
	td.Revenue, err = query("SELECT DATE(created_at) as d, COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND created_at >= ? GROUP BY d ORDER BY d")
	if err != nil { return nil, err }
	td.Users, err = query("SELECT DATE(created_at) as d, COUNT(*) FROM users WHERE created_at >= ? GROUP BY d ORDER BY d")
	if err != nil { return nil, err }

	// Fill missing days with zero, normalize all dates to MM-DD
	fillDays := func(pts []model.TrendPoint, n int) []model.TrendPoint {
		byDate := map[string]float64{}
		for _, p := range pts {
			d := p.Date
			if len(d) >= 10 { d = d[5:10] }
			byDate[d] = p.Value
		}
		out := make([]model.TrendPoint, 0, n)
		now := time.Now()
		for i := n - 1; i >= 0; i-- {
			d := now.AddDate(0, 0, -i).Format("01-02")
			v, ok := byDate[d]
			if !ok { v = 0 }
			out = append(out, model.TrendPoint{Date: d, Value: v})
		}
		return out
	}
	td.Generations = fillDays(td.Generations, days)
	td.Success = fillDays(td.Success, days)
	td.Failed = fillDays(td.Failed, days)
	td.Revenue = fillDays(td.Revenue, days)
	td.Users = fillDays(td.Users, days)

	return td, nil
}

// GetGenerationsAgeDays 返回最早一条生图记录距今的天数（至少 1）
func (s *MySQLStore) GetGenerationsAgeDays() int {
	var days *int
	s.db.QueryRow("SELECT DATEDIFF(CURDATE(), DATE(MIN(created_at))) FROM generations").Scan(&days)
	if days == nil || *days < 1 {
		return 1
	}
	return *days
}

func (s *MySQLStore) GetModelBreakdown() ([]model.ModelBreakdown, error) {
	rows, err := s.db.Query("SELECT COALESCE(model,'unknown') as m, COUNT(*) FROM generations GROUP BY m ORDER BY COUNT(*) DESC")
	if err != nil { return nil, err }
	defer rows.Close()
	var out []model.ModelBreakdown
	for rows.Next() {
		var mb model.ModelBreakdown
		rows.Scan(&mb.Model, &mb.Count)
		out = append(out, mb)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil { out = []model.ModelBreakdown{} }
	return out, nil
}

// GetUserStats 返回指定用户的统计概览
func (s *MySQLStore) GetUserStats(userID int64) (*model.UserStats, error) {
	var st model.UserStats
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=?", userID).Scan(&st.TotalGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND DATE(created_at)=CURDATE()", userID).Scan(&st.TodayGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)", userID).Scan(&st.WeekGenerations)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND status='completed'", userID).Scan(&st.TotalSuccess)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND status='failed'", userID).Scan(&st.TotalFailed)
	return &st, nil
}

// GetUserTrends 返回指定用户近 n 天的每日生成趋势
func (s *MySQLStore) GetUserTrends(userID, days int) ([]model.TrendPoint, error) {
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	rows, err := s.db.Query("SELECT DATE(created_at) as d, COUNT(*) FROM generations WHERE user_id=? AND created_at >= ? GROUP BY d ORDER BY d", userID, startDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byDate := map[string]float64{}
	for rows.Next() {
		var date string
		var count float64
		if err := rows.Scan(&date, &count); err != nil {
			continue
		}
		if len(date) >= 10 {
			date = date[5:10]
		}
		byDate[date] = count
	}

	out := make([]model.TrendPoint, 0, days)
	now := time.Now()
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("01-02")
		v, ok := byDate[d]
		if !ok {
			v = 0
		}
		out = append(out, model.TrendPoint{Date: d, Value: v})
	}
	return out, nil
}

// GetUserSuccessRate 返回指定用户今日成功率
func (s *MySQLStore) GetUserSuccessRate(userID int64) float64 {
	var total, success int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND DATE(created_at)=CURDATE()", userID).Scan(&total)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND status='completed' AND DATE(created_at)=CURDATE()", userID).Scan(&success)
	if total == 0 {
		return 100
	}
	return float64(success) / float64(total) * 100
}
