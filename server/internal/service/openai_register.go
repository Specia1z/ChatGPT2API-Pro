package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/service/mail"
)

// --- 常量（对标 Python openai_register.py） ---

const (
	authBase                     = "https://auth.openai.com"
	platformBase                 = "https://platform.openai.com"
	platformOAuthClientID        = "app_2SKx67EdpoN0G6j64rFvigXD"
	platformOAuthRedirectURI     = "https://platform.openai.com/auth/callback"
	platformOAuthAudience        = "https://api.openai.com/v1"
	platformAuth0Client          = "eyJuYW1lIjoiYXV0aDAtc3BhLWpzIiwidmVyc2lvbiI6IjEuMjEuMCJ9"
	userAgent                    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
	secChUA                      = `"Google Chrome";v="145", "Not?A_Brand";v="8", "Chromium";v="145"`
	secChUAFullVersionList       = `"Chromium";v="145.0.0.0", "Not:A-Brand";v="99.0.0.0", "Google Chrome";v="145.0.0.0"`
	defaultTimeout               = 30 * time.Second
	sentinelMaxAttempts          = 500000
	sentinelErrorPrefix          = "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D"
)

// --- PlatformRegistrar ---

// PlatformRegistrar OpenAI 注册器（对标 Python PlatformRegistrar）
type PlatformRegistrar struct {
	session           *http.Client
	deviceID          string
	codeVerifier      string
	platformAuthCode  string
	mailCfg           model.MailConfig
	proxy             string
	LogFunc           func(text, level string)
}

// NewPlatformRegistrar 创建注册器
func NewPlatformRegistrar(mailCfg model.MailConfig, proxy string) *PlatformRegistrar {
	jar, _ := cookiejar.New(nil)

	// 代理决策与刷新/生图链路统一走 getChromeTransport：
	// 传入代理 > 环境变量 HTTPS_PROXY/HTTP_PROXY > 直连。后台不填代理即直连。
	httpTransport := getChromeTransport(proxy)

	return &PlatformRegistrar{
		session: &http.Client{
			Jar:       jar,
			Transport: httpTransport,
			Timeout:   defaultTimeout,
		},
		deviceID: newUUID(),
		mailCfg:  mailCfg,
		proxy:    proxy,
	}
}

// Register 执行完整注册流程
func (r *PlatformRegistrar) Register(index int) (*model.Account, error) {
	r.log("📧 创建邮箱...", "")
	// 1. 创建邮箱
	mailbox, err := mail.CreateMailbox(r.mailCfg)
	if err != nil {
		return nil, fmt.Errorf("创建邮箱失败: %w", err)
	}
	email := mailbox.Address
	r.log("📧 "+email, "")

	password := randomPassword(16)
	firstName, lastName := randomName()

	r.log("🔐 平台授权中 (PKCE)...", "")
	// 2. Platform authorize (PKCE)
	if err := r.platformAuthorize(email); err != nil {
		return nil, fmt.Errorf("platform_authorize 失败: %w", err)
	}

	r.log("📝 提交注册信息...", "")
	// 3. 注册用户
	if err := r.registerUser(email, password); err != nil {
		return nil, fmt.Errorf("register_user 失败: %w", err)
	}

	r.log("📨 发送验证码...", "")
	// 4. 发送验证码
	if err := r.sendOTP(); err != nil {
		return nil, fmt.Errorf("send_otp 失败: %w", err)
	}

	r.log("⏳ 等待验证码...", "")
	// 5. 等待验证码
	code, err := mail.WaitForCode(r.mailCfg, mailbox)
	if err != nil {
		return nil, fmt.Errorf("等待验证码失败: %w", err)
	}
	r.log("🔢 验证码: "+code, "")

	r.log("✔ 验证验证码...", "")
	// 6. 验证验证码
	if err := r.validateOTP(code); err != nil {
		return nil, fmt.Errorf("validate_otp 失败: %w", err)
	}

	r.log("👤 创建账号资料...", "")
	// 7. 创建账号资料
	name := firstName + " " + lastName
	birthdate := randomBirthdate()
	if err := r.createAccount(name, birthdate); err != nil {
		return nil, fmt.Errorf("create_account 失败: %w", err)
	}

	r.log("🔑 换取 Token...", "")
	// 8. 换取 token
	tokens, err := r.exchangeTokens()
	if err != nil {
		return nil, fmt.Errorf("token 换取失败: %w", err)
	}

	return &model.Account{
		Email:        email,
		AccessToken:  getStrVal(tokens, "access_token"),
		RefreshToken: getStrVal(tokens, "refresh_token"),
		IDToken:      getStrVal(tokens, "id_token"),
		PlanType:     "free",
		Status:       "正常",
		SourceType:   "web",
		CreatedAt:    time.Now(),
	}, nil
}

