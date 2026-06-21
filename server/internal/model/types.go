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
	Role                 int        `json:"role"`                    // 0=普通用户 1=管理员（superadmin 由 .env 邮箱实时判定，不入库）
	IsSuperAdmin         bool       `json:"is_super_admin"`          // 计算字段：email == SUPERADMIN_EMAIL，不存库
	BanReason            string     `json:"ban_reason,omitempty"`
	PasswordHash         string     `json:"-"`
	PlanID               int        `json:"plan_id"`
	SubscriptionExpiresAt *time.Time `json:"subscription_expires_at"`
	CooldownUntil        *time.Time `json:"cooldown_until"`
	PlanName             string     `json:"plan_name,omitempty"`
	PlanConcurrency      int        `json:"plan_concurrency,omitempty"`
	TokenCapacity        int        `json:"token_capacity"`
	TokenRefillPerHour   int        `json:"token_refill_per_hour"`
	RateLimitPerMin      int        `json:"rate_limit_per_min,omitempty"`
	APIKeyID             int64      `json:"-"` // 本次认证命中的 API Key 行 id（仅请求内用，不返回前端）
	Avatar               string     `json:"avatar,omitempty"`        // 头像 URL（Linux Do OAuth 登录自动获取）
	LinuxDoID            int64      `json:"-"` // Linux Do OAuth 用户 id（仅内部用，不外泄）
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

