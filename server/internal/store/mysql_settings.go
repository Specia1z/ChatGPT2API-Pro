package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Storage Config ---

func (s *MySQLStore) GetStorageConfig() (*model.StorageConfig, error) {
	// 命中缓存则返回副本（避免调用方改写污染缓存）
	if ttl := s.cacheTTL.Load(); ttl > 0 {
		s.cacheMu.RLock()
		if s.storageCache != nil && time.Since(s.storageCacheAt).Nanoseconds() < ttl {
			cp := *s.storageCache
			s.cacheMu.RUnlock()
			return &cp, nil
		}
		s.cacheMu.RUnlock()
	}
	cfg, err := s.getStorageConfigRaw()
	if err == nil && s.cacheTTL.Load() > 0 {
		s.cacheMu.Lock()
		c := *cfg
		s.storageCache = &c
		s.storageCacheAt = time.Now()
		s.cacheMu.Unlock()
	}
	return cfg, err
}

func (s *MySQLStore) getStorageConfigRaw() (*model.StorageConfig, error) {
	var cfgJSON sql.NullString
	err := s.db.QueryRow("SELECT COALESCE(storage_config,'') FROM settings WHERE id=1").Scan(&cfgJSON)
	if err != nil || !cfgJSON.Valid || cfgJSON.String == "" {
		return &model.StorageConfig{Type: "database"}, nil
	}
	var cfg model.StorageConfig
	json.Unmarshal([]byte(cfgJSON.String), &cfg)
	if cfg.Type == "" {
		cfg.Type = "database"
	}
	return &cfg, nil
}

func (s *MySQLStore) SaveStorageConfig(cfg *model.StorageConfig) error {
	// 保护敏感字段：S3 SecretKey 为空时保留 DB 中现有值
	// （公开/管理接口 GET 时会抹掉密钥，回填保存不应清空它）
	if cfg.S3SecretKey == "" {
		if existing, _ := s.getStorageConfigRaw(); existing != nil && existing.S3SecretKey != "" {
			cfg.S3SecretKey = existing.S3SecretKey
		}
	}
	j, _ := json.Marshal(cfg)
	_, err := s.db.Exec("UPDATE settings SET storage_config=? WHERE id=1", string(j))
	s.InvalidateConfigCache()
	return err
}

// SetConfigCacheTTL 设置 settings/storage 配置的进程内缓存 TTL（秒）。
// n<=0 表示禁用缓存。设置时一并清空旧缓存，立即生效。
func (s *MySQLStore) SetConfigCacheTTL(seconds int) {
	if seconds < 0 {
		seconds = 0
	}
	s.cacheTTL.Store(int64(seconds) * int64(time.Second))
	s.InvalidateConfigCache()
}

// InvalidateConfigCache 清空配置缓存（写配置后调用，保证下次读最新值）。
func (s *MySQLStore) InvalidateConfigCache() {
	s.cacheMu.Lock()
	s.settingsCache = nil
	s.storageCache = nil
	s.cacheMu.Unlock()
}

// --- Settings ---

func (s *MySQLStore) GetSettings() (*model.Settings, error) {
	if ttl := s.cacheTTL.Load(); ttl > 0 {
		s.cacheMu.RLock()
		if s.settingsCache != nil && time.Since(s.settingsCacheAt).Nanoseconds() < ttl {
			cp := *s.settingsCache // 返回副本：handler 会抹除密钥字段，不能改到缓存本体
			s.cacheMu.RUnlock()
			return &cp, nil
		}
		s.cacheMu.RUnlock()
	}
	cfg, err := s.getSettingsRaw()
	if err == nil && s.cacheTTL.Load() > 0 {
		s.cacheMu.Lock()
		c := *cfg
		s.settingsCache = &c
		s.settingsCacheAt = time.Now()
		s.cacheMu.Unlock()
	}
	return cfg, err
}

