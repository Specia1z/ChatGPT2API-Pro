package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// Linux Do Connect 端点（标准 OAuth2，基于 Discourse）。
const (
	linuxDoAuthorizeURL = "https://connect.linux.do/oauth2/authorize"
	linuxDoTokenURL     = "https://connect.linux.do/oauth2/token"
	linuxDoUserURL      = "https://connect.linux.do/api/user"
	oauthStateTTL       = 5 * time.Minute
)

// linuxDoUser 对应 connect.linux.do/api/user 返回的（部分）字段。
// 仅取登录所需：id 唯一标识、username 显示名、trust_level 信任等级、active/silenced 状态。
type linuxDoUser struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	Name           string `json:"name"`
	Active         bool   `json:"active"`
	Silenced       bool   `json:"silenced"`
	TrustLevel     int    `json:"trust_level"`
	AvatarTemplate string `json:"avatar_template"`
}

// linuxDoAvatarURL 将 avatar_template 转为完整 URL。
// Linux Do 返回形如 "/user_avatar/linux.do/{user}/{id}/{size}/xxx.png"，
// 需补全 host；如果已经是绝对 URL 则原样返回。
func linuxDoAvatarURL(tpl string) string {
	if tpl == "" {
		return ""
	}
	resolved := strings.Replace(tpl, "{size}", "240", 1)
	if strings.HasPrefix(resolved, "http") {
		return resolved
	}
	return "https://linux.do" + resolved
}

// loadOAuthConfig 读取站点设置中的第三方登录配置（Linux Do Connect）。
func (h *Handler) loadOAuthConfig() (model.Settings, model.OAuthConfig) {
	settings, _ := h.MySQL.GetSettings()
	var oc model.OAuthConfig
	if settings != nil && settings.OAuthConfig != "" {
		json.Unmarshal([]byte(settings.OAuthConfig), &oc)
	}
	if settings == nil {
		settings = &model.Settings{}
	}
	return *settings, oc
}

// externalBaseURL 推断对外可访问的站点根 URL（带 scheme + host）。
// 反代场景优先信任 X-Forwarded-Proto/Host；否则回退到请求自身的 scheme/host。
// 发起授权与回调 redirect_uri 用同一函数派生，保证两端一致。
func externalBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	// 反代场景：Nginx/Cloudflare 会注入 X-Forwarded-Proto
	if xfp := r.Header.Get("X-Forwarded-Proto"); xfp == "http" || xfp == "https" {
		scheme = xfp
	}
	host := r.Host
	if xfh := r.Header.Get("X-Forwarded-Host"); xfh != "" {
		host = xfh
	}
	return scheme + "://" + host
}

// GET /api/auth/linuxdo —— 发起 Linux Do OAuth2 登录
func (h *Handler) LinuxDoLogin(w http.ResponseWriter, r *http.Request) {
	_, oc := h.loadOAuthConfig()
	if !oc.LinuxDoEnabled || oc.LinuxDoClientID == "" {
		http.Error(w, "Linux Do 登录未开启", http.StatusForbidden)
		return
	}

	// 生成一次性 state（防 CSRF）：32 字节 hex。值存登录后回跳路径，回调校验并消费。
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		http.Error(w, "内部错误", http.StatusInternalServerError)
		return
	}
	state := hex.EncodeToString(stateBytes)
	returnTo := r.URL.Query().Get("return_to")
	// 仅允许站内回跳路径，防开放重定向（必须以 / 开头且非 // 协议相对 URL）
	if returnTo == "" || !strings.HasPrefix(returnTo, "/") || strings.HasPrefix(returnTo, "//") {
		returnTo = "/"
	}
	if h.Redis != nil {
		if err := h.Redis.SetOAuthState(r.Context(), state, returnTo, oauthStateTTL); err != nil {
			http.Error(w, "内部错误", http.StatusInternalServerError)
			return
		}
	}

	redirectURI := externalBaseURL(r) + "/api/auth/linuxdo/callback"
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", oc.LinuxDoClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	http.Redirect(w, r, linuxDoAuthorizeURL+"?"+q.Encode(), http.StatusFound)
}

