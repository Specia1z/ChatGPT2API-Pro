package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"chatgpt2api-pro/internal/model"
)

/* ── OpenAI 用户信息 ──────────────────────────────────── */

// UserInfoResult 从 ChatGPT API 获取的账号信息
type UserInfoResult struct {
	Email              string `json:"email"`
	UserID             string `json:"user_id"`
	PlanType           string `json:"plan_type"`
	Quota              int    `json:"quota"`
	ImageQuotaUnknown  bool   `json:"image_quota_unknown"`
	DefaultModelSlug   string `json:"default_model_slug"`
	RestoreAt          string `json:"restore_at"`
	Status             string `json:"status"`
}

// FetchUserInfo 调用 ChatGPT API 获取账号信息（需要 utls transport + proxy）
func FetchUserInfo(accessToken, proxyURL string) (*UserInfoResult, error) {
	transport := getChromeTransport(proxyURL)
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}

	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	baseHdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent":            ua,
			"Origin":                "https://chatgpt.com",
			"Referer":               "https://chatgpt.com/",
			"OAI-Device-Id":         deviceID,
			"Authorization":         "Bearer " + accessToken,
			"X-OpenAI-Target-Path":  path,
			"X-OpenAI-Target-Route": path,
		}
	}

	doGet := func(path string) (map[string]any, error) {
		req, _ := http.NewRequest("GET", "https://chatgpt.com"+path, nil)
		for k, v := range baseHdr(path) { req.Header.Set(k, v) }
		resp, err := client.Do(req)
		if err != nil { return nil, err }
		defer resp.Body.Close()
		if resp.StatusCode == 401 { return nil, fmt.Errorf("token banned (401)") }
		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body[:minI(200, len(body))]))
		}
		var data map[string]any
		json.NewDecoder(resp.Body).Decode(&data)
		return data, nil
	}

	// 并行调 3 个 API
	var wg sync.WaitGroup
	var meData, initData, acctData map[string]any
	var meErr, initErr, acctErr error

	wg.Add(3)
	go func() { defer wg.Done(); meData, meErr = doGet("/backend-api/me") }()
	go func() {
		defer wg.Done()
		payload := `{"gizmo_id":null,"requested_default_model":null,"conversation_id":null,"timezone_offset_min":-480}`
		req, _ := http.NewRequest("POST", "https://chatgpt.com/backend-api/conversation/init", strings.NewReader(payload))
		for k, v := range baseHdr("/backend-api/conversation/init") { req.Header.Set(k, v) }
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil { initErr = err; return }
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(resp.Body)
			initErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			_ = body
			return
		}
		json.NewDecoder(resp.Body).Decode(&initData)
	}()
	go func() {
		defer wg.Done()
		acctData, acctErr = doGet("/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480")
	}()
	wg.Wait()

	if meErr != nil { return nil, fmt.Errorf("me: %w", meErr) }
	if initErr != nil { return nil, fmt.Errorf("init: %w", initErr) }
	if acctErr != nil { return nil, fmt.Errorf("account: %w", acctErr) }

	result := &UserInfoResult{}

	// /me → email, user_id
	if meData != nil {
		result.Email, _ = meData["email"].(string)
		result.UserID = fmt.Sprintf("%v", meData["id"])
	}

	// /accounts/check → plan_type
	if acctData != nil {
		if accounts, ok := acctData["accounts"].(map[string]any); ok {
			if def, ok := accounts["default"].(map[string]any); ok {
				if acc, ok := def["account"].(map[string]any); ok {
					result.PlanType, _ = acc["plan_type"].(string)
				}
			}
		}
	}
	if result.PlanType == "" { result.PlanType = "free" }

	// /conversation/init → quota, default_model_slug
	if initData != nil {
		result.DefaultModelSlug, _ = initData["default_model_slug"].(string)
		if limits, ok := initData["limits_progress"].([]any); ok {
			for _, item := range limits {
				lm, ok := item.(map[string]any)
				if !ok { continue }
				if fn, _ := lm["feature_name"].(string); fn != "image_gen" { continue }
				if rem, ok := lm["remaining"].(float64); ok { result.Quota = int(rem) }
				if ra, ok := lm["reset_after"].(string); ok { result.RestoreAt = ra }
				result.ImageQuotaUnknown = false
				break
			}
		}
		if result.ImageQuotaUnknown && result.Quota == 0 {
			result.ImageQuotaUnknown = true
		}
	}

	// 状态判定
	if result.ImageQuotaUnknown && strings.ToLower(result.PlanType) != "free" {
		result.Status = "正常"
	} else if result.Quota == 0 && !result.ImageQuotaUnknown {
		result.Status = "限流"
	} else {
		result.Status = "正常"
	}

	return result, nil
}

// getChromeTransport 创建带 utls 的 transport
func getChromeTransport(proxyURL string) http.RoundTripper {
	// 优先用传入的代理，否则读环境变量
	if proxyURL == "" {
		proxyURL = os.Getenv("HTTPS_PROXY")
	}
	if proxyURL == "" {
		proxyURL = os.Getenv("HTTP_PROXY")
	}
	if proxyURL == "" {
		proxyURL = "http://127.0.0.1:10808"
	}
	u, _ := url.Parse(proxyURL)
	return newChromeTransportFromURL(u)
}

func minI(a, b int) int { if a < b { return a }; return b }

// ── 刷新账号信息 ────────────────────────────────────────

// RefreshAccount 刷新单个账号
func RefreshAccount(acc *model.Account, proxyURL string) error {
	info, err := FetchUserInfo(acc.AccessToken, proxyURL)
	if err != nil {
		return err
	}
	acc.Email = info.Email
	acc.UserID = info.UserID
	acc.PlanType = info.PlanType
	acc.Quota = info.Quota
	acc.ImageQuotaUnknown = info.ImageQuotaUnknown
	acc.DefaultModelSlug = info.DefaultModelSlug
	acc.RestoreAt = info.RestoreAt
	acc.Status = info.Status
	return nil
}

// convertToString converts any to string for DB updates
func convertToString(v any) string { return fmt.Sprintf("%v", v) }

// strVal is a helper
func strVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok { return v }
	if v, ok := m[key].(float64); ok { return strconv.FormatFloat(v, 'f', -1, 64) }
	return ""
}