func (r *PlatformRegistrar) Close() {
	r.session.CloseIdleConnections()
}

func (r *PlatformRegistrar) log(text, level string) {
	if r.LogFunc != nil {
		r.LogFunc(text, level)
	}
}

// --- HTTP helper ---

func (r *PlatformRegistrar) do(method, urlStr string, headers map[string]string, body io.Reader, allowRedirects bool) (*http.Response, error) {
	if !allowRedirects {
		// 禁用重定向
		orig := r.session.CheckRedirect
		r.session.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
		defer func() { r.session.CheckRedirect = orig }()
	}

	req, err := http.NewRequest(method, urlStr, body)
	if err != nil {
		return nil, err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	return r.session.Do(req)
}

func (r *PlatformRegistrar) postJSON(urlStr string, headers map[string]string, payload any, allowRedirects bool) (*http.Response, error) {
	data, _ := json.Marshal(payload)
	headers["Content-Type"] = "application/json"
	return r.do("POST", urlStr, headers, strings.NewReader(string(data)), allowRedirects)
}

func (r *PlatformRegistrar) get(urlStr string, headers map[string]string, allowRedirects bool) (*http.Response, error) {
	return r.do("GET", urlStr, headers, nil, allowRedirects)
}

// --- 注册流程各步骤 ---

func (r *PlatformRegistrar) platformAuthorize(email string) error {
	// PKCE
	r.codeVerifier, _ = generatePKCE()
	codeChallenge := sha256Hex(r.codeVerifier)

	state := randomToken(32)
	nonce := randomToken(32)

	params := url.Values{
		"issuer":                 {authBase},
		"client_id":              {platformOAuthClientID},
		"audience":               {platformOAuthAudience},
		"redirect_uri":           {platformOAuthRedirectURI},
		"device_id":              {r.deviceID},
		"screen_hint":            {"login_or_signup"},
		"max_age":                {"0"},
		"login_hint":             {email},
		"scope":                  {"openid profile email offline_access"},
		"response_type":          {"code"},
		"response_mode":          {"query"},
		"state":                  {state},
		"nonce":                  {nonce},
		"code_challenge":         {codeChallenge},
		"code_challenge_method":  {"S256"},
		"auth0Client":            {platformAuth0Client},
	}

	headers := r.navigateHeaders(platformBase + "/")
	r.session.Jar.SetCookies(mustParseURL(authBase), []*http.Cookie{
		{Name: "oai-did", Value: r.deviceID, Domain: ".auth.openai.com", Path: "/"},
		{Name: "oai-did", Value: r.deviceID, Domain: "auth.openai.com", Path: "/"},
	})

	urlStr := authBase + "/api/accounts/authorize?" + params.Encode()
	resp, err := r.get(urlStr, headers, true)
	if err != nil {
		return fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		if len(bodyStr) > 500 {
			bodyStr = bodyStr[:500]
		}
		if strings.Contains(strings.ToLower(bodyStr), "cloudflare") || strings.Contains(strings.ToLower(bodyStr), "just a moment") {
			return fmt.Errorf("被 Cloudflare 拦截，请更换 IP (http %d)", resp.StatusCode)
		}
		return fmt.Errorf("http %d: %s", resp.StatusCode, bodyStr)
	}

	return nil
}

func (r *PlatformRegistrar) registerUser(email, password string) error {
	headers := r.jsonHeaders(authBase + "/create-account/password")
	headers["openai-sentinel-token"] = r.buildSentinelToken("username_password_create")

	resp, err := r.postJSON(authBase+"/api/accounts/user/register", headers, map[string]string{
		"username": email,
		"password": password,
	}, false)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		var data map[string]any
		json.Unmarshal(body, &data)
		if msg, _ := data["message"].(string); msg == "Failed to create account. Please try again." {
			return fmt.Errorf("注册失败: 邮箱域名可能因滥用被封禁，请更换邮箱域名")
		}
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(body[:min(200, len(body))]))
	}
	return nil
}

