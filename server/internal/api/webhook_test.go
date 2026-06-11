package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// TestValidateWebhookURL 校验保存时的前置 SSRF/协议拦截（纯函数，无依赖）。
func TestValidateWebhookURL(t *testing.T) {
	cases := []struct {
		url string
		ok  bool // true=应通过（返回空错误）
	}{
		{"https://example.com/webhook", true},
		{"http://example.com:8080/cb", true},
		{"https://api.myserver.io/hooks/img", true},
		{"", false},                          // 空（注：handler 对空 URL 不调本函数，但函数本身应判错）
		{"ftp://example.com", false},         // 非 http/https
		{"ws://example.com", false},          // 非 http/https
		{"https://localhost/cb", false},      // localhost
		{"http://127.0.0.1:9000/cb", false},  // loopback 字面 IP
		{"http://10.1.2.3/cb", false},        // 内网字面 IP
		{"http://169.254.169.254/latest", false}, // 云元数据
		{"http://192.168.0.1", false},        // 内网
		{"not-a-url", false},                 // 无协议/主机
	}
	for _, c := range cases {
		msg := validateWebhookURL(c.url)
		gotOK := msg == ""
		if gotOK != c.ok {
			t.Errorf("validateWebhookURL(%q) ok=%v (msg=%q), want ok=%v", c.url, gotOK, msg, c.ok)
		}
	}
}

// TestSignedImageURLWithBase 验证 webhook payload 里的 image_url 拼接正确，
// 且签名能被 verifyImageSig 反向验证通过（与回调消费方拿到链接后能正常下载图片闭环一致）。
func TestSignedImageURLWithBase(t *testing.T) {
	const base = "https://cdn.example.com"
	const genID int64 = 12345
	u := signedImageURLWithBase(base, genID)

	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("生成的 URL 不可解析: %v", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "cdn.example.com" {
		t.Errorf("scheme/host 不符: %s", u)
	}
	if parsed.Path != "/api/images/12345" {
		t.Errorf("path 不符: %s", parsed.Path)
	}
	q := parsed.Query()
	exp, sig := q.Get("exp"), q.Get("sig")
	if exp == "" || sig == "" {
		t.Fatalf("缺少 exp/sig: %s", u)
	}
	// 闭环：用 verifyImageSig 反验证（回调方拿此 URL GET 图片时服务端正是这样校验的）
	if !verifyImageSig(genID, exp, sig) {
		t.Errorf("签名无法通过 verifyImageSig 验证: %s", u)
	}
	// 篡改 genID 应验证失败
	if verifyImageSig(genID+1, exp, sig) {
		t.Error("不同 genID 不应通过同一签名")
	}
}

// TestWebhookCRUD 端到端走 handler：保存→读取(抹密钥)→空密钥保留旧值→停用→删除。
// 需要本机 MySQL，连不上则 skip。
func TestWebhookCRUD(t *testing.T) {
	mysql, err := store.NewMySQLStore("root:@tcp(127.0.0.1:3306)/chatgpt2api_pro?parseTime=true")
	if err != nil {
		t.Skipf("MySQL not available: %v", err)
	}
	defer mysql.Close()

	h := &Handler{MySQL: mysql}
	const uid int64 = 999999001 // 用一个极不可能撞真实用户的测试 ID
	defer mysql.RawExec("DELETE FROM user_webhooks WHERE user_id=?", uid)
	mysql.RawExec("DELETE FROM user_webhooks WHERE user_id=?", uid) // 预清理

	ctxWith := func(r *bytes.Reader, method string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/user/webhook", r)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, uid))
		w := httptest.NewRecorder()
		switch method {
		case "POST":
			h.SaveWebhook(w, req)
		case "GET":
			h.GetWebhook(w, req)
		case "DELETE":
			h.DeleteWebhook(w, req)
		}
		return w
	}
	decodeWebhook := func(t *testing.T, w *httptest.ResponseRecorder) *model.UserWebhook {
		t.Helper()
		var resp struct {
			Code int                `json:"code"`
			Data *model.UserWebhook `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("解析响应失败: %v (body=%s)", err, w.Body.String())
		}
		return resp.Data
	}

	// 1. 保存带 secret 的 webhook
	saveBody, _ := json.Marshal(map[string]any{"url": "https://example.com/cb", "secret": "s3cr3t", "enabled": true})
	if w := ctxWith(bytes.NewReader(saveBody), "POST"); w.Code != 200 {
		t.Fatalf("保存失败 code=%d body=%s", w.Code, w.Body.String())
	}

	// 2. 读取：URL/enabled 正确，secret 抹除但 has_secret=true
	wh := decodeWebhook(t, ctxWith(bytes.NewReader(nil), "GET"))
	if wh == nil || wh.URL != "https://example.com/cb" || !wh.Enabled {
		t.Fatalf("读取不符: %+v", wh)
	}
	if wh.Secret != "" {
		t.Errorf("GET 不应回显 secret 明文，得到 %q", wh.Secret)
	}
	if !wh.HasSecret {
		t.Error("has_secret 应为 true")
	}

	// 3. 空 secret 保存：应保留旧 secret（不被清空），并能改 URL/enabled
	save2, _ := json.Marshal(map[string]any{"url": "https://example.com/cb2", "secret": "", "enabled": false})
	if w := ctxWith(bytes.NewReader(save2), "POST"); w.Code != 200 {
		t.Fatalf("二次保存失败 code=%d", w.Code)
	}
	got, _ := mysql.GetUserWebhook(uid)
	if got == nil || got.Secret != "s3cr3t" {
		t.Errorf("空 secret 保存应保留旧值 s3cr3t，得到 %+v", got)
	}
	if got.URL != "https://example.com/cb2" || got.Enabled {
		t.Errorf("URL/enabled 未更新: %+v", got)
	}

	// 4. 投递结果回写
	mysql.UpdateWebhookDeliveryResult(uid, 200, "")
	got, _ = mysql.GetUserWebhook(uid)
	if got.LastStatus != 200 || got.LastError != "" || got.LastDeliverAt == "" {
		t.Errorf("投递结果回写不符: status=%d err=%q at=%q", got.LastStatus, got.LastError, got.LastDeliverAt)
	}
	// 失败结果 + 超长错误截断（500 字符）
	longErr := ""
	for i := 0; i < 600; i++ {
		longErr += "x"
	}
	mysql.UpdateWebhookDeliveryResult(uid, 0, longErr)
	got, _ = mysql.GetUserWebhook(uid)
	if len(got.LastError) != 500 {
		t.Errorf("错误信息应截断到 500，得到 %d", len(got.LastError))
	}

	// 5. 拒绝内网 URL
	badBody, _ := json.Marshal(map[string]any{"url": "http://127.0.0.1/cb", "secret": "", "enabled": true})
	if w := ctxWith(bytes.NewReader(badBody), "POST"); w.Code != 400 {
		t.Errorf("内网 URL 应被拒(400)，得到 %d", w.Code)
	}

	// 6. 删除
	if w := ctxWith(bytes.NewReader(nil), "DELETE"); w.Code != 200 {
		t.Fatalf("删除失败 code=%d", w.Code)
	}
	got, _ = mysql.GetUserWebhook(uid)
	if got != nil {
		t.Errorf("删除后应为 nil，得到 %+v", got)
	}
}
