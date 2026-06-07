package store

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestTokenBucket(t *testing.T) {
	// 需要本地 Redis: localhost:6379
	s, err := NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	userID := int64(99999)
	capacity := 10
	refillRate := 3 // 每小时 3 个

	// 清理
	s.client.Del(context.Background(), "bucket:99999")

	// ── Test 1: 初始满桶 ──
	rem, _, ok, wait, err := s.ConsumeToken(userID, capacity, refillRate, 1)
	if err != nil { t.Fatal(err) }
	t.Logf("T1 消耗1个 → 剩余=%.0f ok=%v wait=%ds", rem, ok, wait)
	if !ok { t.Error("初始桶应有令牌") }
	if rem < 9 { t.Errorf("剩余应≥9, got %.0f", rem) }

	// ── Test 2: 连续消耗 9 个（用完桶）──
	for i := 0; i < 9; i++ {
		rem, _, ok, _, _ = s.ConsumeToken(userID, capacity, refillRate, 1)
		t.Logf("T2 消耗 #%d → 剩余=%.0f ok=%v", i+2, rem, ok)
	}
	// 此时桶应为空

	// ── Test 3: 再消耗应失败 ──
	rem, _, ok, wait, _ = s.ConsumeToken(userID, capacity, refillRate, 1)
	t.Logf("T3 第11次(桶空) → 剩余=%.0f ok=%v 需等待=%ds", rem, ok, wait)
	if ok { t.Error("空桶应拒绝消耗") }
	if wait <= 0 { t.Errorf("应返回等待秒数, got %d", wait) }

	// ── Test 4: 补充后再消耗 ──
	t.Log("T4 等待 2 秒让令牌补充...")
	time.Sleep(2 * time.Second)
	rem, _, ok, _, _ = s.ConsumeToken(userID, capacity, refillRate, 1)
	t.Logf("T4 补充后 → 剩余=%.0f ok=%v", rem, ok)
	if !ok { t.Log("2秒不足以补充1个令牌（需~1200s），预期行为") }

	// ── Test 5: 查询当前令牌数 ──
	current := s.GetBucketTokens(userID, capacity, refillRate)
	t.Logf("T5 当前令牌: %.2f / %d", current, capacity)

	// 清理
	s.client.Del(context.Background(), "bucket:99999")
	t.Log("✅ 令牌桶测试完成")
}

// TestRefundToken 覆盖退款路径：封顶、累积刷新、过期桶默认满桶
func TestRefundToken(t *testing.T) {
	s, err := NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	uid := int64(99998)
	cap := 10
	rate := 3
	key := "bucket:99998"
	s.client.Del(context.Background(), key)

	// ── Test 1: 退款封顶 — 满桶时退款不应超过 capacity ──
	// 先消耗 1 个（剩 9），再退 5 个 → 应封顶在 10，而非 14
	s.ConsumeToken(uid, cap, rate, 1)
	if err := s.RefundToken(uid, cap, rate, 5); err != nil { t.Fatal(err) }
	after := s.GetBucketTokens(uid, cap, rate)
	t.Logf("T1 退款封顶 → 当前=%.2f / %d", after, cap)
	if after > float64(cap)+0.01 { t.Errorf("退款不应超过容量, got %.2f", after) }

	// ── Test 2: 退款不丢累积 — 扣空后退 1，应得到 1（而非把已累积时间清零）──
	s.client.Del(context.Background(), key)
	for i := 0; i < cap; i++ { s.ConsumeToken(uid, cap, rate, 1) } // 扣空
	emptyTokens := s.GetBucketTokens(uid, cap, rate)
	if err := s.RefundToken(uid, cap, rate, 1); err != nil { t.Fatal(err) }
	refunded := s.GetBucketTokens(uid, cap, rate)
	t.Logf("T2 空桶退款 → 退款前=%.2f 退款后=%.2f", emptyTokens, refunded)
	if refunded < 1.0-0.01 { t.Errorf("退 1 个后应≥1, got %.2f", refunded) }

	// ── Test 3: 过期桶退款 — key 不存在时应视为满桶（与 consume 默认一致）──
	s.client.Del(context.Background(), key)
	if err := s.RefundToken(uid, cap, rate, 1); err != nil { t.Fatal(err) }
	expired := s.GetBucketTokens(uid, cap, rate)
	t.Logf("T3 过期桶退款 → 当前=%.2f / %d", expired, cap)
	if expired < float64(cap)-0.01 { t.Errorf("过期桶退款应视为满桶(%d), got %.2f", cap, expired) }

	s.client.Del(context.Background(), key)
	t.Log("✅ 退款路径测试完成")
}