func (r *PlatformRegistrar) sendOTP() error {
	headers := r.navigateHeaders(authBase + "/create-account/password")
	resp, err := r.get(authBase+"/api/accounts/email-otp/send", headers, true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 302 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	return nil
}

func (r *PlatformRegistrar) validateOTP(code string) error {
	headers := r.jsonHeaders(authBase + "/email-verification")
	headers["oai-device-id"] = r.deviceID
	addTraceHeaders(headers)

	resp, err := r.postJSON(authBase+"/api/accounts/email-otp/validate", headers, map[string]string{
		"code": code,
	}, false)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		// 重试带 sentinel token
		headers["openai-sentinel-token"] = r.buildSentinelToken("authorize_continue")
		resp2, err2 := r.postJSON(authBase+"/api/accounts/email-otp/validate", headers, map[string]string{
			"code": code,
		}, false)
		if err2 != nil {
			return err2
		}
		defer resp2.Body.Close()
		if resp2.StatusCode != 200 {
			body, _ := io.ReadAll(resp2.Body)
			return fmt.Errorf("http %d: %s", resp2.StatusCode, string(body[:min(500, len(body))]))
		}
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(body[:min(500, len(body))]))
	}
	return nil
}

func (r *PlatformRegistrar) createAccount(name, birthdate string) error {
	headers := r.jsonHeaders(authBase + "/about-you")
	headers["openai-sentinel-token"] = r.buildSentinelToken("oauth_create_account")

	resp, err := r.postJSON(authBase+"/api/accounts/create_account", headers, map[string]string{
		"name":      name,
		"birthdate": birthdate,
	}, false)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 302 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(body[:min(200, len(body))]))
	}

	// 解析 continue_url 获取 authorization code
	var data map[string]any
	body, _ := io.ReadAll(resp.Body)
	json.Unmarshal(body, &data)

	continueURL := ""
	if v, ok := data["continue_url"].(string); ok {
		continueURL = v
	}

	parsed, _ := url.Parse(continueURL)
	query := parsed.Query()
	r.platformAuthCode = query.Get("code")

	if r.platformAuthCode == "" {
		return fmt.Errorf("未获取到 authorization code")
	}
	return nil
}

func (r *PlatformRegistrar) exchangeTokens() (map[string]any, error) {
	headers := map[string]string{
		"accept":          "*/*",
		"accept-language": "zh-CN,zh;q=0.9",
		"auth0-client":    platformAuth0Client,
		"cache-control":   "no-cache",
		"content-type":    "application/json",
		"origin":          platformBase,
		"pragma":          "no-cache",
		"priority":        "u=1, i",
		"referer":         platformBase + "/",
		"sec-ch-ua":       secChUA,
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": `"Windows"`,
		"sec-fetch-dest":  "empty",
		"sec-fetch-mode":  "cors",
		"sec-fetch-site":  "same-site",
		"user-agent":      userAgent,
	}

	resp, err := r.postJSON(authBase+"/api/accounts/oauth/token", headers, map[string]string{
		"client_id":     platformOAuthClientID,
		"code_verifier": r.codeVerifier,
		"grant_type":    "authorization_code",
		"code":          r.platformAuthCode,
		"redirect_uri":  platformOAuthRedirectURI,
	}, false)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, string(body[:min(300, len(body))]))
	}

	var tokens map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return nil, fmt.Errorf("解析 token 失败: %w", err)
	}
	return tokens, nil
}

// --- Sentinel Token (对标 Python SentinelTokenGenerator) ---

type sentinelGenerator struct {
	deviceID  string
	userAgent string
	sid       string
}

func newSentinelGenerator(deviceID string) *sentinelGenerator {
	return &sentinelGenerator{
		deviceID:  deviceID,
		userAgent: userAgent,
		sid:       newUUID(),
	}
}

func (r *PlatformRegistrar) buildSentinelToken(flow string) string {
	gen := newSentinelGenerator(r.deviceID)

	// 1. 获取 requirements token
	reqPayload := map[string]any{
		"p":  gen.generateRequirementsToken(),
		"id": r.deviceID,
		"flow": flow,
	}

	reqHeaders := map[string]string{
		"Content-Type":      "text/plain;charset=UTF-8",
		"Referer":           "https://sentinel.openai.com/backend-api/sentinel/frame.html",
		"Origin":            "https://sentinel.openai.com",
		"User-Agent":        userAgent,
		"sec-ch-ua":         secChUA,
		"sec-ch-ua-mobile":  "?0",
		"sec-ch-ua-platform": `"Windows"`,
	}

	resp, err := r.postJSON("https://sentinel.openai.com/backend-api/sentinel/req", reqHeaders, reqPayload, false)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return gen.generateRequirementsToken()
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var data map[string]any
	json.Unmarshal(body, &data)

	sentinelToken, _ := data["token"].(string)
	if resp.StatusCode != 200 || sentinelToken == "" {
		return gen.generateRequirementsToken()
	}

	// 2. Proof of Work
	powData, _ := data["proofofwork"].(map[string]any)
	pValue := gen.generateRequirementsToken()

	if required, _ := powData["required"].(bool); required {
		seed, _ := powData["seed"].(string)
		difficulty, _ := powData["difficulty"].(string)
		if seed != "" {
			pValue = gen.generateToken(seed, difficulty)
		}
	}

	result := map[string]string{
		"p":  pValue,
		"t":  "",
		"c":  sentinelToken,
		"id": r.deviceID,
		"flow": flow,
	}
	encoded, _ := json.Marshal(result)
	return string(encoded)
}