func (s *MySQLStore) getSettingsRaw() (*model.Settings, error) {
	cfg := &model.Settings{}
	err := s.db.QueryRow(`SELECT site_title, site_subtitle, COALESCE(site_description,''), cf_turnstile_enabled, cf_turnstile_site_key, cf_turnstile_secret_key, COALESCE(default_plan_id,0), COALESCE(free_token_capacity,0), COALESCE(free_token_refill_per_hour,0), COALESCE(free_concurrency,0), COALESCE(banned_words,''), COALESCE(checkin_enabled,1), COALESCE(checkin_base,10), COALESCE(checkin_streak_bonus,5), COALESCE(alipay_enabled,0), COALESCE(alipay_app_id,''), COALESCE(alipay_app_private_key,''), COALESCE(alipay_alipay_public_key,''), COALESCE(alipay_notify_url,''), COALESCE(site_logo_type,'text'), COALESCE(site_logo_text,'C2'), COALESCE(site_logo_url,''), COALESCE(storage_cleanup_days,0), COALESCE(points_exchange_rate,10), COALESCE(points_exchange_bonus,0), COALESCE(burst_token_cap,0), COALESCE(points_exchange_bonus_threshold,0), COALESCE(tokens_per_image,0), COALESCE(default_rate_limit_per_min,0), COALESCE(config_cache_ttl_seconds,0), COALESCE(apikey_lastused_throttle_seconds,0), COALESCE(public_cache_ttl_seconds,0), COALESCE(db_max_open_conns,0), COALESCE(order_timeout_minutes,0), COALESCE(svg_model,''), COALESCE(style_presets,''), COALESCE(email_config,''), COALESCE(invite_config,''), COALESCE(shop_config,'') FROM settings WHERE id=1`).
		Scan(&cfg.SiteTitle, &cfg.SiteSubtitle, &cfg.SiteDescription, &cfg.CFTurnstileEnabled, &cfg.CFTurnstileSiteKey, &cfg.CFTurnstileSecretKey, &cfg.DefaultPlanID, &cfg.FreeTokenCapacity, &cfg.FreeTokenRefillPerHour, &cfg.FreeConcurrency, &cfg.BannedWords, &cfg.CheckinEnabled, &cfg.CheckinBase, &cfg.CheckinStreakBonus, &cfg.AlipayEnabled, &cfg.AlipayAppID, &cfg.AlipayAppPrivateKey, &cfg.AlipayPublicKey, &cfg.AlipayNotifyURL, &cfg.SiteLogoType, &cfg.SiteLogoText, &cfg.SiteLogoURL, &cfg.StorageCleanupDays, &cfg.PointsExchangeRate, &cfg.PointsExchangeBonus, &cfg.BurstTokenCap, &cfg.PointsExchangeBonusThreshold, &cfg.TokensPerImage, &cfg.DefaultRateLimitPerMin, &cfg.ConfigCacheTTLSeconds, &cfg.APIKeyLastUsedThrottleSeconds, &cfg.PublicCacheTTLSeconds, &cfg.DBMaxOpenConns, &cfg.OrderTimeoutMinutes, &cfg.SVGModel, &cfg.StylePresets, &cfg.EmailConfig, &cfg.InviteConfig, &cfg.ShopConfig)
	if err != nil {
		return cfg, nil
	}
	return cfg, nil
}

