package service

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

func openTestDB(t *testing.T, dsn string) *sql.DB {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Logf("打开 DB 失败: %v", err)
		return nil
	}
	if err := db.Ping(); err != nil {
		t.Logf("连接 DB 失败: %v", err)
		db.Close()
		return nil
	}
	return db
}

// TestSVGGeneration 手动验证：用数据库里现有 access token，走 ChatGPT 文本对话接口，
// 让模型「生成一段 SVG」，看回复里是否含 <svg>。
// 需要：本地 MySQL(127.0.0.1:3306/chatgpt2api_pro) + 可用 token + 代理(HTTPS_PROXY)。
// 运行：HTTPS_PROXY=http://127.0.0.1:10808 go test ./internal/service/ -run TestSVGGeneration -v -timeout 300s
func TestSVGGeneration(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		dsn = "root:@tcp(127.0.0.1:3306)/chatgpt2api_pro?parseTime=true"
	}
	token := fetchOneAccessToken(t, dsn)
	if token == "" {
		t.Skip("无可用 access token")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 280*time.Second)
	defer cancel()

	// 先列出该账号可用的模型 slug
	models := listModels(ctx, t, token)
	if len(models) > 0 {
		t.Logf("===== 账号可用模型(%d) =====", len(models))
		for _, m := range models {
			t.Logf("  %s", m)
		}
	}

	prompt := "请用 SVG 画一个简单的红色圆形，只输出 SVG 代码，不要任何解释。"
	model := os.Getenv("SVG_MODEL")
	if model == "" {
		model = "auto"
	}
	t.Logf("使用模型: %s", model)
	reply, err := chatOnce(ctx, t, token, model, prompt)
	if err != nil {
		t.Fatalf("对话失败: %v", err)
	}
	t.Logf("===== 模型回复(前 800 字) =====\n%s", reply[:minI(800, len(reply))])

	if strings.Contains(strings.ToLower(reply), "<svg") {
		t.Logf("✅ 检测到 <svg>，GPT 可以生成 SVG 代码")
	} else {
		t.Errorf("❌ 回复中未发现 <svg> 标签")
	}
}

// TestChatModels 探测指定模型 slug 是否可用（gpt-5.3 / gpt-5.4 等）。
// 用法：HTTPS_PROXY=http://127.0.0.1:10808 go test ./internal/service/ -run TestChatModels -v -timeout 300s
func TestChatModels(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		dsn = "root:@tcp(127.0.0.1:3306)/chatgpt2api_pro?parseTime=true"
	}
	token := fetchOneAccessToken(t, dsn)
	if token == "" {
		t.Skip("无可用 access token")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 280*time.Second)
	defer cancel()

	avail := listModels(ctx, t, token)
	t.Logf("===== 账号可用模型(%d) =====", len(avail))
	for _, m := range avail {
		t.Logf("  %s", m)
	}

	// 候选 slug（含用户问到的 5.3 / 5.4，及常见命名变体）
	candidates := []string{"gpt-5.3", "gpt-5.4", "gpt-5", "gpt-5.2", "gpt-5.1", "gpt-4o", "auto"}
	if env := os.Getenv("PROBE_MODELS"); env != "" {
		candidates = strings.Split(env, ",")
	}
	for _, m := range candidates {
		m = strings.TrimSpace(m)
		reply, err := chatOnce(ctx, t, token, m, "只回复两个字：你好")
		if err != nil {
			t.Logf("  ❌ %-12s 不可用: %v", m, err)
			continue
		}
		preview := strings.ReplaceAll(reply, "\n", " ")
		t.Logf("  ✅ %-12s 可用 → %s", m, preview[:minI(40, len(preview))])
	}
}

// listModels 拉取 /backend-api/models，返回 slug 列表。
func listModels(ctx context.Context, t *testing.T, accessToken string) []string {
	transport := getChromeTransport("")
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/backend-api/models?history_and_training_disabled=false", nil)
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Origin", "https://chatgpt.com")
	req.Header.Set("Referer", "https://chatgpt.com/")
	req.Header.Set("OAI-Device-Id", newUUID())
	resp, err := client.Do(req)
	if err != nil {
		t.Logf("拉取模型列表失败: %v", err)
		return nil
	}
	defer resp.Body.Close()
	var data struct {
		Models []struct {
			Slug  string `json:"slug"`
			Title string `json:"title"`
		} `json:"models"`
	}
	json.NewDecoder(resp.Body).Decode(&data)
	var out []string
	for _, m := range data.Models {
		out = append(out, fmt.Sprintf("%s (%s)", m.Slug, m.Title))
	}
	return out
}

