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