func (s *MySQLStore) SaveSettings(cfg *model.Settings) error {
	// 保护敏感字段：如果传入为空则保留 DB 中现有值（防止 GET 清空后被覆盖）。
	// 用 raw 读，避免缓存命中拿到已被 handler 抹除密钥的副本。
	existing, _ := s.getSettingsRaw()
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
		cfg.EmailConfig = mergeEmailConfigSecrets(cfg.EmailConfig, existing.EmailConfig)
	}
	_, err := s.db.Exec(`UPDATE settings SET site_title=?, site_subtitle=?, site_description=?, cf_turnstile_enabled=?, cf_turnstile_site_key=?, cf_turnstile_secret_key=?, default_plan_id=?, free_token_capacity=?, free_token_refill_per_hour=?, free_concurrency=?, banned_words=?, checkin_enabled=?, checkin_base=?, checkin_streak_bonus=?, alipay_enabled=?, alipay_app_id=?, alipay_app_private_key=?, alipay_alipay_public_key=?, alipay_notify_url=?, site_logo_type=?, site_logo_text=?, site_logo_url=?, storage_cleanup_days=?, points_exchange_rate=?, points_exchange_bonus=?, burst_token_cap=?, points_exchange_bonus_threshold=?, tokens_per_image=?, default_rate_limit_per_min=?, config_cache_ttl_seconds=?, apikey_lastused_throttle_seconds=?, public_cache_ttl_seconds=?, db_max_open_conns=?, order_timeout_minutes=?, svg_model=?, style_presets=?, email_config=?, invite_config=?, shop_config=? WHERE id=1`,
		cfg.SiteTitle, cfg.SiteSubtitle, cfg.SiteDescription, cfg.CFTurnstileEnabled, cfg.CFTurnstileSiteKey, cfg.CFTurnstileSecretKey, cfg.DefaultPlanID, cfg.FreeTokenCapacity, cfg.FreeTokenRefillPerHour, cfg.FreeConcurrency, cfg.BannedWords, cfg.CheckinEnabled, cfg.CheckinBase, cfg.CheckinStreakBonus, cfg.AlipayEnabled, cfg.AlipayAppID, cfg.AlipayAppPrivateKey, cfg.AlipayPublicKey, cfg.AlipayNotifyURL, cfg.SiteLogoType, cfg.SiteLogoText, cfg.SiteLogoURL, cfg.StorageCleanupDays, cfg.PointsExchangeRate, cfg.PointsExchangeBonus, cfg.BurstTokenCap, cfg.PointsExchangeBonusThreshold, cfg.TokensPerImage, cfg.DefaultRateLimitPerMin, cfg.ConfigCacheTTLSeconds, cfg.APIKeyLastUsedThrottleSeconds, cfg.PublicCacheTTLSeconds, cfg.DBMaxOpenConns, cfg.OrderTimeoutMinutes, cfg.SVGModel, cfg.StylePresets, cfg.EmailConfig, cfg.InviteConfig, cfg.ShopConfig)
	// 写后失效配置缓存，并按新值更新缓存 TTL（即时生效）
	s.SetConfigCacheTTL(cfg.ConfigCacheTTLSeconds)
	return err
}

// mergeEmailConfigSecrets 在保存 email_config 时保护 SMTP 密码：
// 若新配置的 smtp_pass 为空而旧配置存在密码，则保留旧密码。
// 这样公开接口抹掉密码后，管理端回填保存不会把密码清空。
func mergeEmailConfigSecrets(incoming, existing string) string {
	if existing == "" {
		return incoming
	}
	var oldEC model.EmailConfig
	if json.Unmarshal([]byte(existing), &oldEC) != nil || oldEC.SMTPPass == "" {
		return incoming
	}
	if incoming == "" {
		return existing // 整段缺失时保留旧配置，避免丢失密码
	}
	var newEC model.EmailConfig
	if json.Unmarshal([]byte(incoming), &newEC) != nil {
		return incoming
	}
	if newEC.SMTPPass == "" {
		newEC.SMTPPass = oldEC.SMTPPass
		if b, err := json.Marshal(newEC); err == nil {
			return string(b)
		}
	}
	return incoming
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
	if err != nil {
		return 20, 5
	}
	return
}

func (s *MySQLStore) SaveSchedulerConfig(maxGlobal, maxPerUser int) error {
	_, err := s.db.Exec("UPDATE scheduler_config SET max_global=?, max_per_user=? WHERE id=1", maxGlobal, maxPerUser)
	return err
}
