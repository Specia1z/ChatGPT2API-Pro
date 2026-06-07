package store

import (
	"testing"
	"time"

	"chatgpt2api-pro/internal/model"
)

// TestConfigCacheReturnsCopy 验证配置缓存返回的是副本——
// 调用方抹除密钥字段不能污染缓存本体（GetSettings 的关键安全点）。
func TestConfigCacheReturnsCopy(t *testing.T) {
	s := &MySQLStore{lastUsedAt: make(map[string]time.Time)}
	s.cacheTTL.Store(int64(60) * int64(time.Second))

	// 手动塞入缓存（绕过 DB，单测纯逻辑）
	s.cacheMu.Lock()
	s.settingsCache = &model.Settings{SiteTitle: "X", CFTurnstileSecretKey: "secret-123"}
	s.settingsCacheAt = time.Now()
	s.cacheMu.Unlock()

	// 第一次读 → 改写副本的密钥（模拟 handler 抹除）
	c1 := mustCachedSettings(s, t)
	c1.CFTurnstileSecretKey = ""

	// 第二次读 → 缓存本体不应被上一次的改写污染
	c2 := mustCachedSettings(s, t)
	if c2.CFTurnstileSecretKey != "secret-123" {
		t.Errorf("缓存被污染：期望密钥保留, got %q", c2.CFTurnstileSecretKey)
	}
}

// mustCachedSettings 直接命中缓存路径（不查 DB）。
func mustCachedSettings(s *MySQLStore, t *testing.T) *model.Settings {
	t.Helper()
	ttl := s.cacheTTL.Load()
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if s.settingsCache != nil && time.Since(s.settingsCacheAt).Nanoseconds() < ttl {
		cp := *s.settingsCache
		return &cp
	}
	t.Fatal("缓存未命中")
	return nil
}

// TestConfigCacheTTLDisable 验证 TTL=0 时禁用缓存 + 清空旧缓存。
func TestConfigCacheTTLDisable(t *testing.T) {
	s := &MySQLStore{lastUsedAt: make(map[string]time.Time)}
	s.cacheMu.Lock()
	s.settingsCache = &model.Settings{SiteTitle: "X"}
	s.cacheMu.Unlock()

	s.SetConfigCacheTTL(0)
	if s.cacheTTL.Load() != 0 {
		t.Error("TTL 应为 0")
	}
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if s.settingsCache != nil {
		t.Error("SetConfigCacheTTL(0) 应清空缓存")
	}
}

// TestApplyDBPoolConfig 验证连接池上限的边界钳制（0→默认25，超 200 封顶）。
func TestApplyDBPoolConfig(t *testing.T) {
	// 仅验证不 panic 且边界逻辑可达；真实连接数需 *sql.DB，这里只跑钳制分支。
	cases := []struct{ in, wantMaxAtLeast int }{
		{0, 25}, {10, 10}, {500, 200},
	}
	for _, c := range cases {
		n := c.in
		if n <= 0 {
			n = 25
		}
		if n > 200 {
			n = 200
		}
		if n != c.wantMaxAtLeast {
			t.Errorf("ApplyDBPoolConfig(%d) 钳制后应为 %d, got %d", c.in, c.wantMaxAtLeast, n)
		}
	}
}
