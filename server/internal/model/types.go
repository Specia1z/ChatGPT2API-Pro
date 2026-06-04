package model

import "time"

type Account struct {
	ID                 int64      `json:"id" db:"id"`
	AccessToken        string     `json:"access_token" db:"access_token"`
	RefreshToken       string     `json:"refresh_token" db:"refresh_token"`
	IDToken            string     `json:"id_token" db:"id_token"`
	Email              string     `json:"email" db:"email"`
	UserID             string     `json:"user_id" db:"user_id"`
	PlanType           string     `json:"plan_type" db:"plan_type"`
	Status             string     `json:"status" db:"status"`
	Quota              int        `json:"quota" db:"quota"`
	ImageQuotaUnknown  bool       `json:"image_quota_unknown" db:"image_quota_unknown"`
	SourceType         string     `json:"source_type" db:"source_type"`
	Proxy              string     `json:"proxy" db:"proxy"`
	DefaultModelSlug   string     `json:"default_model_slug" db:"default_model_slug"`
	RestoreAt          string     `json:"restore_at" db:"restore_at"`
	SuccessCount       int        `json:"success" db:"success_count"`
	FailCount          int        `json:"fail" db:"fail_count"`
	InvalidCount       int        `json:"invalid_count" db:"invalid_count"`
	LastUsedAt         *time.Time `json:"last_used_at" db:"last_used_at"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at" db:"updated_at"`
	ActiveSlots        int        `json:"active_slots"` // 实时并发占用数（来自 Redis，非 DB 列）
}

type AccountStats struct {
	Total          int            `json:"total"`
	Active         int            `json:"active"`
	Limited        int            `json:"limited"`
	Abnormal       int            `json:"abnormal"`
	Disabled       int            `json:"disabled"`
	TotalQuota     int            `json:"total_quota"`
	UnlimitedCount int            `json:"unlimited_quota_count"`
	TotalSuccess   int            `json:"total_success"`
	TotalFail      int            `json:"total_fail"`
	ByType         map[string]int `json:"by_type"`
}

type Admin struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	AdminID int64  `json:"admin_id"`
}

type APIResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
}

/* ── 邮箱 ──────────────────────────────── */

type MailProviderConfig struct {
	Provider      string   `json:"provider"`
	ProviderRef   string   `json:"provider_ref,omitempty"`
	APIBase       string   `json:"api_base,omitempty"`
	AdminPassword string   `json:"admin_password,omitempty"`
	Domain        []string `json:"domain,omitempty"`
	Label         string   `json:"label,omitempty"`
}

type MailConfig struct {
	RequestTimeout float64              `json:"request_timeout"`
	WaitTimeout    float64              `json:"wait_timeout"`
	WaitInterval   float64              `json:"wait_interval"`
	UserAgent      string               `json:"user_agent"`
	Proxy          string               `json:"proxy"`
	Providers      []MailProviderConfig `json:"providers"`
}

type Mailbox struct {
	Provider    string `json:"provider"`
	ProviderRef string `json:"provider_ref"`
	Address     string `json:"address"`
	Token       string `json:"token,omitempty"`
}

type MailMessage struct {
	Provider    string `json:"provider"`
	Mailbox     string `json:"mailbox"`
	MessageID   string `json:"message_id"`
	Subject     string `json:"subject"`
	Sender      string `json:"sender"`
	TextContent string `json:"text_content"`
	HTMLContent string `json:"html_content"`
	ReceivedAt  string `json:"received_at,omitempty"`
}

/* ── 注册机 ────────────────────────────── */

type RegisterConfig struct {
	Mail            []MailProviderConfig `json:"mail_providers"`
	Proxy           string              `json:"proxy"`
	Total           int                 `json:"total"`
	Threads         int                 `json:"threads"`
	Mode            string              `json:"mode"`
	TargetQuota     int                 `json:"target_quota"`
	TargetAvailable int                 `json:"target_available"`
	CheckInterval   int                 `json:"check_interval"`
	Enabled         bool                `json:"enabled"`
	WaitTimeout     float64             `json:"wait_timeout"`
}

type RegisterStats struct {
	Success          int     `json:"success"`
	Fail             int     `json:"fail"`
	Done             int     `json:"done"`
	Running          int     `json:"running"`
	ElapsedSeconds   float64 `json:"elapsed_seconds"`
	SuccessRate      float64 `json:"success_rate"`
	CurrentQuota     int     `json:"current_quota"`
	CurrentAvailable int     `json:"current_available"`
}

