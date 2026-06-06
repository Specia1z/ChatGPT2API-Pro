package store

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// 令牌桶 Lua 脚本（包级复用）
var (
	// consumeBurstFirstScript 惰性刷新 + 优先消耗突发令牌 + 原子扣减。
	// 存储结构: bucket:{uid} → { tokens, burst, last_refill }
	// 返回 {正常剩余, 突发剩余, 是否成功(1/0), 需等待秒数}
	consumeBurstFirstScript = redis.NewScript(`
		local key = KEYS[1]
		local cap = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local now = tonumber(ARGV[3])
		local need = tonumber(ARGV[4])
		local tokens = tonumber(redis.call('HGET', key, 'tokens')) or cap
		local last = tonumber(redis.call('HGET', key, 'last_refill')) or now
		local burst = tonumber(redis.call('HGET', key, 'burst')) or 0
		local elapsed = math.max(0, now - last)
		tokens = math.min(cap, tokens + elapsed * rate / 3600)
		local total = tokens + burst
		if total >= need then
			local burstUsed = math.min(burst, need)
			burst = burst - burstUsed
			tokens = tokens - (need - burstUsed)
			redis.call('HSET', key, 'tokens', tokens, 'burst', burst, 'last_refill', now)
			redis.call('EXPIRE', key, 86400)
			return {tostring(tokens), tostring(burst), 1}
		end
		local wait = -1
		if rate > 0 then wait = math.ceil((need - total) / (rate / 3600)) end
		redis.call('HSET', key, 'tokens', tokens, 'burst', burst, 'last_refill', now)
		redis.call('EXPIRE', key, 86400)
		return {tostring(tokens), tostring(burst), 0, wait}
	`)

	// refundTokenScript 退还令牌（仅退正常令牌，不退突发）。
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

	// addBurstTokenScript 积分兑换：追加突发令牌，受 burstCap 上限封顶（cap=0 表示不限）。
	// 返回 {新的 burst 数, 实际新增数}；若已达上限则实际新增可能小于请求量。
	addBurstTokenScript = redis.NewScript(`
		local key = KEYS[1]
		local cap = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local now = tonumber(ARGV[3])
		local count = tonumber(ARGV[4])
		local burstCap = tonumber(ARGV[5])
		local tokens = tonumber(redis.call('HGET', key, 'tokens')) or cap
		local last = tonumber(redis.call('HGET', key, 'last_refill')) or now
		local burst = tonumber(redis.call('HGET', key, 'burst')) or 0
		local elapsed = math.max(0, now - last)
		tokens = math.min(cap, tokens + elapsed * rate / 3600)
		local target = burst + count
		if burstCap > 0 and target > burstCap then target = burstCap end
		local added = target - burst
		if added < 0 then added = 0 end
		burst = burst + added
		redis.call('HSET', key, 'tokens', tokens, 'burst', burst, 'last_refill', now)
		redis.call('EXPIRE', key, 86400)
		return {tostring(burst), tostring(added)}
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

// ── 并发槽位管理 ──────────────────────────────

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
	script := redis.NewScript(`
		local n = tonumber(redis.call('GET', KEYS[1])) or 0
		if n <= 1 then redis.call('DEL', KEYS[1]); return 0 end
		return redis.call('DECR', KEYS[1])
	`)
	return script.Run(ctx, r.client, []string{key}).Err()
}

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

// ── Token 缓存 ──────────────────────────────

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

func (r *RedisStore) ExpireToken(ctx context.Context, token string, ttl time.Duration) error {
	return r.client.Expire(ctx, "token:"+token, ttl).Err()
}

// ── 登录失败计数 ──────────────────────────────

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

// ── 令牌桶（带突发） ──────────────────────────

// ConsumeToken 令牌桶：优先消耗突发令牌，再消耗正常令牌。
// 返回 (正常剩余, 突发剩余, 是否成功, 需等待秒数)
func (r *RedisStore) ConsumeToken(userID int64, capacity, refillRate, count int) (normal, burst float64, ok bool, wait int, err error) {
	key := fmt.Sprintf("bucket:%d", userID)
	now := time.Now().Unix()
	if count < 1 { count = 1 }

	result, e := consumeBurstFirstScript.Run(context.Background(), r.client, []string{key}, capacity, refillRate, now, count).Result()
	if e != nil { return 0, 0, false, 0, e }
	arr := result.([]interface{})
	normal, _ = strconv.ParseFloat(arr[0].(string), 64)
	burst, _ = strconv.ParseFloat(arr[1].(string), 64)
	ok = arr[2].(int64) == 1
	wait = 0
	if len(arr) > 3 { w := arr[3].(int64); wait = int(w) }
	return
}

// AddBurstToken 积分兑换：追加突发令牌，受 burstCap 上限封顶（burstCap=0 不限）。
// 返回 (新的 burst 数, 实际新增数)；触顶时实际新增可能小于请求量。
func (r *RedisStore) AddBurstToken(userID int64, capacity, refillRate, count, burstCap int) (burst, added float64, err error) {
	key := fmt.Sprintf("bucket:%d", userID)
	now := time.Now().Unix()
	result, err := addBurstTokenScript.Run(context.Background(), r.client, []string{key}, capacity, refillRate, now, count, burstCap).Result()
	if err != nil {
		return 0, 0, err
	}
	arr := result.([]interface{})
	burst, _ = strconv.ParseFloat(arr[0].(string), 64)
	added, _ = strconv.ParseFloat(arr[1].(string), 64)
	return burst, added, nil
}

// RefundToken 退还指定数量的正常令牌（突发不退）。
func (r *RedisStore) RefundToken(userID int64, capacity, refillRate, count int) error {
	key := fmt.Sprintf("bucket:%d", userID)
	now := time.Now().Unix()
	_, err := refundTokenScript.Run(context.Background(), r.client, []string{key}, capacity, refillRate, now, count).Result()
	return err
}

// GetBucketTokens 返回当前桶内总可用令牌（正常 + 突发）
func (r *RedisStore) GetBucketTokens(userID int64, capacity, refillRate int) float64 {
	n, b := r.GetBucketDetail(userID, capacity, refillRate)
	return n + b
}

// GetBucketDetail 返回 (正常令牌数, 突发令牌数)
func (r *RedisStore) GetBucketDetail(userID int64, capacity, refillRate int) (float64, float64) {
	key := fmt.Sprintf("bucket:%d", userID)
	vals, _ := r.client.HGetAll(context.Background(), key).Result()
	tokens := float64(capacity)
	last := float64(time.Now().Unix())
	burst := float64(0)
	if v, ok := vals["tokens"]; ok { tokens, _ = strconv.ParseFloat(v, 64) }
	if v, ok := vals["burst"]; ok { burst, _ = strconv.ParseFloat(v, 64) }
	if v, ok := vals["last_refill"]; ok { last, _ = strconv.ParseFloat(v, 64) }
	now := float64(time.Now().Unix())
	elapsed := now - last
	if elapsed < 0 { elapsed = 0 }
	tokens += elapsed * float64(refillRate) / 3600
	if tokens > float64(capacity) { tokens = float64(capacity) }
	return tokens, burst
}

// GetRegisterCount 查询 IP 今日注册次数
func (r *RedisStore) GetRegisterCount(ip string) (int, error) {
	key := "reg_ip:" + ip
	val, err := r.client.Get(context.Background(), key).Int()
	if err == redis.Nil { return 0, nil }
	return val, err
}

// IncrRegisterCount IP 注册计数+1（TTL 到次日凌晨自动过期）
func (r *RedisStore) IncrRegisterCount(ip string) error {
	key := "reg_ip:" + ip
	ctx := context.Background()
	n, err := r.client.Incr(ctx, key).Result()
	if err != nil { return err }
	if n == 1 {
		now := time.Now()
		ttl := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, now.Location()).Sub(now)
		if ttl < 0 { ttl = time.Second }
		r.client.Expire(ctx, key, ttl)
	}
	return nil
}

// AllowRate 固定窗口限流：在 window 内对 key 计数，超过 limit 返回 false（不放行）。
// 用于按 API Key/uid 维度限流，避免 IP 限流被多 IP 绕过。Redis 不可用时放行（降级不阻断业务）。
func (r *RedisStore) AllowRate(key string, limit int, window time.Duration) bool {
	ctx := context.Background()
	k := "rl:" + key
	n, err := r.client.Incr(ctx, k).Result()
	if err != nil {
		return true // 降级：Redis 异常不阻断
	}
	if n == 1 {
		r.client.Expire(ctx, k, window)
	}
	return int(n) <= limit
}
func (r *RedisStore) EmailCodeCooldown(email string) (time.Duration, error) {
	ttl, err := r.client.TTL(context.Background(), "verify_cd:"+email).Result()
	if err == redis.Nil { return 0, nil }
	if err != nil { return 0, err }
	if ttl < 0 { return 0, nil } // -1(无过期)/-2(不存在) 视为无冷却
	return ttl, nil
}

// SetEmailCode 存储邮箱验证码（10 分钟有效），同时写入发送冷却标记
func (r *RedisStore) SetEmailCode(email, code string) error {
	ctx := context.Background()
	if err := r.client.Set(ctx, "verify:"+email, code, 10*time.Minute).Err(); err != nil {
		return err
	}
	// 重置失败计数，并设置发送冷却（60 秒）
	r.client.Del(ctx, "verify_fail:"+email)
	return r.client.Set(ctx, "verify_cd:"+email, "1", 60*time.Second).Err()
}

// ClearEmailCode 清除验证码、失败计数与发送冷却（用于发送失败时回滚）
func (r *RedisStore) ClearEmailCode(email string) {
	ctx := context.Background()
	r.client.Del(ctx, "verify:"+email, "verify_fail:"+email, "verify_cd:"+email)
}

// verifyMaxAttempts 单个验证码允许的最大错误尝试次数，超过即作废
const verifyMaxAttempts = 5

// VerifyEmailCode 验证邮箱验证码。失败累计超过上限会作废该验证码以防爆破。
func (r *RedisStore) VerifyEmailCode(email, code string) (bool, error) {
	ctx := context.Background()
	key := "verify:" + email
	stored, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil { return false, nil }
	if err != nil { return false, err }
	if stored != code {
		// 累计失败次数，超过上限直接作废验证码
		failKey := "verify_fail:" + email
		n, _ := r.client.Incr(ctx, failKey).Result()
		if n == 1 {
			r.client.Expire(ctx, failKey, 10*time.Minute)
		}
		if n >= verifyMaxAttempts {
			r.client.Del(ctx, key, failKey)
		}
		return false, nil
	}
	r.client.Del(ctx, key, "verify_fail:"+email)
	return true, nil
}
