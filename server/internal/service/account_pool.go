package service

import (
	"fmt"
	"math/rand"
	"sort"
	"sync"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// AccountPool 号池调度器
type AccountPool struct {
	mu    sync.Mutex
	mysql *store.MySQLStore
	index int
}

var pool = &AccountPool{}

func GetAccountPool(mysql *store.MySQLStore) *AccountPool {
	if pool.mysql == nil {
		pool.mysql = mysql
	}
	return pool
}

// PickBest 选择最优可用账号
func (p *AccountPool) PickBest() (*model.Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	accounts, err := p.mysql.GetAccountsForRefresh()
	if err != nil || len(accounts) == 0 {
		return nil, fmt.Errorf("号池为空")
	}

	// 过滤：仅正常状态 + 有配额（或未知配额）
	var candidates []*model.Account
	for i := range accounts {
		acc := &accounts[i]
		if acc.Status == "禁用" || acc.Status == "异常" {
			continue
		}
		// 已知配额为 0 且被限流 → 跳过
		if !acc.ImageQuotaUnknown && acc.Quota <= 0 && acc.Status == "限流" {
			continue
		}
		candidates = append(candidates, acc)
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("无可用账号（总数 %d）", len(accounts))
	}

	// 优先级：Plus > Pro > Team > Free
	priority := map[string]int{"pro": 4, "plus": 3, "team": 2, "free": 1}

	// 按优先级分组，从最高优先级组中随机选一个
	groups := make(map[int][]*model.Account)
	for _, acc := range candidates {
		score := priority[acc.PlanType]
		groups[score] = append(groups[score], acc)
	}

	// 找最高优先级
	maxPriority := 0
	for score := range groups {
		if score > maxPriority {
			maxPriority = score
		}
	}

	// 从最高优先级组中随机选一个
	bestGroup := groups[maxPriority]
	return bestGroup[rand.Intn(len(bestGroup))], nil
}

// PickRoundRobin 轮询选择
func (p *AccountPool) PickRoundRobin() (*model.Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	accounts, err := p.mysql.GetAccountsForRefresh()
	if err != nil || len(accounts) == 0 {
		return nil, fmt.Errorf("号池为空")
	}

	// 收集可用账号
	var available []*model.Account
	for i := range accounts {
		acc := &accounts[i]
		if acc.Status != "正常" { continue }
		if !acc.ImageQuotaUnknown && acc.Quota <= 0 { continue }
		available = append(available, acc)
	}

	if len(available) == 0 {
		return nil, fmt.Errorf("无可用账号")
	}

	// 轮询
	idx := p.index % len(available)
	p.index++
	return available[idx], nil
}

// PickCandidates 返回按优先级排序的候选账号列表（供 Generate 依次占坑尝试）。
// 排序：Plus > Pro > Team > Free；同优先级内随机打散，避免并发时都挤向同一个。
// 调用方应配合 Redis 槽位逐个尝试占用，超上限则跳到下一个，从根本上防止单账号被并发踩踏。
func (p *AccountPool) PickCandidates() ([]*model.Account, error) {
	p.mu.Lock()
	idx := p.index
	p.index++
	p.mu.Unlock()

	accounts, err := p.mysql.GetAccountsForRefresh()
	if err != nil || len(accounts) == 0 {
		return nil, fmt.Errorf("号池为空")
	}

	// 过滤：剔除禁用/异常；剔除已知配额耗尽的限流账号
	var candidates []*model.Account
	for i := range accounts {
		acc := &accounts[i]
		if acc.Status == "禁用" || acc.Status == "异常" {
			continue
		}
		if !acc.ImageQuotaUnknown && acc.Quota <= 0 && acc.Status == "限流" {
			continue
		}
		candidates = append(candidates, acc)
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("无可用账号（总数 %d）", len(accounts))
	}

	priority := map[string]int{"pro": 4, "plus": 3, "team": 2, "free": 1}

	// 同优先级内先随机打散（降低并发同选），再按优先级稳定排序
	rand.Shuffle(len(candidates), func(i, j int) { candidates[i], candidates[j] = candidates[j], candidates[i] })
	// 轮询起点偏移，让不同请求的同级账号尝试顺序错开
	if len(candidates) > 1 {
		off := idx % len(candidates)
		candidates = append(candidates[off:], candidates[:off]...)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return priority[candidates[i].PlanType] > priority[candidates[j].PlanType]
	})
	return candidates, nil
}
