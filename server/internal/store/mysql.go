package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"chatgpt2api-pro/internal/model"
)

type MySQLStore struct {
	db *sql.DB

	// 配置缓存：settings / storage_config 改动频率极低却被热路径反复读，
	// 加进程内缓存（TTL 由 settings.config_cache_ttl_seconds 控制，0=不缓存）。
	// 写操作(SaveSettings/SaveStorageConfig)主动失效，故即便 TTL 较大也不会读到旧值。
	cacheMu         sync.RWMutex
	settingsCache   *model.Settings
	settingsCacheAt time.Time
	storageCache    *model.StorageConfig
	storageCacheAt  time.Time
	cacheTTL        atomic.Int64 // 纳秒；0=禁用缓存。由 SetConfigCacheTTL 设置

	// API Key last_used 写节流：高频 API 调用无需秒级精确 last_used，
	// 用内存记录每个 key 上次写库时间，间隔内跳过 UPDATE，削减随机写。
	lastUsedMu       sync.Mutex
	lastUsedAt       map[string]time.Time
	lastUsedThrottle atomic.Int64 // 纳秒；0=每次都写。由 SetAPIKeyLastUsedThrottle 设置
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

	s := &MySQLStore{db: db, lastUsedAt: make(map[string]time.Time)}
	s.autoMigrate()
	// 启动时按持久化配置应用连接池上限与缓存/节流 TTL
	if cfg, _ := s.getSettingsRaw(); cfg != nil {
		s.SetConfigCacheTTL(cfg.ConfigCacheTTLSeconds)
		s.SetAPIKeyLastUsedThrottle(cfg.APIKeyLastUsedThrottleSeconds)
		s.ApplyDBPoolConfig(cfg.DBMaxOpenConns)
	}
	return s, nil
}

// ApplyDBPoolConfig 运行时调整 MySQL 最大连接数。n<=0 用内置默认 25；
// 上限 200 防 4G 机器调过头爆内存。空闲连接数取 min(n/5+1, 当前)。
func (s *MySQLStore) ApplyDBPoolConfig(n int) {
	if n <= 0 {
		n = 25
	}
	if n > 200 {
		n = 200
	}
	s.db.SetMaxOpenConns(n)
	idle := n/5 + 1
	if idle > n {
		idle = n
	}
	s.db.SetMaxIdleConns(idle)
}