// GET /api/auth/linuxdo/callback —— Linux Do OAuth2 回调
func (h *Handler) LinuxDoCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	code := q.Get("code")
	state := q.Get("state")

	// OAuth 提供商返回的错误（用户拒绝授权等）
	if errCode := q.Get("error"); errCode != "" {
		linuxDoFailRedirect(w, r, "Linux Do 授权失败："+errCode)
		return
	}
	if code == "" || state == "" {
		linuxDoFailRedirect(w, r, "缺少授权参数")
		return
	}

	// 校验并消费 state（一次性，防 CSRF）
	if h.Redis == nil {
		linuxDoFailRedirect(w, r, "服务暂不可用")
		return
	}
	returnTo, ok, err := h.Redis.GetOAuthState(ctx, state)
	if err != nil || !ok {
		linuxDoFailRedirect(w, r, "登录状态已过期，请重试")
		return
	}
	h.Redis.DelOAuthState(ctx, state)
	if !strings.HasPrefix(returnTo, "/") || strings.HasPrefix(returnTo, "//") {
		returnTo = "/"
	}

	_, oc := h.loadOAuthConfig()
	if !oc.LinuxDoEnabled || oc.LinuxDoClientID == "" || oc.LinuxDoClientSecret == "" {
		linuxDoFailRedirect(w, r, "Linux Do 登录未正确配置")
		return
	}

	redirectURI := externalBaseURL(r) + "/api/auth/linuxdo/callback"

	// 1. 用授权码换 access_token
	accessToken, err := linuxDoExchange(ctx, oc.LinuxDoClientID, oc.LinuxDoClientSecret, code, redirectURI)
	if err != nil {
		log.Printf("[linuxdo] token exchange failed: %v", err)
		linuxDoFailRedirect(w, r, "Linux Do 登录失败（换取令牌失败）")
		return
	}

	// 2. 拉取用户信息
	ldu, err := linuxDoFetchUser(ctx, accessToken)
	if err != nil {
		log.Printf("[linuxdo] fetch user failed: %v", err)
		linuxDoFailRedirect(w, r, "Linux Do 登录失败（获取用户信息失败）")
		return
	}

	// 3. 信任等级 / 状态校验
	if !ldu.Active || ldu.Silenced {
		linuxDoFailRedirect(w, r, "该 Linux Do 账号未激活或已被禁言")
		return
	}
	if oc.LinuxDoMinTrustLevel > 0 && ldu.TrustLevel < oc.LinuxDoMinTrustLevel {
		linuxDoFailRedirect(w, r, fmt.Sprintf("Linux Do 信任等级不足（需 ≥ %d，当前 %d）", oc.LinuxDoMinTrustLevel, ldu.TrustLevel))
		return
	}

	// 4. find-or-create 本站账号
	avatarURL := linuxDoAvatarURL(ldu.AvatarTemplate)
	user, err := h.MySQL.GetUserByLinuxDoID(ldu.ID)
	if err != nil {
		log.Printf("[linuxdo] lookup user failed: %v", err)
		linuxDoFailRedirect(w, r, "登录失败，请重试")
		return
	}
	if user == nil {
		// 首次登录：自动建号。显示名优先用 name，回退 username。
		displayName := ldu.Name
		if displayName == "" {
			displayName = ldu.Username
		}
		newID, cerr := h.MySQL.CreateUserWithLinuxDo(ldu.ID, displayName, avatarURL)
		if cerr != nil {
			log.Printf("[linuxdo] create user failed: %v", cerr)
			linuxDoFailRedirect(w, r, "账号创建失败，请重试")
			return
		}
		// 自动创建默认 API Key（与邮箱注册流程一致）
		h.MySQL.CreateAPIKey(newID, "Default")
		user, err = h.MySQL.GetUserByLinuxDoID(ldu.ID)
		if err != nil || user == nil {
			linuxDoFailRedirect(w, r, "登录失败，请重试")
			return
		}
	} else if avatarURL != "" && avatarURL != user.Avatar {
		h.MySQL.UpdateUserAvatar(user.ID, avatarURL)
		user.Avatar = avatarURL
	}

	// 5. 封禁校验
	if !user.Status {
		reason := user.BanReason
		if reason == "" {
			reason = "账号已被禁用"
		}
		linuxDoFailRedirect(w, r, reason)
		return
	}

	// 6. 签发本站 token（复用 auth_login.go:210-214 同款方式）
	tokenBytes := make([]byte, 32)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)
	h.Redis.SetToken(ctx, "user:"+token, user.ID, 24*time.Hour)

	// 标注是否为 superadmin（按 .env 邮箱实时判定，不入库），供前端显示后台入口
	user.IsSuperAdmin = middleware.IsSuperAdminEmail(user.Email)

	userJSON, _ := json.Marshal(user)
	dest := fmt.Sprintf("/auth/linuxdo?token=%s&user=%s&return_to=%s",
		url.QueryEscape(token),
		url.QueryEscape(string(userJSON)),
		url.QueryEscape(returnTo),
	)
	http.Redirect(w, r, dest, http.StatusFound)
}

// linuxDoHTTPClient 构造访问 Linux Do 的 HTTP 客户端。
// 大陆网络下 connect.linux.do 直连通常超时，需走代理：
// 代理优先级与 OpenAI 后端一致 —— HTTPS_PROXY/HTTP_PROXY 环境变量 > 直连。
// （http.ProxyFromEnvironment 自动读 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY）
func linuxDoHTTPClient() *http.Client {
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment},
	}
}

// linuxDoExchange 用授权码向 Linux Do 换取 access_token（标准 OAuth2 token 端点）。
// Linux Do Connect 基于 Discourse，遵循 RFC 6749：client 凭证放在 HTTP Basic Auth 头，
// 而非 form body（Discourse 不接受 body 内的 client_secret，会导致换码失败）。
func linuxDoExchange(ctx context.Context, clientID, clientSecret, code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, linuxDoTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	// client 凭证走 HTTP Basic Auth（base64(client_id:client_secret)）
	req.SetBasicAuth(clientID, clientSecret)

	resp, err := linuxDoHTTPClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint status %d: %s", resp.StatusCode, string(body))
	}

	var tok struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("empty access_token in response: %s", string(body))
	}
	return tok.AccessToken, nil
}

// linuxDoFetchUser 用 access_token 拉取 Linux Do 用户信息。
func linuxDoFetchUser(ctx context.Context, accessToken string) (*linuxDoUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, linuxDoUserURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := linuxDoHTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("user endpoint status %d: %s", resp.StatusCode, string(body))
	}

	var u linuxDoUser
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, err
	}
	if u.ID == 0 {
		return nil, fmt.Errorf("invalid user payload: %s", string(body))
	}
	return &u, nil
}

// linuxDoFailRedirect 出错时 302 回登录页并带 error 文案（前端 toast 提示）。
func linuxDoFailRedirect(w http.ResponseWriter, r *http.Request, msg string) {
	http.Redirect(w, r, "/login?oauth_error="+url.QueryEscape(msg), http.StatusFound)
}