type RegisterLog struct {
	Time  string `json:"time"`
	Text  string `json:"text"`
	Level string `json:"level"`
}


type User struct {
	ID                   int64      `json:"id"`
	Email                string     `json:"email"`
	Name                 string     `json:"name"`
	Points               int        `json:"points"`
	Status               bool       `json:"status"`
	BanReason            string     `json:"ban_reason,omitempty"`
	PasswordHash         string     `json:"-"`
	PlanID               int        `json:"plan_id"`
	SubscriptionExpiresAt *time.Time `json:"subscription_expires_at"`
	CooldownUntil        *time.Time `json:"cooldown_until"`
	PlanName             string     `json:"plan_name,omitempty"`
	PlanConcurrency      int        `json:"plan_concurrency,omitempty"`
	TokenCapacity        int        `json:"token_capacity"`
	TokenRefillPerHour   int        `json:"token_refill_per_hour"`
	CreatedAt            string     `json:"created_at"`
}

type UserAPIKey struct {
	ID         int64  `json:"id"`
	UserID     int64  `json:"user_id"`
	APIKey     string `json:"api_key"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	LastUsedAt string `json:"last_used_at,omitempty"`
	CreatedAt  string `json:"created_at"`
}

type UserRegisterRequest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	Name             string `json:"name,omitempty"`
	CfTurnstileToken string `json:"cf_turnstile_token,omitempty"`
}

type Plan struct {
	ID                 int     `json:"id"`
	Name               string  `json:"name"`
	PriceMonthly       float64 `json:"price_monthly"`
	PriceYearly        float64 `json:"price_yearly"`
	DurationDays       int     `json:"duration_days"`
	DurationDaysYearly int     `json:"duration_days_yearly"`
	Concurrency          int    `json:"concurrency"`
	TokenCapacity        int    `json:"token_capacity"`
	TokenRefillPerHour   int    `json:"token_refill_per_hour"`
	Features          string  `json:"features"`
	SortOrder         int     `json:"sort_order"`
	Highlighted  bool   `json:"highlighted"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    string `json:"created_at"`
}

type Generation struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Prompt    string `json:"prompt"`
	Model     string `json:"model"`
	Size      string `json:"size,omitempty"`
	ImageB64  string `json:"image_b64,omitempty"`
		ImageURL  string `json:"image_url,omitempty"`
	Status    string `json:"status"`
	ErrorMsg  string `json:"error_msg,omitempty"`
	UserEmail string `json:"user_email,omitempty"`
	UserName  string `json:"user_name,omitempty"`
	Shared    bool   `json:"shared"`
	CreatedAt string `json:"created_at"`
}

type UserLoginRequest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	CfTurnstileToken string `json:"cf_turnstile_token,omitempty"`
}

type Settings struct {
	SiteTitle           string `json:"site_title"`
	SiteSubtitle        string `json:"site_subtitle"`
	SiteDescription     string `json:"site_description"`
	CFTurnstileEnabled  bool   `json:"cf_turnstile_enabled"`
	CFTurnstileSiteKey  string `json:"cf_turnstile_site_key"`
	CFTurnstileSecretKey string `json:"cf_turnstile_secret_key"`
	DefaultPlanID       int    `json:"default_plan_id"`
	BannedWords         string `json:"banned_words"`
	CheckinEnabled      bool   `json:"checkin_enabled"`
	CheckinBase         int    `json:"checkin_base"`
	CheckinStreakBonus  int    `json:"checkin_streak_bonus"`
	AlipayEnabled       bool   `json:"alipay_enabled"`
	AlipayAppID         string `json:"alipay_app_id"`
	AlipayAppPrivateKey string `json:"alipay_app_private_key"`
	AlipayPublicKey     string `json:"alipay_alipay_public_key"`
	AlipayNotifyURL     string `json:"alipay_notify_url"`
	SiteLogoType        string `json:"site_logo_type"`              // "text" | "url" | "upload"
	SiteLogoText        string `json:"site_logo_text"`              // 文本 Logo
	SiteLogoURL         string `json:"site_logo_url,omitempty"`     // 图片 URL 或 data URI
	StorageCleanupDays  int    `json:"storage_cleanup_days"`
	PointsExchangeRate  int    `json:"points_exchange_rate"`
	PointsExchangeBonus int    `json:"points_exchange_bonus"`
	StylePresets string `json:"style_presets"` // JSON 数组：风格预设
	EmailConfig string `json:"email_config"` // JSON：SMTP+域名规则
}

