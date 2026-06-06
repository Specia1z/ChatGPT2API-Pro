package api

import (
	"encoding/json"
	"testing"

	"chatgpt2api-pro/internal/model"
)

func TestValidEmail(t *testing.T) {
	cases := []struct {
		email string
		want  bool
	}{
		{"foo@example.com", true},
		{"foo.bar+tag@gmail.com", true},
		{"a@b.co", true},
		{"", false},
		{"foo", false},          // 无 @
		{"foo@", false},         // 空域名
		{"@example.com", false}, // 空本地部分
		{"foo@@bar.com", false}, // 多个 @
		{"foo bar@example.com", false},
		{"foo@example.com ", false}, // 尾部空格（调用方已 Trim，这里仍应拒绝）
	}
	for _, c := range cases {
		if got := validEmail(c.email); got != c.want {
			t.Errorf("validEmail(%q) = %v, want %v", c.email, got, c.want)
		}
	}
}

func TestValidEmailNoPanic(t *testing.T) {
	// 历史 bug：无 @ 邮箱会让后续 LastIndex 切片越界 panic。
	// validEmail 必须在切片前安全拒绝这些输入。
	for _, bad := range []string{"", "noatsign", "a", "@", "trailing@"} {
		if validEmail(bad) {
			t.Errorf("validEmail(%q) 应返回 false", bad)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	on := &model.EmailConfig{NormalizeGmail: true}
	off := &model.EmailConfig{NormalizeGmail: false}

	cases := []struct {
		email string
		ec    *model.EmailConfig
		want  string
	}{
		{"foo.bar@gmail.com", on, "foobar@gmail.com"},
		{"foo+tag@gmail.com", on, "foo@gmail.com"},
		{"foo.bar+tag@googlemail.com", on, "foobar@gmail.com"},
		{"foo.bar@gmail.com", off, "foo.bar@gmail.com"}, // 关闭时不动
		{"foo.bar@outlook.com", on, "foo.bar@outlook.com"}, // 非 gmail 不动
		{"noatsign", on, "noatsign"},                       // 非法输入不 panic
		{"foo@", on, "foo@"},
		{"foo@gmail.com", nil, "foo@gmail.com"}, // nil 配置安全
	}
	for _, c := range cases {
		if got := normalizeEmail(c.email, c.ec); got != c.want {
			t.Errorf("normalizeEmail(%q) = %q, want %q", c.email, got, c.want)
		}
	}
}

func TestRedactEmailConfig(t *testing.T) {
	// 空输入
	if got := redactEmailConfig(""); got != "" {
		t.Errorf("空输入应返回空，得到 %q", got)
	}
	// 无法解析的 JSON 不应外泄原文
	if got := redactEmailConfig("{not json"); got != "" {
		t.Errorf("非法 JSON 应返回空，得到 %q", got)
	}
	// 正常配置：smtp_pass 必须被抹掉，其余保留
	raw, _ := json.Marshal(model.EmailConfig{
		SMTPEnabled: true,
		SMTPHost:    "smtp.example.com",
		SMTPUser:    "user@example.com",
		SMTPPass:    "super-secret",
		SMTPFrom:    "noreply@example.com",
	})
	out := redactEmailConfig(string(raw))
	var ec model.EmailConfig
	if err := json.Unmarshal([]byte(out), &ec); err != nil {
		t.Fatalf("输出无法解析: %v", err)
	}
	if ec.SMTPPass != "" {
		t.Errorf("smtp_pass 未被抹除: %q", ec.SMTPPass)
	}
	if !ec.SMTPEnabled || ec.SMTPHost != "smtp.example.com" || ec.SMTPFrom != "noreply@example.com" {
		t.Errorf("非敏感字段不应被改动: %+v", ec)
	}
}
