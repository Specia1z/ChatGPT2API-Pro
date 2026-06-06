package store

import (
	"encoding/json"
	"testing"

	"chatgpt2api-pro/internal/model"
)

func mustJSON(t *testing.T, ec model.EmailConfig) string {
	t.Helper()
	b, err := json.Marshal(ec)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func passOf(t *testing.T, raw string) string {
	t.Helper()
	if raw == "" {
		return ""
	}
	var ec model.EmailConfig
	if err := json.Unmarshal([]byte(raw), &ec); err != nil {
		t.Fatalf("无法解析: %v", err)
	}
	return ec.SMTPPass
}

func TestMergeEmailConfigSecrets(t *testing.T) {
	withPass := mustJSON(t, model.EmailConfig{SMTPHost: "h", SMTPPass: "old-secret"})
	noPass := mustJSON(t, model.EmailConfig{SMTPHost: "h", SMTPPass: ""})
	newPass := mustJSON(t, model.EmailConfig{SMTPHost: "h", SMTPPass: "new-secret"})

	t.Run("空密码回填时保留旧密码", func(t *testing.T) {
		out := mergeEmailConfigSecrets(noPass, withPass)
		if got := passOf(t, out); got != "old-secret" {
			t.Errorf("期望保留 old-secret，得到 %q", got)
		}
	})

	t.Run("新密码覆盖旧密码", func(t *testing.T) {
		out := mergeEmailConfigSecrets(newPass, withPass)
		if got := passOf(t, out); got != "new-secret" {
			t.Errorf("期望 new-secret，得到 %q", got)
		}
	})

	t.Run("整段缺失时保留旧配置", func(t *testing.T) {
		out := mergeEmailConfigSecrets("", withPass)
		if got := passOf(t, out); got != "old-secret" {
			t.Errorf("期望保留旧配置，得到 %q", got)
		}
	})

	t.Run("旧配置无密码则原样返回", func(t *testing.T) {
		out := mergeEmailConfigSecrets(noPass, noPass)
		if out != noPass {
			t.Errorf("期望原样返回，得到 %q", out)
		}
	})

	t.Run("旧配置为空则原样返回", func(t *testing.T) {
		out := mergeEmailConfigSecrets(newPass, "")
		if out != newPass {
			t.Errorf("期望原样返回 incoming，得到 %q", out)
		}
	})
}