// SetAPIKeyLastUsedThrottle 设置 last_used 写库最小间隔（秒）。0=每次都写。
func (s *MySQLStore) SetAPIKeyLastUsedThrottle(seconds int) {
	if seconds < 0 {
		seconds = 0
	}
	s.lastUsedThrottle.Store(int64(seconds) * int64(time.Second))
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
		rate_limit_per_min INT NOT NULL DEFAULT 0,
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
	s.db.Exec("ALTER TABLE settings ADD COLUMN free_token_capacity INT NOT NULL DEFAULT 0 AFTER default_plan_id")
	s.db.Exec("ALTER TABLE settings ADD COLUMN free_token_refill_per_hour INT NOT NULL DEFAULT 0 AFTER free_token_capacity")
	s.db.Exec("ALTER TABLE settings ADD COLUMN free_concurrency INT NOT NULL DEFAULT 0 AFTER free_token_refill_per_hour")
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
	// 套餐 API 限流速率列（每分钟请求上限，0=用默认 600/min）。守卫 ALTER 避免已有库重启噪音。
	if !s.columnExists(dbName, "plans", "rate_limit_per_min") {
		s.db.Exec("ALTER TABLE plans ADD COLUMN rate_limit_per_min INT NOT NULL DEFAULT 0 AFTER token_refill_per_hour")
	}
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
	s.db.Exec("ALTER TABLE settings ADD COLUMN burst_token_cap INT NOT NULL DEFAULT 0 AFTER points_exchange_bonus")
	s.db.Exec("ALTER TABLE settings ADD COLUMN points_exchange_bonus_threshold INT NOT NULL DEFAULT 0 AFTER burst_token_cap")
	s.db.Exec("ALTER TABLE settings ADD COLUMN tokens_per_image INT NOT NULL DEFAULT 0 AFTER points_exchange_bonus_threshold")
	s.db.Exec("ALTER TABLE settings ADD COLUMN default_rate_limit_per_min INT NOT NULL DEFAULT 0 AFTER burst_token_cap")
	s.db.Exec("ALTER TABLE settings ADD COLUMN config_cache_ttl_seconds INT NOT NULL DEFAULT 0 AFTER default_rate_limit_per_min")
	s.db.Exec("ALTER TABLE settings ADD COLUMN apikey_lastused_throttle_seconds INT NOT NULL DEFAULT 0 AFTER config_cache_ttl_seconds")
	s.db.Exec("ALTER TABLE settings ADD COLUMN public_cache_ttl_seconds INT NOT NULL DEFAULT 0 AFTER apikey_lastused_throttle_seconds")
	s.db.Exec("ALTER TABLE settings ADD COLUMN db_max_open_conns INT NOT NULL DEFAULT 0 AFTER public_cache_ttl_seconds")
	s.db.Exec("ALTER TABLE settings ADD COLUMN order_timeout_minutes INT NOT NULL DEFAULT 0 AFTER db_max_open_conns")
	if !s.columnExists(dbName, "settings", "style_presets") {
		s.db.Exec("ALTER TABLE settings ADD COLUMN style_presets TEXT AFTER points_exchange_bonus")
	}
	// 首次创建或历史为空时 seed 内置风格预设；非空（管理员已自定义，包括清空为 []）则保留。
	s.db.Exec("UPDATE settings SET style_presets=? WHERE id=1 AND (style_presets IS NULL OR style_presets='')", DefaultStylePresetsJSON)
	if !s.columnExists(dbName, "settings", "email_config") {
		s.db.Exec("ALTER TABLE settings ADD COLUMN email_config TEXT AFTER style_presets")
	}
	// 邀请裂变配置（JSON：开关 + 注册/首充双方积分奖励）
	if !s.columnExists(dbName, "settings", "invite_config") {
		s.db.Exec("ALTER TABLE settings ADD COLUMN invite_config TEXT AFTER email_config")
	}
	s.db.Exec(`CREATE TABLE IF NOT EXISTS announcements (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		title VARCHAR(128) NOT NULL DEFAULT '',
		content TEXT,
		type VARCHAR(16) NOT NULL DEFAULT 'info',
		link VARCHAR(512) DEFAULT '',
		priority INT NOT NULL DEFAULT 0,
		enabled TINYINT(1) NOT NULL DEFAULT 1,
		dismissible TINYINT(1) NOT NULL DEFAULT 1,
		start_at DATETIME NULL,
		end_at DATETIME NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	// 公告是否允许用户关闭（0=强制常驻，如重要维护通知）
	if !s.columnExists(dbName, "announcements", "dismissible") {
		s.db.Exec("ALTER TABLE announcements ADD COLUMN dismissible TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled")
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
	// 管理员角色：0=普通 1=admin。superadmin 不入库，由 .env SUPERADMIN_EMAIL 实时判定。
	if !s.columnExists(dbName, "users", "role") {
		s.db.Exec("ALTER TABLE users ADD COLUMN role TINYINT NOT NULL DEFAULT 0 AFTER status")
	}
	// 邀请裂变：专属邀请码 + 邀请人绑定。invite_code 用 NULL 默认值——
	// MySQL 唯一索引允许多个 NULL，避免存量用户空串撞唯一约束（首次访问邀请页时懒生成）。
	if !s.columnExists(dbName, "users", "invite_code") {
		s.db.Exec("ALTER TABLE users ADD COLUMN invite_code VARCHAR(12) DEFAULT NULL")
		s.db.Exec("ALTER TABLE users ADD COLUMN invited_by BIGINT NOT NULL DEFAULT 0")
		s.db.Exec("CREATE UNIQUE INDEX uniq_invite_code ON users (invite_code)")
		s.db.Exec("CREATE INDEX idx_invited_by ON users (invited_by)")
	}
	// 邀请记录：每次成功邀请一行（含注册奖励与首充奖励，rewarded_recharge 标记首充奖励是否已发）
	s.db.Exec(`CREATE TABLE IF NOT EXISTS invite_logs (
		id BIGINT AUTO_INCREMENT PRIMARY KEY,
		inviter_id BIGINT NOT NULL,
		invitee_id BIGINT NOT NULL,
		reward_register INT NOT NULL DEFAULT 0,
		reward_recharge INT NOT NULL DEFAULT 0,
		rewarded_recharge TINYINT(1) NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY uniq_invitee (invitee_id),
		INDEX idx_inviter (inviter_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

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
		share_status VARCHAR(16) NOT NULL DEFAULT 'none',
		share_reject_reason VARCHAR(255) NOT NULL DEFAULT '',
		status VARCHAR(16) DEFAULT 'pending',
		error_msg TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_user_id (user_id),
		INDEX idx_created_at (created_at),
		INDEX idx_share_status (share_status)
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

	// 分享审核状态（先审后发）：none=未分享 / pending=待审 / approved=已通过 / rejected=已拒绝。
	// 存量 shared=1 老数据视为 approved，避免下架既有广场内容。
	genDB := s.currentDBName()
	if !s.columnExists(genDB, "generations", "share_status") {
		s.db.Exec("ALTER TABLE generations ADD COLUMN share_status VARCHAR(16) NOT NULL DEFAULT 'none'")
		s.db.Exec("ALTER TABLE generations ADD COLUMN share_reject_reason VARCHAR(255) NOT NULL DEFAULT ''")
		s.db.Exec("CREATE INDEX idx_share_status ON generations (share_status)")
		s.db.Exec("UPDATE generations SET share_status='approved' WHERE shared=1")
	}

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
	// 防同一用户重复兑换同一码：唯一约束兜底（应用层 CompleteRedeem 已在事务内查重）。
	// 加约束前先清理存量重复记录，避免已有重复数据导致建索引失败。
	if !s.indexExists(s.currentDBName(), "redeem_logs", "uniq_code_user") {
		s.db.Exec(`DELETE r1 FROM redeem_logs r1
			INNER JOIN redeem_logs r2
			WHERE r1.redeem_code_id = r2.redeem_code_id AND r1.user_id = r2.user_id AND r1.id > r2.id`)
		s.db.Exec("CREATE UNIQUE INDEX uniq_code_user ON redeem_logs (redeem_code_id, user_id)")
	}
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