// TestAddBurstTokenCap 覆盖突发令牌囤积上限：超额封顶、上限内全额、cap=0 不限。
func TestAddBurstTokenCap(t *testing.T) {
	s, err := NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	uid := int64(99997)
	cap := 50
	rate := 3
	key := "bucket:99997"
	s.client.Del(context.Background(), key)

	// ── Test 1: 上限内兑换 — 上限 20，兑 15 → 全额到账，added=15 ──
	burst, added, err := s.AddBurstToken(uid, cap, rate, 15, 20)
	if err != nil { t.Fatal(err) }
	t.Logf("T1 上限20兑15 → burst=%.0f added=%.0f", burst, added)
	if burst != 15 || added != 15 { t.Errorf("应全额到账 burst=15 added=15, got burst=%.0f added=%.0f", burst, added) }

	// ── Test 2: 触顶封顶 — 已有 15，上限 20，再兑 10 → 只能加 5，封顶 20 ──
	burst, added, err = s.AddBurstToken(uid, cap, rate, 10, 20)
	if err != nil { t.Fatal(err) }
	t.Logf("T2 触顶 → burst=%.0f added=%.0f", burst, added)
	if burst != 20 || added != 5 { t.Errorf("应封顶 burst=20 added=5, got burst=%.0f added=%.0f", burst, added) }

	// ── Test 3: 已达上限 — 再兑 → added=0 ──
	burst, added, err = s.AddBurstToken(uid, cap, rate, 10, 20)
	if err != nil { t.Fatal(err) }
	t.Logf("T3 已满 → burst=%.0f added=%.0f", burst, added)
	if burst != 20 || added != 0 { t.Errorf("已满应 added=0, got burst=%.0f added=%.0f", burst, added) }

	// ── Test 4: cap=0 不限 — 继续累加无封顶 ──
	burst, added, err = s.AddBurstToken(uid, cap, rate, 100, 0)
	if err != nil { t.Fatal(err) }
	t.Logf("T4 不限 → burst=%.0f added=%.0f", burst, added)
	if burst != 120 || added != 100 { t.Errorf("cap=0 应不限 burst=120 added=100, got burst=%.0f added=%.0f", burst, added) }

	s.client.Del(context.Background(), key)
	t.Log("✅ 突发令牌上限测试完成")
}

// TestAllowRate 覆盖固定窗口限流：窗口内放行至 limit、超限拒绝、窗口过期后额度重置。
// 这是 API Key 按套餐限量的底层计数器。
func TestAllowRate(t *testing.T) {
	s, err := NewRedisStore("localhost:6379", "")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	defer s.Close()

	key := "uid:" + strconv.FormatInt(time.Now().UnixNano(), 10)
	defer s.client.Del(context.Background(), "rl:"+key)

	const limit = 4

	// ── Test 1: 窗口内前 limit 个放行 ──
	window := 2 * time.Second
	allowed := 0
	for i := 0; i < limit+3; i++ {
		if s.AllowRate(key, limit, window) {
			allowed++
		}
	}
	t.Logf("T1 limit=%d 打 %d 个 → 放行=%d", limit, limit+3, allowed)
	if allowed != limit {
		t.Errorf("窗口内应恰好放行 %d 个, got %d", limit, allowed)
	}

	// ── Test 2: 窗口过期后额度重置 ──
	t.Log("T2 等待窗口过期...")
	time.Sleep(window + 500*time.Millisecond)
	if !s.AllowRate(key, limit, window) {
		t.Error("窗口过期后应重新放行")
	}
	t.Log("T2 窗口过期后第 1 个已放行 ✓")

	t.Log("✅ 固定窗口限流测试完成")
}