func (g *sentinelGenerator) generateRequirementsToken() string {
	data := g.getConfig()
	data[3] = 1
	data[9] = float64(randomInt(5, 50))
	return "gAAAAAC" + b64Encode(data)
}

func (g *sentinelGenerator) generateToken(seed, difficulty string) string {
	start := time.Now()
	data := g.getConfig()

	// 热路径优化（payload 构造保持逐字节不变，仅换哈希/难度比较；
	// 等价性由 TestFnvByteVsRune + TestDifficultyIntVsStr 担保，与 payload 结构无关）：
	//  1) seed 的 fnv 累加态只算一次，每次迭代在其上续算 payload，免 seed+payload 字符串拼接
	//  2) 难度用整数比较：hex(h)[:n] <= difficulty 等价于 (h >> (32-n*4)) <= diffInt，免每次 Sprintf+切片+串比较
	// 难度格式异常时回退到原始字符串路径。
	if n := len(difficulty); n >= 1 && n <= 8 {
		if diffInt, perr := strconv.ParseUint(difficulty, 16, 64); perr == nil {
			shift := uint(32 - n*4)
			seedH := fnv1aSeed([]byte(seed))
			for i := 0; i < sentinelMaxAttempts; i++ {
				data[3] = float64(i)
				data[9] = float64(time.Since(start).Milliseconds())
				payload := b64Encode(data)
				if uint64(fnv1aFinish(seedH, []byte(payload))>>shift) <= diffInt {
					return "gAAAAAB" + payload + "~S"
				}
			}
			return "gAAAAAB" + sentinelErrorPrefix + b64Encode("")
		}
	}

	// 回退：原始字符串比较路径（难度格式异常时）
	for i := 0; i < sentinelMaxAttempts; i++ {
		data[3] = float64(i)
		data[9] = float64(time.Since(start).Milliseconds())
		payload := b64Encode(data)
		if fnv1a32(seed+payload)[:len(difficulty)] <= difficulty {
			return "gAAAAAB" + payload + "~S"
		}
	}
	return "gAAAAAB" + sentinelErrorPrefix + b64Encode("")
}

func (g *sentinelGenerator) getConfig() []any {
	perfNow := float64(randomInt(1000, 50000))
	return []any{
		"1920x1080",
		time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT-0700 (Coordinated Universal Time)"),
		4294705152,
		float64(0), // placeholder for attempt
		randomFloat(),
		g.userAgent,
		"https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js",
		nil,
		nil,
		"en-US",
		float64(0), // placeholder for elapsed
		randomChoice("vendorSub-undefined", "plugins-undefined", "mimeTypes-undefined", "hardwareConcurrency-undefined"),
		randomChoice("location", "implementation", "URL", "documentURI", "compatMode"),
		randomChoice("Object", "Function", "Array", "Number", "parseFloat", "undefined"),
		perfNow,
		g.sid,
		"",
		float64(randomChoiceInt(4, 8, 12, 16)),
		float64(time.Now().UnixMilli()) - perfNow,
	}
}

// --- 加密/编码 helper ---

func b64Encode(data any) string {
	jsonBytes, _ := json.Marshal(data)
	return base64.StdEncoding.EncodeToString(jsonBytes)
}

func fnv1a32(text string) string {
	h := uint32(2166136261)
	for _, ch := range text {
		h ^= uint32(ch)
		h *= 16777619
	}
	h ^= h >> 16
	h *= 2246822507
	h ^= h >> 13
	h *= 3266489909
	h ^= h >> 16
	return fmt.Sprintf("%08x", h)
}

// fnv1aSeed 计算 FNV-1a 的累加中间态（仅累加，不做最终混淆）。
// 用于 PoW 热路径：seed 部分只算一次，每次迭代在此基础上续算 b64。
func fnv1aSeed(b []byte) uint32 {
	h := uint32(2166136261)
	for _, c := range b {
		h ^= uint32(c)
		h *= 16777619
	}
	return h
}

