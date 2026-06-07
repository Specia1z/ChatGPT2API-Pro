package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"chatgpt2api-pro/internal/store"
)

// drive 把 n 个请求依次打到 UserRateLimit 包裹的 handler，返回放行(200)次数。
// ctx 携带 UserIDKey / RateLimitKey，模拟 ApiKeyAuth 之后的状态。
func drive(mw func(http.Handler) http.Handler, ctx context.Context, n int) int {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	h := mw(ok)
	passed := 0
	for i := 0; i < n; i++ {
		req := httptest.NewRequest("POST", "/api/v1/images/generations", nil).WithContext(ctx)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == 200 {
			passed++
		}
	}
	return passed
}

// TestUserRateLimitPlanOverride 覆盖本次改动核心：
// 套餐 rate_limit_per_min(RateLimitKey>0) 覆盖兜底默认；0/缺失则用默认。
func TestUserRateLimitPlanOverride(t *testing.T) {
	s, err := store.NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	// 窗口给足够长（本测试只看一个窗口内的计数，不依赖过期）
	window := time.Hour
	// 内置兜底基线（对应 router 里的 30/min，这里用小值便于快速跑满）
	const def = 5

	// 复位后台默认（包级全局），保证子测试不受先后顺序影响
	SetDefaultUserRate(0)
	defer SetDefaultUserRate(0)

	uidBase := time.Now().UnixNano()

	t.Run("无套餐_无后台默认_用内置兜底", func(t *testing.T) {
		uid := uidBase + 1
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, def+3)
		t.Logf("内置兜底 limit=%d → 放行=%d", def, passed)
		if passed != def {
			t.Errorf("应按内置兜底 %d 放行, got %d", def, passed)
		}
	})

	t.Run("套餐值高于默认_放宽", func(t *testing.T) {
		uid := uidBase + 2
		const plan = 12
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		ctx = context.WithValue(ctx, RateLimitKey, plan)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, plan+3)
		t.Logf("套餐 limit=%d(默认%d) → 放行=%d", plan, def, passed)
		if passed != plan {
			t.Errorf("套餐值应覆盖默认, 期望放行 %d, got %d", plan, passed)
		}
	})

	t.Run("套餐值低于默认_收紧", func(t *testing.T) {
		uid := uidBase + 3
		const plan = 2
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		ctx = context.WithValue(ctx, RateLimitKey, plan)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, def+3)
		t.Logf("套餐 limit=%d(默认%d) → 放行=%d", plan, def, passed)
		if passed != plan {
			t.Errorf("套餐值低于默认应收紧到 %d, got %d", plan, passed)
		}
	})

	t.Run("套餐值为0_回退内置兜底", func(t *testing.T) {
		uid := uidBase + 4
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		ctx = context.WithValue(ctx, RateLimitKey, 0)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, def+3)
		t.Logf("套餐 limit=0(兜底%d) → 放行=%d", def, passed)
		if passed != def {
			t.Errorf("套餐值为0应回退内置兜底 %d, got %d", def, passed)
		}
	})

	t.Run("后台默认覆盖内置兜底", func(t *testing.T) {
		const adminDef = 8
		SetDefaultUserRate(adminDef)
		defer SetDefaultUserRate(0)
		uid := uidBase + 5
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, adminDef+3)
		t.Logf("后台默认=%d(兜底%d) → 放行=%d", adminDef, def, passed)
		if passed != adminDef {
			t.Errorf("后台默认应覆盖内置兜底, 期望放行 %d, got %d", adminDef, passed)
		}
	})

	t.Run("套餐值优先于后台默认", func(t *testing.T) {
		const adminDef, plan = 8, 3
		SetDefaultUserRate(adminDef)
		defer SetDefaultUserRate(0)
		uid := uidBase + 6
		ctx := context.WithValue(context.Background(), UserIDKey, uid)
		ctx = context.WithValue(ctx, RateLimitKey, plan)
		mw := UserRateLimit(s, def, window)
		passed := drive(mw, ctx, adminDef+3)
		t.Logf("套餐=%d 后台默认=%d → 放行=%d", plan, adminDef, passed)
		if passed != plan {
			t.Errorf("套餐值应优先, 期望放行 %d, got %d", plan, passed)
		}
	})

	t.Log("✅ 套餐限速 / 后台默认 / 内置兜底 三级优先级验证通过")
}

// TestUserRateLimitPerUserIsolation 验证不同 uid 各自独立计数，
// 防止一个 Key 跑满影响其他用户（同时也是“按 uid 而非 IP”的回归保护）。
func TestUserRateLimitPerUserIsolation(t *testing.T) {
	s, err := store.NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	const def = 3
	window := time.Hour
	base := time.Now().UnixNano()
	uidA, uidB := base+10, base+11
	mw := UserRateLimit(s, def, window)

	// A 跑满
	ctxA := context.WithValue(context.Background(), UserIDKey, uidA)
	if p := drive(mw, ctxA, def+2); p != def {
		t.Fatalf("A 应放行 %d, got %d", def, p)
	}
	// B 不受 A 影响，仍有完整额度
	ctxB := context.WithValue(context.Background(), UserIDKey, uidB)
	if p := drive(mw, ctxB, def); p != def {
		t.Errorf("B 应独立计数放行 %d, got %d", def, p)
	}
	t.Log("✅ 按 uid 独立限流验证通过")
}

// TestUserRateLimitNilRedis 验证 Redis 缺失时降级放行（不阻断业务）。
func TestUserRateLimitNilRedis(t *testing.T) {
	mw := UserRateLimit(nil, 1, time.Minute)
	ctx := context.WithValue(context.Background(), UserIDKey, int64(1))
	if p := drive(mw, ctx, 10); p != 10 {
		t.Errorf("redis=nil 应全部降级放行, got %d", p)
	}
	t.Log("✅ Redis 缺失降级放行验证通过")
}