// fetchOneAccessToken 直接从 accounts 表取一个正常账号的 token（不引入 store 依赖，裸 SQL）。
func fetchOneAccessToken(t *testing.T, dsn string) string {
	db := openTestDB(t, dsn)
	if db == nil {
		return ""
	}
	defer db.Close()
	var tok string
	row := db.QueryRow("SELECT access_token FROM accounts WHERE status IN ('正常','') AND access_token LIKE 'eyJ%' ORDER BY id DESC LIMIT 1")
	if err := row.Scan(&tok); err != nil {
		// 放宽条件再试一次
		if err2 := db.QueryRow("SELECT access_token FROM accounts ORDER BY id DESC LIMIT 1").Scan(&tok); err2 != nil {
			t.Logf("查询 token 失败: %v / %v", err, err2)
			return ""
		}
	}
	return tok
}

// chatOnce 走完整 ChatGPT 后端文本对话流程（复用生图同款原语，但用文本模型、无 picture_v2），
// 返回助手最终文本回复。
func chatOnce(ctx context.Context, t *testing.T, accessToken, model, prompt string) (string, error) {
	transport := getChromeTransport("") // 读 HTTPS_PROXY 环境变量
	client := &http.Client{Transport: transport, Timeout: 180 * time.Second}
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	deviceID := newUUID()

	hdr := func(path string) map[string]string {
		return map[string]string{
			"User-Agent": ua, "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
			"Authorization": "Bearer " + accessToken, "OAI-Device-Id": deviceID,
			"X-OpenAI-Target-Path": path, "X-OpenAI-Target-Route": path,
		}
	}

	// Step 1: bootstrap
	if r, _ := http.NewRequestWithContext(ctx, "GET", "https://chatgpt.com/", nil); r != nil {
		r.Header.Set("User-Agent", ua)
		if resp, err := client.Do(r); err == nil {
			resp.Body.Close()
		}
	}
	// Step 2: requirements + PoW
	reqs, err := doPost(ctx, client, "/backend-api/sentinel/chat-requirements", map[string]string{"p": buildLegacyToken(ua)}, hdr, "", "", "")
	if err != nil {
		return "", fmt.Errorf("requirements: %w", err)
	}
	sentinel, _ := reqs["token"].(string)
	proof := solvePoWIfNeeded(reqs, ua)

	// Step 3: 纯文本对话（model=auto，不带 picture_v2 / 不带 prepare）
	msg := map[string]any{
		"id":      newUUID(),
		"author":  map[string]string{"role": "user"},
		"content": map[string]any{"content_type": "text", "parts": []string{prompt}},
	}
	payload := map[string]any{
		"action":                        "next",
		"messages":                      []map[string]any{msg},
		"parent_message_id":             newUUID(),
		"model":                         model,
		"timezone_offset_min":           -480,
		"conversation_mode":             map[string]string{"kind": "primary_assistant"},
		"history_and_training_disabled": true,
	}
	// Step 3+4: 文本对话走 SSE，直接从流里读助手增量文本（文本回复在流内，不靠轮询）
	txt, err := sseChatText(ctx, client, "/backend-api/f/conversation", payload, hdr, sentinel, proof)
	if err != nil || txt == "" {
		// 回退旧路径
		txt, err = sseChatText(ctx, client, "/backend-api/conversation", payload, hdr, sentinel, proof)
	}
	if err != nil {
		return "", fmt.Errorf("sse: %w", err)
	}
	if txt == "" {
		return "", fmt.Errorf("流中未取到助手文本")
	}
	return txt, nil
}

// sseChatText 发起对话并从 SSE 流逐条解析，累积 assistant 的文本回复。
func sseChatText(ctx context.Context, client *http.Client, path string, payload any, hdrFn func(string) map[string]string, sentinel, proof string) (string, error) {
	j, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://chatgpt.com"+path, strings.NewReader(string(j)))
	for k, v := range hdrFn(path) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if sentinel != "" {
		req.Header.Set("OpenAI-Sentinel-Chat-Requirements-Token", sentinel)
	}
	if proof != "" {
		req.Header.Set("OpenAI-Sentinel-Proof-Token", proof)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b[:minI(300, len(b))]))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	last := ""
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var ev map[string]any
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		// 取 message.content.parts 累积文本（流式全量快照，后到的更完整）
		msg, _ := ev["message"].(map[string]any)
		if msg == nil {
			if v, _ := ev["v"].(map[string]any); v != nil {
				msg, _ = v["message"].(map[string]any)
			}
		}
		if msg == nil {
			continue
		}
		author, _ := msg["author"].(map[string]any)
		if role, _ := author["role"].(string); role != "assistant" {
			continue
		}
		content, _ := msg["content"].(map[string]any)
		if content == nil {
			continue
		}
		parts, _ := content["parts"].([]any)
		var sb strings.Builder
		for _, p := range parts {
			if s, ok := p.(string); ok {
				sb.WriteString(s)
			}
		}
		if s := sb.String(); s != "" {
			last = s
		}
	}
	return strings.TrimSpace(last), nil
}