// fnv1aFinish 在已有累加态上续算 more，再做最终混淆，返回 uint32（不格式化成 hex）。
// 等价于 fnv1a32(seedStr + string(more)) 解析出的整数。
func fnv1aFinish(h uint32, more []byte) uint32 {
	for _, c := range more {
		h ^= uint32(c)
		h *= 16777619
	}
	h ^= h >> 16
	h *= 2246822507
	h ^= h >> 13
	h *= 3266489909
	h ^= h >> 16
	return h
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// generatePKCE 生成 PKCE code_verifier 和 code_challenge
func generatePKCE() (string, string) {
	buf := make([]byte, 64)
	rand.Read(buf)
	verifier := base64.RawURLEncoding.EncodeToString(buf)
	challenge := sha256Hex(verifier)
	return verifier, challenge
}

// --- 随机数据生成 ---

func randomPassword(length int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%"
	buf := make([]byte, length)
	// 确保包含各类字符
	buf[0] = chars[randomInt(26, 51)]                          // 大写
	buf[1] = chars[randomInt(0, 25)]                            // 小写
	buf[2] = chars[randomInt(52, 61)]                           // 数字
	buf[3] = chars[randomInt(62, 65)]                           // 特殊字符
	for i := 4; i < length; i++ {
		buf[i] = chars[randomInt(0, len(chars))]
	}
	// 洗牌
	for i := len(buf) - 1; i > 0; i-- {
		j := randomInt(0, i+1)
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}

func randomName() (string, string) {
	firstNames := []string{"James", "Robert", "John", "Michael", "David", "Mary", "Emma", "Olivia"}
	lastNames := []string{"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller"}
	return firstNames[randomInt(0, len(firstNames))], lastNames[randomInt(0, len(lastNames))]
}

func randomBirthdate() string {
	year := randomInt(1996, 2007)
	month := randomInt(1, 13)
	day := randomInt(1, 29)
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
}

func randomToken(length int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = chars[randomInt(0, len(chars))]
	}
	return string(buf)
}

// --- HTTP headers helper ---

func (r *PlatformRegistrar) commonHeaders() map[string]string {
	return map[string]string{
		"accept":          "application/json",
		"accept-language": "en-US,en;q=0.9",
		"content-type":    "application/json",
		"origin":          authBase,
		"priority":        "u=1, i",
		"user-agent":      userAgent,
		"sec-ch-ua":       secChUA,
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": `"Windows"`,
		"sec-fetch-dest":  "empty",
		"sec-fetch-mode":  "cors",
		"sec-fetch-site":  "same-origin",
	}
}

func (r *PlatformRegistrar) navigateHeaders(referer string) map[string]string {
	h := map[string]string{
		"accept":                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language":       "en-US,en;q=0.9",
		"user-agent":            userAgent,
		"sec-ch-ua":             secChUA,
		"sec-ch-ua-mobile":      "?0",
		"sec-ch-ua-platform":    `"Windows"`,
		"sec-fetch-dest":        "document",
		"sec-fetch-mode":        "navigate",
		"sec-fetch-site":        "same-origin",
		"upgrade-insecure-requests": "1",
	}
	if referer != "" {
		h["referer"] = referer
	}
	return h
}

func (r *PlatformRegistrar) jsonHeaders(referer string) map[string]string {
	h := r.commonHeaders()
	h["referer"] = referer
	h["oai-device-id"] = r.deviceID
	for k, v := range makeTraceHeaders() {
		h[k] = v
	}
	return h
}

func makeTraceHeaders() map[string]string {
	traceID := newUUID()
	parentID := fmt.Sprintf("%016x", randomInt(0, (1<<62)-1))
	return map[string]string{
		"traceparent":                    fmt.Sprintf("00-%s-%s-01", traceID, parentID),
		"tracestate":                     "dd=s:1;o:rum",
		"x-datadog-origin":              "rum",
		"x-datadog-parent-id":           parentID,
		"x-datadog-sampling-priority":   "1",
		"x-datadog-trace-id":            traceID,
	}
}

func addTraceHeaders(headers map[string]string) {
	for k, v := range makeTraceHeaders() {
		headers[k] = v
	}
}

// --- 工具函数 ---

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func randomInt(min, max int) int {
	n, _ := rand.Int(rand.Reader, big.NewInt(int64(max-min)))
	return int(n.Int64()) + min
}

func randomFloat() float64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(1<<53))
	return float64(n.Int64()) / float64(1<<53)
}

func randomChoice(options ...string) string {
	return options[randomInt(0, len(options))]
}

func randomChoiceInt(options ...int) int {
	return options[randomInt(0, len(options))]
}

func getStrVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func mustParseURL(raw string) *url.URL {
	u, _ := url.Parse(raw)
	return u
}