// EmailConfig 邮箱验证配置
type EmailConfig struct {
	SMTPEnabled    bool              `json:"smtp_enabled"`
	SMTPHost       string            `json:"smtp_host"`
	SMTPPort       int               `json:"smtp_port"`
	SMTPUser       string            `json:"smtp_user"`
	SMTPPass       string            `json:"smtp_pass"`
	SMTPFrom       string            `json:"smtp_from"`
	NormalizeGmail bool              `json:"normalize_gmail"` // 标准化 Gmail 点号/+ 别名
	RegLimitPerIP  int               `json:"reg_limit_per_ip"` // 每 IP 每日注册上限（0=不限制）
	DomainBlacklist []string         `json:"domain_blacklist"`
	DomainWhitelist []string         `json:"domain_whitelist"`
	DomainAliases  map[string]string `json:"domain_aliases"`
}

// StylePreset 单个风格预设
type StylePreset struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Icon    string `json:"icon"`
	Desc    string `json:"desc"`
	Hint    string `json:"hint"`
	Enabled bool   `json:"enabled"`
	Order   int    `json:"order"`
}

/* ── 支付 ────────────────────────────── */

type Order struct {
	ID            int64   `json:"id"`
	OrderNo       string  `json:"order_no"`
	UserID        int64   `json:"user_id"`
	UserEmail     string  `json:"user_email,omitempty"`
	UserName      string  `json:"user_name,omitempty"`
	PlanID        int     `json:"plan_id"`
	PlanName     string  `json:"plan_name"`
	DurationDays int     `json:"duration_days"`
	Amount       float64 `json:"amount"`
	Subject      string  `json:"subject"`
	Status       string  `json:"status"` // pending, paid, expired, cancelled
	AlipayTradeNo string `json:"alipay_trade_no,omitempty"`
	CouponCode    string `json:"coupon_code,omitempty"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type CreateOrderRequest struct {
	PlanID     int    `json:"plan_id"`
	Billing    string `json:"billing"`
	CouponCode string `json:"coupon_code,omitempty"`
	CouponID   int64  `json:"coupon_id,omitempty"`
}

type UpgradeOrderRequest struct {
	PlanID     int    `json:"plan_id"`
	Billing    string `json:"billing"`
	CouponCode string `json:"coupon_code,omitempty"`
}

/* ── 优惠码 ────────────────────────────── */

type CouponCode struct {
	ID            int64   `json:"id"`
	Code          string  `json:"code"`
	DiscountType  string  `json:"discount_type"`   // "percent" | "fixed"
	DiscountValue float64 `json:"discount_value"`
	MinAmount     float64 `json:"min_amount"`
	MaxUses       int     `json:"max_uses"`
	UseCount      int     `json:"use_count"`
	Status        bool    `json:"status"`
	ExpiresAt     *string `json:"expires_at,omitempty"`
	CreatedBy     int64   `json:"created_by"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type ValidateCouponRequest struct {
	Code    string `json:"code"`
	PlanID  int    `json:"plan_id"`
	Billing string `json:"billing"`
}

type CouponDiscount struct {
	Valid         bool    `json:"valid"`
	Code          string  `json:"code"`
	DiscountType  string  `json:"discount_type"`
	DiscountValue float64 `json:"discount_value"`
	OriginalPrice float64 `json:"original_price"`
	Discount      float64 `json:"discount"`
	FinalPrice    float64 `json:"final_price"`
	Message       string  `json:"message,omitempty"`
}

type AlipayConfig struct {
	Enabled       bool   `json:"alipay_enabled"`
	AppID         string `json:"alipay_app_id"`
	AppPrivateKey string `json:"alipay_app_private_key"`
	AlipayPublicKey string `json:"alipay_alipay_public_key"`
}

type MonitorConfig struct {
	Enabled            bool   `json:"enabled"`
	IntervalMinutes    int    `json:"interval_minutes"`
	AutoRemoveAbnormal bool   `json:"auto_remove_abnormal"`
	AutoRemoveDisabled bool   `json:"auto_remove_disabled"`
	AutoRefill         bool   `json:"auto_refill"`
	RefillMode         string `json:"refill_mode"`   // total=按号池总数 | available=按可用数
	RefillTarget       int    `json:"refill_target"` // 补号目标数量
}

/* ── 兑换码 ────────────────────────────── */

type RedeemCode struct {
	ID              int64     `json:"id"`
	Code            string    `json:"code"`
	Type            string    `json:"type"`           // "plan" | "points"
	PlanID          int       `json:"plan_id,omitempty"`
	PlanDurationDays int      `json:"plan_duration_days,omitempty"`
	Points          int       `json:"points,omitempty"`
	MaxUses         int       `json:"max_uses"`
	UseCount        int       `json:"use_count"`
	Status          bool      `json:"status"`          // true=active, false=disabled
	ExpiresAt       *string   `json:"expires_at,omitempty"`
	CreatedBy       int64     `json:"created_by"`
	CreatedAt       string    `json:"created_at"`
	UpdatedAt       string    `json:"updated_at"`
	// Joined field
	PlanName        string    `json:"plan_name,omitempty"`
}

type RedeemLog struct {
	ID           int64  `json:"id"`
	RedeemCodeID int64  `json:"redeem_code_id"`
	UserID       int64  `json:"user_id"`
	Code         string `json:"code"`
	Type         string `json:"type"`
	Value        string `json:"value"`
	UserEmail    string `json:"user_email,omitempty"`
	CreatedAt    string `json:"created_at"`
}

type GenerateRedeemRequest struct {
	Count           int    `json:"count"`
	Type            string `json:"type"`
	PlanID          int    `json:"plan_id,omitempty"`
	PlanDurationDays int   `json:"plan_duration_days,omitempty"`
	Points          int    `json:"points,omitempty"`
	MaxUses         int    `json:"max_uses"`
	ExpiresInHours  int    `json:"expires_in_hours,omitempty"`
}

type RedeemRequest struct {
	Code string `json:"code"`
}

/* ── 统计看板 ────────────────────────────── */

type AdminStats struct {
	TotalUsers       int     `json:"total_users"`
	TodayUsers       int     `json:"today_users"`
	ActiveUsers      int     `json:"active_users"`
	TotalGenerations int     `json:"total_generations"`
	TodayGenerations int     `json:"today_generations"`
	TodaySuccess     int     `json:"today_success"`
	TodayFailed      int     `json:"today_failed"`
	TotalOrders      int     `json:"total_orders"`
	PaidOrders       int     `json:"paid_orders"`
	TodayRevenue     float64 `json:"today_revenue"`
	TotalRevenue     float64 `json:"total_revenue"`
	TotalAccounts    int     `json:"total_accounts"`
	NormalAccounts   int     `json:"normal_accounts"`
	LimitedAccounts  int     `json:"limited_accounts"`
	AbnormalAccounts int     `json:"abnormal_accounts"`
	DisabledAccounts int     `json:"disabled_accounts"`
}

type TrendPoint struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

type TrendsData struct {
	Generations []TrendPoint `json:"generations"`
	Success     []TrendPoint `json:"success"`
	Failed      []TrendPoint `json:"failed"`
	Revenue     []TrendPoint `json:"revenue"`
	Users       []TrendPoint `json:"users"`
}

type ModelBreakdown struct {
	Model string `json:"model"`
	Count int    `json:"count"`
}

/* ── 用户统计 ────────────────────────── */

type UserStats struct {
	TotalGenerations int `json:"total_generations"`
	TodayGenerations int `json:"today_generations"`
	WeekGenerations  int `json:"week_generations"`
	TotalSuccess     int `json:"total_success"`
	TotalFailed      int `json:"total_failed"`
}


/* ── 用户优惠券 ────────────────────────── */

type UserCoupon struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	CouponID  int64  `json:"coupon_id"`
	Code      string `json:"code"`
	DiscountType  string `json:"discount_type"`
	DiscountValue float64 `json:"discount_value"`
	Status    string `json:"status"` // active, used, expired
	ClaimedAt string `json:"claimed_at"`
	UsedAt    string `json:"used_at,omitempty"`
}

type ClaimCouponRequest struct {
	Code string `json:"code"`
}

/* ── 存储配置 ──────────────────────────── */

type StorageConfig struct {
	Type        string `json:"type"` // "database" | "local" | "s3"
	LocalPath   string `json:"local_path,omitempty"`
	LocalURL    string `json:"local_url,omitempty"`
	S3Endpoint  string `json:"s3_endpoint,omitempty"`
	S3Region    string `json:"s3_region,omitempty"`
	S3Bucket    string `json:"s3_bucket,omitempty"`
	S3AccessKey string `json:"s3_access_key,omitempty"`
	S3SecretKey string `json:"s3_secret_key,omitempty"`
	S3UseSSL    bool   `json:"s3_use_ssl,omitempty"`
}
