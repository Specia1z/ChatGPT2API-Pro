package service

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"chatgpt2api-pro/internal/store"
)

// GenerationScheduler 全局生图调度器
type GenerationScheduler struct {
	mu            sync.Mutex
	globalActive  int32
	userCounters  map[int64]*int32
	maxGlobal     int32
	maxPerUser    int32
	maxPerAccount int32
	maxAttempts   int32
	mysql         *store.MySQLStore
	cleanupOnce   sync.Once
}

var scheduler *GenerationScheduler
var schedOnce sync.Once

func InitScheduler(mysql *store.MySQLStore) *GenerationScheduler {
	schedOnce.Do(func() {
		maxG, maxU, maxAcc, maxAtt := mysql.GetSchedulerConfig()
		log.Printf("🧭 调度器已加载 · 全局并发=%d 单用户并发=%d 单账号并发=%d 选号尝试=%d", maxG, maxU, maxAcc, maxAtt)
		scheduler = &GenerationScheduler{
			userCounters:  make(map[int64]*int32),
			maxGlobal:     int32(maxG),
			maxPerUser:    int32(maxU),
			maxPerAccount: int32(maxAcc),
			maxAttempts:   int32(maxAtt),
		}
		scheduler.mysql = mysql
		scheduler.startCleanup()
	})
	return scheduler
}

func GetScheduler() *GenerationScheduler {
	return scheduler
}

// startCleanup 定时清理零值计数器，防止 map 泄漏
func (s *GenerationScheduler) startCleanup() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			s.mu.Lock()
			cleaned := 0
			for uid, c := range s.userCounters {
				if atomic.LoadInt32(c) == 0 {
					delete(s.userCounters, uid)
					cleaned++
				}
			}
			s.mu.Unlock()
			if cleaned > 0 {
				log.Printf("🧹 调度器已清理 %d 个闲置用户计数器", cleaned)
			}
		}
	}()
}

// CheckCapacity 预检查：用户能否同时提交 count 个任务（非阻塞，不实际占位）
func (s *GenerationScheduler) CheckCapacity(userID int64, count int, userConcurrency int) error {
	// 1. 检查用户上限
	s.mu.Lock()
	counter, ok := s.userCounters[userID]
	if !ok {
		c := int32(0)
		counter = &c
		s.userCounters[userID] = counter
	}
	userActive := atomic.LoadInt32(counter)
	s.mu.Unlock()

	perUser := atomic.LoadInt32(&s.maxPerUser)
	if userConcurrency > 0 && int32(userConcurrency) < perUser {
		perUser = int32(userConcurrency)
	}

	if int(userActive)+count > int(perUser) {
		return fmt.Errorf("已达单用户并发上限 (%d)，当前活跃 %d，无法再提交 %d 个", perUser, userActive, count)
	}

	// 2. 检查全局上限
	global := atomic.LoadInt32(&s.globalActive)
	maxG := atomic.LoadInt32(&s.maxGlobal)
	if int(global)+count > int(maxG) {
		return fmt.Errorf("系统繁忙，请稍后重试 (全局并发 %d/%d)", global, maxG)
	}

	return nil
}

// Acquire 申请槽位。流程：
//  1. 原子递增用户计数器
//  2. 若超限则回退并返回错误
//  3. CAS 竞争全局槽位
//  4. 若全局满则回退用户计数器并返回错误
func (s *GenerationScheduler) Acquire(userID int64, userConcurrency ...int) error {
	// 确定该用户的并发上限（取 plan 限制和全局限制的较小值）
	perUser := atomic.LoadInt32(&s.maxPerUser)
	if len(userConcurrency) > 0 && userConcurrency[0] > 0 && int32(userConcurrency[0]) < perUser {
		perUser = int32(userConcurrency[0])
	}

	// 1. 获取或创建用户计数器（加锁保护 map 写）
	s.mu.Lock()
	counter, ok := s.userCounters[userID]
	if !ok {
		c := int32(0)
		counter = &c
		s.userCounters[userID] = counter
	}
	// 原子递增必须在锁内完成，防止 cleanup 在锁释放后立即删除新计数器
	userCur := atomic.AddInt32(counter, 1)
	s.mu.Unlock()
	if userCur > perUser {
		atomic.AddInt32(counter, -1)
		return fmt.Errorf("已达单用户并发上限 (%d)", perUser)
	}

	// 3. CAS 竞争全局槽位
	for {
		global := atomic.LoadInt32(&s.globalActive)
		maxG := atomic.LoadInt32(&s.maxGlobal)
		if global >= maxG {
			atomic.AddInt32(counter, -1)
			return fmt.Errorf("系统繁忙，请稍后重试 (全局并发 %d/%d)", global, maxG)
		}
		if atomic.CompareAndSwapInt32(&s.globalActive, global, global+1) {
			break
		}
	}

	return nil
}

// Release 释放槽位
func (s *GenerationScheduler) Release(userID int64) {
	atomic.AddInt32(&s.globalActive, -1)
	// 直接从 map 读 — 不需要锁，因为 counter 指针生命周期足够长
	// 即使 cleanup 刚删除它，我们持有的指针仍然有效
	s.mu.Lock()
	if counter, ok := s.userCounters[userID]; ok {
		atomic.AddInt32(counter, -1)
	}
	s.mu.Unlock()
}

// SetMax 动态调整上限
func (s *GenerationScheduler) SetMax(maxGlobal, maxPerUser, maxPerAccount, maxAttempts int) {
	atomic.StoreInt32(&s.maxGlobal, int32(maxGlobal))
	atomic.StoreInt32(&s.maxPerUser, int32(maxPerUser))
	atomic.StoreInt32(&s.maxPerAccount, int32(maxPerAccount))
	atomic.StoreInt32(&s.maxAttempts, int32(maxAttempts))
	if s.mysql != nil {
		s.mysql.SaveSchedulerConfig(maxGlobal, maxPerUser, maxPerAccount, maxAttempts)
	}
}

// MaxPerAccount 返回单账号并发上限（热更新值，供生图/矢量服务读取）。
func (s *GenerationScheduler) MaxPerAccount() int {
	v := atomic.LoadInt32(&s.maxPerAccount)
	if v <= 0 {
		return 3 // 兜底，防止配置为 0 时无账号可用
	}
	return int(v)
}

// MaxAttempts 返回生图选号最大尝试账号数（0=由调用方按号池大小自动决定）。
func (s *GenerationScheduler) MaxAttempts() int {
	return int(atomic.LoadInt32(&s.maxAttempts))
}

// Stats 返回调度统计
func (s *GenerationScheduler) Stats() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()

	activeUsers := 0
	totalActive := 0
	for _, c := range s.userCounters {
		v := int(atomic.LoadInt32(c))
		if v > 0 {
			activeUsers++
			totalActive += v
		}
	}
	return map[string]any{
		"global_active":   atomic.LoadInt32(&s.globalActive),
		"global_max":      atomic.LoadInt32(&s.maxGlobal),
		"per_user_max":    atomic.LoadInt32(&s.maxPerUser),
		"per_account_max": atomic.LoadInt32(&s.maxPerAccount),
		"max_attempts":    atomic.LoadInt32(&s.maxAttempts),
		"active_users":    activeUsers,
		"total_active":    totalActive,
	}
}
