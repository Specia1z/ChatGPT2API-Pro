package store

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// 令牌桶 Lua 脚本（包级复用，避免每次调用重建对象；EVALSHA 命中服务端缓存）
var (
	// consumeTokenScript 惰性刷新 + 原子扣减。
	// 返回 {剩余令牌, 是否成功(1/0), 需等待秒数}
	consumeTokenScript = redis.NewScript(`
		local key = KEYS[1]
		local cap = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local now = tonumber(ARGV[3])
		local need = tonumber(ARGV[4])
		local tokens = tonumber(redis.call('HGET', key, 'tokens')) or cap
		local last = tonumber(redis.call('HGET', key, 'last_refill')) or now
		local elapsed = math.max(0, now - last)
		tokens = math.min(cap, tokens + elapsed * rate / 3600)
		if tokens >= need then
			redis.call('HSET', key, 'tokens', tokens - need, 'last_refill', now)
			redis.call('EXPIRE', key, 86400)
			return {tostring(tokens - need), 1}
		end
		local wait = -1
		if rate > 0 then wait = math.ceil((need - tokens) / (rate / 3600)) end
		-- 即使失败也写回刷新后的令牌与时间戳，避免下次重复累加同一段时间
		redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)
		redis.call('EXPIRE', key, 86400)
		return {tostring(tokens), 0, wait}
	`)

	// refundTokenScript 退还令牌。先按经过时间惰性刷新（避免丢失累积），
	// 再加回退款数量，最后按容量封顶。桶缺失（已过期）视为满桶，与 consume 的默认一致，
	// 避免迟到的退款把本应满桶的用户打瘪。
	refundTokenScript = redis.NewScript(`
		local key = KEYS[1]
		local cap = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local now = tonumber(ARGV[3])
		local count = tonumber(ARGV[4])
		local tokens = tonumber(redis.call('HGET', key, 'tokens')) or cap
		local last = tonumber(redis.call('HGET', key, 'last_refill')) or now
		local elapsed = math.max(0, now - last)
		tokens = tokens + elapsed * rate / 3600
		tokens = math.min(cap, tokens + count)
		redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)
		redis.call('EXPIRE', key, 86400)
		return tostring(tokens)
	`)
)

type RedisStore struct {
	client *redis.Client
}

func NewRedisStore(addr, password string) (*RedisStore, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &RedisStore{client: client}, nil
}

func (r *RedisStore) Close() { r.client.Close() }

// 并发槽位管理（原子操作 + 上限检查）。
// TTL 仅作兜底：正常流程由 DecrImageSlot 释放；若进程 panic/崩溃未释放，
// 靠 TTL 自动回收。TTL 必须 > 单次生图最长耗时（轮询最坏 ~490s），故设 900s。
func (r *RedisStore) IncrImageSlot(ctx context.Context, accountID int64, maxSlot int) (int64, error) {
	key := fmt.Sprintf("image_slot:%d", accountID)
	script := redis.NewScript(`
		local key = KEYS[1]
		local max = tonumber(ARGV[1])
		local n = redis.call('INCR', key)
		if max > 0 and n > max then
			redis.call('DECR', key)
			return {-1}
		end
		redis.call('EXPIRE', key, 900)
		return {n}
	`)
	result, err := script.Run(ctx, r.client, []string{key}, maxSlot).Result()
	if err != nil {
		return 0, err
	}
	arr := result.([]interface{})
	n := arr[0].(int64)
	if n < 0 {
		return 0, fmt.Errorf("image slot limit exceeded")
	}
	return n, nil
}

func (r *RedisStore) DecrImageSlot(ctx context.Context, accountID int64) error {
	key := fmt.Sprintf("image_slot:%d", accountID)
	// 防止减到负数（goroutine 异常重复释放等情况）
	script := redis.NewScript(`
		local n = tonumber(redis.call('GET', KEYS[1])) or 0
		if n <= 1 then redis.call('DEL', KEYS[1]); return 0 end
		return redis.call('DECR', KEYS[1])
	`)
	return script.Run(ctx, r.client, []string{key}).Err()
}