// UserWebhook 每用户一个回调配置：API Key 异步生图完成/失败时，后端主动 POST 通知此 URL。
// Secret 用于对回调体做 HMAC-SHA256 签名，开发者据此验证来源真伪（GET 时抹除，只回显是否已设置）。
// Last* 字段记录最近一次投递结果，便于用户在前端自查回调是否正常。
type UserWebhook struct {
	UserID        int64  `json:"user_id"`
	URL           string `json:"url"`
	Secret        string `json:"secret,omitempty"`
	Enabled       bool   `json:"enabled"`
	HasSecret     bool   `json:"has_secret"`               // 计算字段：是否已设置 secret（GET 时代替明文）
	LastStatus    int    `json:"last_status,omitempty"`    // 最近一次投递的 HTTP 状态码（0=未投递/网络错误）
	LastError     string `json:"last_error,omitempty"`     // 最近一次投递的错误信息（空=成功）
	LastDeliverAt string `json:"last_deliver_at,omitempty"`// 最近一次投递时间
	CreatedAt     string `json:"created_at,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}

type UserRegisterRequest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	Name             string `json:"name,omitempty"`
	Code             string `json:"code,omitempty"`
	InviteCode       string `json:"invite_code,omitempty"`
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
	RateLimitPerMin      int    `json:"rate_limit_per_min"` // API 每分钟请求上限；0=用默认 600/min
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
	GenType   string `json:"gen_type,omitempty"` // image（默认）| svg
	ImageB64  string `json:"image_b64,omitempty"`
		ImageURL  string `json:"image_url,omitempty"`
	Status    string `json:"status"`
	ErrorMsg  string `json:"error_msg,omitempty"`
	UserEmail string `json:"user_email,omitempty"`
	UserName  string `json:"user_name,omitempty"`
	Shared    bool   `json:"shared"`
	ShareStatus string `json:"share_status,omitempty"` // none/pending/approved/rejected
	ShareRejectReason string `json:"share_reject_reason,omitempty"`
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
	FreeTokenCapacity   int    `json:"free_token_capacity"`     // 无套餐/订阅过期时的令牌容量（0=内置默认 50）
	FreeTokenRefillPerHour int `json:"free_token_refill_per_hour"` // 无套餐时每小时恢复令牌数（0=内置默认 3）
	FreeConcurrency     int    `json:"free_concurrency"`        // 无套餐时并发上限（0=内置默认 1）
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
	PointsExchangeBonusThreshold int `json:"points_exchange_bonus_threshold"` // 大额兑换赠送的触发阈值（每满 N 个赠送一档；0=用内置默认 50）
	TokensPerImage      int    `json:"tokens_per_image"` // 每生成 1 张图消耗的令牌数（0=用内置默认 1）
	PromptPolishCost    int    `json:"prompt_polish_cost"` // 每次提示词润色消耗的令牌数（0=免费）
	ImageToTextCost     int    `json:"image_to_text_cost"` // 每次图生文（反推提示词）消耗的令牌数（0=免费）
	ImageEnhancePrompt  string `json:"image_enhance_prompt"` // 一键智能增强使用的提示词（空=用内置默认强提示词）
	BurstTokenCap       int    `json:"burst_token_cap"` // 突发令牌囤积上限（0=不限），防积分兑换无限囤额度
	DefaultRateLimitPerMin int `json:"default_rate_limit_per_min"` // API Key 默认每分钟请求上限（套餐未配 rate_limit_per_min 时回退此值；0=用内置兜底 30）
	ConfigCacheTTLSeconds  int `json:"config_cache_ttl_seconds"`   // 配置(settings/storage)进程内缓存秒数（0=不缓存，写时自动失效）
	APIKeyLastUsedThrottleSeconds int `json:"apikey_lastused_throttle_seconds"` // API Key last_used 写入最小间隔秒数（0=每次都写）
	PublicCacheTTLSeconds  int `json:"public_cache_ttl_seconds"`   // 公开 GET 接口(plans/gallery/公告/stats)缓存秒数（0=不缓存）
	DBMaxOpenConns         int `json:"db_max_open_conns"`          // MySQL 最大连接数（0=用内置默认 25；上限 200 防爆内存）
	OrderTimeoutMinutes    int `json:"order_timeout_minutes"`      // 待支付订单超时分钟数，超时自动置为 expired（0=不自动处理）
	SVGModel               string `json:"svg_model"`               // AI 矢量生成使用的对话模型 slug（空=功能关闭）
	// 参考图上传压缩（前端上传前在浏览器压缩，降体积提上传速度；上游只用 ~1.5MP，压缩对画质无损）
	UploadMaxEdge        int    `json:"upload_max_edge"`        // 压缩后最长边像素（0=用内置默认 1536；建议 1280~2048）
	UploadQuality        int    `json:"upload_quality"`         // WebP/JPEG 质量 1-100（0=用内置默认 82）
	UploadFormat         string `json:"upload_format"`          // 压缩输出格式：webp/jpeg/auto（空=auto，优先 webp 回退 jpeg）
	UploadCompressThresholdKB int `json:"upload_compress_threshold_kb"` // 文件超过此 KB 才压缩（0=用内置默认 100；小图直传不折腾）
	StylePresets string `json:"style_presets"` // JSON 数组：风格预设
	EmailConfig string `json:"email_config"` // JSON：SMTP+域名规则
	InviteConfig string `json:"invite_config"` // JSON：邀请裂变配置
	ShopConfig string `json:"shop_config"` // JSON：积分商城商品列表（[]ShopItem）
	OAuthConfig string `json:"oauth_config"` // JSON：第三方登录配置（Linux Do Connect 等）
	CreditConfig string `json:"credit_config"` // JSON：Linux Do Credit 积分支付配置（EasyPay 协议）
	APINoPersist bool `json:"api_no_persist"` // 开：API Key 生成的图/SVG 不永久落地，只短时缓存 + 代理地址（省空间）
	APIImageTTLMin int `json:"api_image_ttl_min"` // API 短时缓存有效期（分钟，0=用内置默认 30）
	APILogRetentionDays int `json:"api_log_retention_days"` // API 调用日志保留天数（0=用内置默认 30）
}

// ShopItem 积分商城商品（第一期：积分换套餐时长）。存于 settings.shop_config 的 JSON 数组。
type ShopItem struct {
	ID      string `json:"id"`       // 商品唯一标识
	Name    string `json:"name"`     // 展示名，如「7天专业版」
	PlanID  int    `json:"plan_id"`  // 兑换的套餐 ID
	Days    int    `json:"days"`     // 兑换的天数（0=永久）
	Points  int    `json:"points"`   // 所需积分
	Enabled bool   `json:"enabled"`  // 是否上架
}

// PointsLog 积分流水（一笔变动）。Change 正=收入/负=支出；Balance=变动后余额。
type PointsLog struct {
	ID        int64  `json:"id"`
	Change    int    `json:"change"`
	Balance   int    `json:"balance"`
	Type      string `json:"type"`   // checkin/invite/redeem_code/admin/exchange_token/shop
	Remark    string `json:"remark"`
	CreatedAt string `json:"created_at"`
}

// InviteConfig 邀请裂变配置（存于 settings.invite_config）
type InviteConfig struct {
	Enabled         bool `json:"enabled"`
	RewardRegInviter   int `json:"reward_reg_inviter"`   // 被邀请人注册成功，邀请人得积分
	RewardRegInvitee   int `json:"reward_reg_invitee"`   // 被邀请人注册成功，本人得积分
	RewardRechargeInviter int `json:"reward_recharge_inviter"` // 被邀请人首充，邀请人得积分
	RewardRechargeInvitee int `json:"reward_recharge_invitee"` // 被邀请人首充，本人得积分
}

// InviteeItem 邀请战绩列表项（脱敏）
type InviteeItem struct {
	MaskedEmail    string `json:"masked_email"`
	RewardRegister int    `json:"reward_register"`
	RewardRecharge int    `json:"reward_recharge"`
	Recharged      bool   `json:"recharged"`
	CreatedAt      string `json:"created_at"`
}

// Announcement 站点公告（顶部 Banner 展示）
type Announcement struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`  // info | warning | success | activity
	Link      string `json:"link"`  // 可选跳转链接
	Priority  int    `json:"priority"` // 数值越大越靠前
	Enabled   bool   `json:"enabled"`
	Dismissible bool `json:"dismissible"` // 是否允许用户关闭（false=强制常驻）
	StartAt   string `json:"start_at"` // 生效起（空=立即）
	EndAt     string `json:"end_at"`   // 生效止（空=永久）
	CreatedAt string `json:"created_at"`
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

// OAuthConfig 第三方登录配置（存于 settings.oauth_config）。
// 目前支持 Linux Do Connect（OAuth2）。client_secret 为敏感字段，
// 公开接口返回前会被抹除（与 SMTP/Turnstile 密钥同级处理）。
type OAuthConfig struct {
	LinuxDoEnabled       bool   `json:"linuxdo_enabled"`
	LinuxDoClientID      string `json:"linuxdo_client_id"`
	LinuxDoClientSecret  string `json:"linuxdo_client_secret"`
	LinuxDoMinTrustLevel int    `json:"linuxdo_min_trust_level"` // 允许登录的最低 trust_level（0=不限制；Linux Do 为 0-4）
}

// CreditConfig Linux Do Credit 积分支付配置（存于 settings.credit_config）。
// credit.linux.do 采用 EasyPay（易支付）协议：跳转支付页 + MD5 签名 + 异步回调。
// key 为商户密钥（敏感），公开接口返回前会被抹除（与 OAuth secret 同级处理）。
type CreditConfig struct {
	Enabled bool   `json:"enabled"`
	APIBase string `json:"api_base"` // 网关根地址，如 https://credit.linux.do
	PID     string `json:"pid"`      // EasyPay 商户 ID
	Key     string `json:"key"`      // EasyPay 商户密钥（MD5 签名用，敏感）
	Rate    int    `json:"rate"`     // 积分/元汇率：1 元 = X 积分（0 视为 1）
	// LDC Pay（Ed25519）—— 优先于 EasyPay；未配置或签名失败时自动降级 MD5
	LDCClientID     string `json:"ldc_client_id"`
	LDCClientSecret string `json:"ldc_client_secret"`
	LDCPrivateKey   string `json:"ldc_private_key"` // Ed25519 私钥（Base64 或 64 位 Hex）
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
	ID             int64   `json:"id"`
	OrderNo        string  `json:"order_no"`
	UserID         int64   `json:"user_id"`
	UserEmail      string  `json:"user_email,omitempty"`
	UserName       string  `json:"user_name,omitempty"`
	PlanID         int     `json:"plan_id"`
	PlanName       string  `json:"plan_name"`
	DurationDays   int     `json:"duration_days"`
	Amount         float64 `json:"amount"`
	Subject        string  `json:"subject"`
	Status         string  `json:"status"`
	OrderType      string  `json:"order_type"`
	RechargePoints int     `json:"recharge_points,omitempty"`
	AlipayTradeNo  string  `json:"alipay_trade_no,omitempty"`
	CouponCode     string  `json:"coupon_code,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type CreateOrderRequest struct {
	PlanID     int    `json:"plan_id"`
	Billing    string `json:"billing"`
	CouponCode string `json:"coupon_code,omitempty"`
	CouponID   int64  `json:"coupon_id,omitempty"`
	Gateway    string `json:"gateway,omitempty"` // 指定支付渠道（alipay/credit）；空=自动选择首个可用渠道
}

type UpgradeOrderRequest struct {
	PlanID     int    `json:"plan_id"`
	Billing    string `json:"billing"`
	CouponCode string `json:"coupon_code,omitempty"`
	Gateway    string `json:"gateway,omitempty"` // 指定支付渠道（alipay/credit）；空=自动选择
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
	TotalSvg         int     `json:"total_svg"`   // 矢量(SVG)累计生成
	TodaySvg         int     `json:"today_svg"`   // 矢量(SVG)今日生成
	TotalOrders      int     `json:"total_orders"`
	PaidOrders       int     `json:"paid_orders"`
	PaidUsers        int     `json:"paid_users"`  // 有过付费订单的去重用户数（转化率分子）
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
	Generations    []TrendPoint `json:"generations"`
	Success        []TrendPoint `json:"success"`
	Failed         []TrendPoint `json:"failed"`
	Svg            []TrendPoint `json:"svg"`             // 矢量(SVG)每日生成量
	Revenue        []TrendPoint `json:"revenue"`
	Users          []TrendPoint `json:"users"`
	PointsIssued   []TrendPoint `json:"points_issued"`   // 每日积分发放（收入）
	PointsConsumed []TrendPoint `json:"points_consumed"` // 每日积分消耗（支出，取正值）
}

type ModelBreakdown struct {
	Model string `json:"model"`
	Count int    `json:"count"`
}

// PointsStats 积分经济看板：发放 vs 消耗的总量与分类型拆解。
type PointsStats struct {
	TodayIssued   int              `json:"today_issued"`
	TodayConsumed int              `json:"today_consumed"`
	TotalIssued   int              `json:"total_issued"`
	TotalConsumed int              `json:"total_consumed"`
	ByType        []PointsTypeStat `json:"by_type"`
}

// PointsTypeStat 单一类型（签到/邀请/兑换…）的积分收支。
type PointsTypeStat struct {
	Type     string `json:"type"`
	Issued   int    `json:"issued"`   // 该类型累计发放（正变动求和）
	Consumed int    `json:"consumed"` // 该类型累计消耗（负变动取正求和）
}

// FailureReason 失败原因归类（按 error_msg 关键词归桶）。
type FailureReason struct {
	Reason string `json:"reason"`
	Count  int    `json:"count"`
}

// AccountProductivity 单账号产能：累计成功/失败计数 + 最近使用。
type AccountProductivity struct {
	ID           int64  `json:"id"`
	Email        string `json:"email"`
	Status       string `json:"status"`
	PlanType     string `json:"plan_type"`
	SuccessCount int    `json:"success_count"`
	FailCount    int    `json:"fail_count"`
	LastUsedAt   string `json:"last_used_at"`
}

// RetentionStats 留存：基于 generations 出图行为推断（无 last_active 字段）。
type RetentionStats struct {
	ActiveUsers7d int `json:"active_users_7d"` // 近 7 日有出图的去重用户数
	D1Cohort      int `json:"d1_cohort"`       // 注册满 1 天的用户数（次日留存分母）
	D1Retained    int `json:"d1_retained"`     // 其中注册次日有出图的用户数
	D7Cohort      int `json:"d7_cohort"`       // 注册满 7 天的用户数（7 日留存分母）
	D7Retained    int `json:"d7_retained"`     // 其中注册第 7 天有出图的用户数
}

// AccountEventStats 账号事件累计：注册/封禁/删除的今日与累计数。
type AccountEventStats struct {
	TodayRegistered int `json:"today_registered"`
	TotalRegistered int `json:"total_registered"`
	TodayBanned     int `json:"today_banned"`
	TotalBanned     int `json:"total_banned"`
	TodayDeleted    int `json:"today_deleted"`
	TotalDeleted    int `json:"total_deleted"`
}

// AccountEventTrends 账号事件每日趋势。
type AccountEventTrends struct {
	Registered []TrendPoint `json:"registered"`
	Banned     []TrendPoint `json:"banned"`
	Deleted    []TrendPoint `json:"deleted"`
}

// HourlyHeat 出图时段分布：hour=0..23，count=该小时累计出图量。
type HourlyHeat struct {
	Hour  int `json:"hour"`
	Count int `json:"count"`
}

// PlanDistribution 套餐订阅分布：当前活跃订阅 + 已过期数。
type PlanDistribution struct {
	PlanName string `json:"plan_name"`
	Active   int    `json:"active"`  // 未过期（subscription_expires_at > NOW 或永久）
	Expired  int    `json:"expired"` // 已过期
}

// RevenueByPlan 收入构成：各套餐已付订单数与金额。
type RevenueByPlan struct {
	PlanName string  `json:"plan_name"`
	Orders   int     `json:"orders"`
	Amount   float64 `json:"amount"`
}

// InviteLeader 邀请裂变榜：单个邀请人的战绩。
type InviteLeader struct {
	Email      string `json:"email"`
	Invites    int    `json:"invites"`     // 邀请注册数
	Recharged  int    `json:"recharged"`   // 其中已首充人数
	RewardSum  int    `json:"reward_sum"`  // 累计获得邀请积分
}

// RevenueComposition 营收构成汇总：按套餐 + 优惠券使用情况。
type RevenueComposition struct {
	ByPlan        []RevenueByPlan `json:"by_plan"`
	CouponOrders  int             `json:"coupon_orders"`  // 用了优惠券的已付订单数
	TotalPaid     int             `json:"total_paid"`     // 已付订单总数
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

// --- API 用量仪表盘 DTO ---

// APIUsageSummary API 调用用量概览（GET /api/user/api-usage/summary 返回）。
type APIUsageSummary struct {
	TotalCalls   int                  `json:"total_calls"`
	SuccessCalls int                  `json:"success_calls"`
	FailedCalls  int                  `json:"failed_calls"`
	RateLimited  int                  `json:"rate_limited"` // 429 次数
	TotalTokens  int                  `json:"total_tokens"`
	ByEndpoint   []APIUsageDimension  `json:"by_endpoint"`
	ByKey        []APIUsageKeyDim     `json:"by_key"`
	Trend        []APIUsageTrendPoint `json:"trend"`
}

// APIUsageDimension 按某维度（端点）聚合的调用量与令牌消耗。
type APIUsageDimension struct {
	Name   string `json:"name"`
	Calls  int    `json:"calls"`
	Tokens int    `json:"tokens"`
}

// APIUsageKeyDim 按 API Key 聚合（带 Key 名，未解析的归到 id=0）。
type APIUsageKeyDim struct {
	KeyID   int64  `json:"key_id"`
	KeyName string `json:"key_name"`
	Calls   int    `json:"calls"`
	Tokens  int    `json:"tokens"`
}

// APIUsageTrendPoint 每日调用趋势（成功 vs 失败）。
type APIUsageTrendPoint struct {
	Date    string `json:"date"`
	Success int    `json:"success"`
	Failed  int    `json:"failed"`
}

// APIStatsGlobal 全站 API 调用聚合统计（Admin 视角）。
type APIStatsGlobal struct {
	TotalCalls   int                   `json:"total_calls"`
	SuccessCalls int                   `json:"success_calls"`
	FailedCalls  int                   `json:"failed_calls"`
	RateLimited  int                   `json:"rate_limited"`
	TotalTokens  int                   `json:"total_tokens"`
	ActiveUsers  int                   `json:"active_users"`
	ActiveKeys   int                   `json:"active_keys"`
	ByEndpoint   []APIUsageDimension   `json:"by_endpoint"`
	ByStatus     []APIStatsStatusDim   `json:"by_status"`
	TopUsers     []APIStatsUserDim     `json:"top_users"`
	TrendMinutes []APIStatsTrendMinute `json:"trend_minutes"`
}

// APIStatsStatusDim 按状态码聚合。
type APIStatsStatusDim struct {
	Code  int `json:"code"`
	Count int `json:"count"`
}

// APIStatsUserDim 按用户聚合（Top 用户排行）。
type APIStatsUserDim struct {
	UserID int64  `json:"user_id"`
	Email  string `json:"email"`
	Calls  int    `json:"calls"`
	Tokens int    `json:"tokens"`
}

// APIStatsTrendMinute 按分钟趋势点。
type APIStatsTrendMinute struct {
	Minute string `json:"minute"` // HH:MM
	Calls  int    `json:"calls"`
	Errors int    `json:"errors"`
}

// APICallLog 单条调用明细（GET /api/user/api-usage/logs 返回；Admin 端复用）。
type APICallLog struct {
	ID         int64  `json:"id"`
	UserID     int64  `json:"user_id"`
	APIKeyID   int64  `json:"api_key_id"`
	KeyName    string `json:"key_name"`
	Endpoint   string `json:"endpoint"`
	IP         string `json:"ip"`                    // 调用方 IP
	Prompt     string `json:"prompt,omitempty"`      // 生图提示词
	ImageURL   string `json:"image_url,omitempty"`   // 代理中转后图片地址
	StatusCode int    `json:"status_code"`
	TokensCost int    `json:"tokens_cost"`
	Count      int    `json:"count"`
	LatencyMs  int    `json:"latency_ms"`
	CreatedAt  string `json:"created_at"`
	UserEmail  string `json:"user_email,omitempty"`  // Admin 全站查询时附带
}
