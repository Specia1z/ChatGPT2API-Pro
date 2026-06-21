package store

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

// ═══ 用户风险评分 — Redis 实时计数器 ═══
// 高频信号（QPS/错误率/IP切换）通过 Redis 原子累加，定时任务每 5 分钟合并到 DB。
// Key 格式: risk:<uid>:<metric>:<window>  例: risk:42:qps:5m

const riskKeyPrefix = "risk"

// IncrRisk 原子累加一个风险指标。window 为时间窗口（如 "5m"），expire 后自动清理。
func (r *RedisStore) IncrRisk(ctx context.Context, uid int64, metric string, window time.Duration) {
	key := fmt.Sprintf("%s:%d:%s", riskKeyPrefix, uid, metric)
	r.client.Incr(ctx, key).Err()
	r.client.Expire(ctx, key, window)
}

// IncrRiskBy 累加指定数量（用于错误计数、令牌消耗等批量指标）。
func (r *RedisStore) IncrRiskBy(ctx context.Context, uid int64, metric string, delta int, window time.Duration) {
	key := fmt.Sprintf("%s:%d:%s", riskKeyPrefix, uid, metric)
	r.client.IncrBy(ctx, key, int64(delta))
	r.client.Expire(ctx, key, window)
}

// AddRiskIP 记录用户使用的 IP（用 Set 去重，window 内自动过期）。
func (r *RedisStore) AddRiskIP(ctx context.Context, uid int64, ip string, window time.Duration) {
	key := fmt.Sprintf("%s:%d:ips", riskKeyPrefix, uid)
	r.client.SAdd(ctx, key, ip)
	r.client.Expire(ctx, key, window)
}

// GetRiskCounter 读取指定指标的当前值。
func (r *RedisStore) GetRiskCounter(ctx context.Context, uid int64, metric string) int {
	key := fmt.Sprintf("%s:%d:%s", riskKeyPrefix, uid, metric)
	v, _ := r.client.Get(ctx, key).Result()
	n, _ := strconv.Atoi(v)
	return n
}

// GetRiskIPs 读取用户最近使用的去重 IP 列表。
func (r *RedisStore) GetRiskIPs(ctx context.Context, uid int64) []string {
	key := fmt.Sprintf("%s:%d:ips", riskKeyPrefix, uid)
	members, _ := r.client.SMembers(ctx, key).Result()
	return members
}

// GetRiskSnapshot 读取用户所有 Redis 风险指标快照。
func (r *RedisStore) GetRiskSnapshot(ctx context.Context, uid int64) map[string]int {
	snap := map[string]int{}
	for _, m := range []string{"qps", "errors", "tokens"} {
		snap[m] = r.GetRiskCounter(ctx, uid, m)
	}
	snap["ips"] = len(r.GetRiskIPs(ctx, uid))
	return snap
}

// ResetRisk 清除用户所有 Redis 风险指标（评分落库后调用）。
func (r *RedisStore) ResetRisk(ctx context.Context, uid int64) {
	prefix := fmt.Sprintf("%s:%d:", riskKeyPrefix, uid)
	iter := r.client.Scan(ctx, 0, prefix+"*", 100).Iterator()
	for iter.Next(ctx) {
		r.client.Del(ctx, iter.Val())
	}
}

// ═══ 月度令牌配额（防二次分发） ═══
// Key: quota:<uid>:<YYYYMM>，按自然月累加 tokens_cost，TTL 自动跨月过期（无需重置任务）。

// monthKey 返回当前自然月的配额 key。
func monthKey(uid int64) string {
	return fmt.Sprintf("quota:%d:%s", uid, time.Now().Format("200601"))
}

// AddMonthlyUsage 累加本月令牌消耗，返回累加后的本月累计值。
// TTL 设 35 天，保证跨月后旧 key 自动清理（新月用新 key）。
func (r *RedisStore) AddMonthlyUsage(ctx context.Context, uid int64, cost int) int {
	if cost <= 0 {
		return r.GetMonthlyUsage(ctx, uid)
	}
	key := monthKey(uid)
	n, err := r.client.IncrBy(ctx, key, int64(cost)).Result()
	if err != nil {
		return 0
	}
	r.client.Expire(ctx, key, 35*24*time.Hour)
	return int(n)
}

// GetMonthlyUsage 读取本月已用令牌数。
func (r *RedisStore) GetMonthlyUsage(ctx context.Context, uid int64) int {
	v, _ := r.client.Get(ctx, monthKey(uid)).Result()
	n, _ := strconv.Atoi(v)
	return n
}

// RefundMonthlyUsage 退还本月令牌消耗（生图失败/退款时，与令牌桶退款保持一致）。
func (r *RedisStore) RefundMonthlyUsage(ctx context.Context, uid int64, cost int) {
	if cost <= 0 {
		return
	}
	key := monthKey(uid)
	// 仅当 key 存在时递减，避免凭空造负数 key
	if r.client.Exists(ctx, key).Val() == 1 {
		r.client.DecrBy(ctx, key, int64(cost))
	}
}

// ═══ 单 API Key 多 IP 采集（中转站转卖告警） ═══
// 中转站特征：一个 Key 被大量不同终端 IP 调用。Key: keyip:<apiKeyID>，24h 去重 Set。

// AddKeyIP 记录某 API Key 被调用的来源 IP（去重，24h 过期）。
func (r *RedisStore) AddKeyIP(ctx context.Context, apiKeyID int64, ip string) {
	if apiKeyID <= 0 || ip == "" {
		return
	}
	key := fmt.Sprintf("keyip:%d", apiKeyID)
	r.client.SAdd(ctx, key, ip)
	r.client.Expire(ctx, key, 24*time.Hour)
}

// GetKeyIPCount 返回某 API Key 近 24h 的去重 IP 数。
func (r *RedisStore) GetKeyIPCount(ctx context.Context, apiKeyID int64) int {
	return int(r.client.SCard(ctx, fmt.Sprintf("keyip:%d", apiKeyID)).Val())
}