// GetImageSlots 批量读取账号的当前占用数（号池列表展示用）。
// 用 MGET 一次取回，不存在的账号占用为 0。
func (r *RedisStore) GetImageSlots(ctx context.Context, accountIDs []int64) map[int64]int {
	result := make(map[int64]int, len(accountIDs))
	if len(accountIDs) == 0 {
		return result
	}
	keys := make([]string, len(accountIDs))
	for i, id := range accountIDs {
		keys[i] = fmt.Sprintf("image_slot:%d", id)
	}
	vals, err := r.client.MGet(ctx, keys...).Result()
	if err != nil {
		return result
	}
	for i, v := range vals {
		if s, ok := v.(string); ok {
			if n, err := strconv.Atoi(s); err == nil && n > 0 {
				result[accountIDs[i]] = n
			}
		}
	}
	return result
}

// Token 缓存
func (r *RedisStore) SetToken(ctx context.Context, token string, adminID int64, ttl time.Duration) error {
	return r.client.Set(ctx, "token:"+token, adminID, ttl).Err()
}

func (r *RedisStore) GetToken(ctx context.Context, token string) (int64, error) {
	val, err := r.client.Get(ctx, "token:"+token).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

func (r *RedisStore) DelToken(ctx context.Context, token string) error {
	return r.client.Del(ctx, "token:"+token).Err()
}

// ExpireToken 延长 token 有效期（滑动过期）
func (r *RedisStore) ExpireToken(ctx context.Context, token string, ttl time.Duration) error {
	return r.client.Expire(ctx, "token:"+token, ttl).Err()
}

// LoginFail 登录失败计数
func (r *RedisStore) GetLoginFail(ctx context.Context, email string) (int64, error) {
	return r.client.Get(ctx, "login_fail:"+email).Int64()
}

func (r *RedisStore) GetLoginFailTTL(ctx context.Context, email string) (time.Duration, error) {
	return r.client.TTL(ctx, "login_fail:"+email).Result()
}

func (r *RedisStore) IncrLoginFail(ctx context.Context, email string) (int64, error) {
	key := "login_fail:" + email
	script := redis.NewScript(`
		local n = redis.call('INCR', KEYS[1])
		redis.call('EXPIRE', KEYS[1], 1800)
		return n
	`)
	n, err := script.Run(ctx, r.client, []string{key}).Int64()
	if err != nil { return 0, err }
	return n, nil
}

func (r *RedisStore) ResetLoginFail(ctx context.Context, email string) error {
	return r.client.Del(ctx, "login_fail:"+email).Err()
}

// ConsumeToken 令牌桶：消耗 count 个令牌，返回 (剩余, 成功, 需等待秒数)
func (r *RedisStore) ConsumeToken(userID int64, capacity, refillRate, count int) (float64, bool, int, error) {
	key := fmt.Sprintf("bucket:%d", userID)
	now := time.Now().Unix()
	if count < 1 { count = 1 }

	result, err := consumeTokenScript.Run(context.Background(), r.client, []string{key}, capacity, refillRate, now, count).Result()
	if err != nil { return 0, false, 0, err }
	arr := result.([]interface{})
	rem, _ := strconv.ParseFloat(arr[0].(string), 64)
	ok := arr[1].(int64) == 1
	wait := int64(0)
	if len(arr) > 2 { wait = arr[2].(int64) }
	return rem, ok, int(wait), nil
}

// RefundToken 退还指定数量的令牌（惰性刷新累积时间 + 按容量封顶）
func (r *RedisStore) RefundToken(userID int64, capacity, refillRate, count int) error {
	key := fmt.Sprintf("bucket:%d", userID)
	now := time.Now().Unix()
	_, err := refundTokenScript.Run(context.Background(), r.client, []string{key}, capacity, refillRate, now, count).Result()
	return err
}

func (r *RedisStore) GetBucketTokens(userID int64, capacity, refillRate int) float64 {
	key := fmt.Sprintf("bucket:%d", userID)
	vals, _ := r.client.HGetAll(context.Background(), key).Result()
	tokens := float64(capacity)
	last := float64(time.Now().Unix())
	if v, ok := vals["tokens"]; ok { tokens, _ = strconv.ParseFloat(v, 64) }
	if v, ok := vals["last_refill"]; ok { last, _ = strconv.ParseFloat(v, 64) }
	now := float64(time.Now().Unix())
	elapsed := now - last
	if elapsed < 0 { elapsed = 0 }
	tokens += elapsed * float64(refillRate) / 3600
	if tokens > float64(capacity) { tokens = float64(capacity) }
	return tokens
}
