package service

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"chatgpt2api-pro/internal/model"
)

var (
	registerCancel context.CancelFunc
	registerMu     sync.Mutex
	registerWG     sync.WaitGroup
)

// StartRegister 启动注册机
func StartRegister(cfg *model.RegisterConfig, onAccount func(*model.Account), getStats func() (quota int, active int)) {
	registerMu.Lock()

	// 如果已在运行，不重复启动
	if registerCancel != nil {
		registerMu.Unlock()
		GetRegisterBroker().Log("⚠ 注册机已在运行中，跳过重复启动", "yellow", "", 0)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	registerCancel = cancel
	registerMu.Unlock()

	broker := GetRegisterBroker()
	broker.Log("🚀 注册机启动", "yellow", "", 0)

	// 兜底默认值
	if cfg.Threads <= 0 { cfg.Threads = 3 }
	if cfg.Total <= 0 { cfg.Total = 10 }
	if cfg.WaitTimeout <= 0 { cfg.WaitTimeout = 300 }

	mailCfg := model.MailConfig{
		RequestTimeout: 60,
		WaitTimeout:    cfg.WaitTimeout,
		WaitInterval:   3,
		UserAgent:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
		Proxy:          cfg.Proxy,
		Providers:      cfg.Mail,
	}

	var submitted, done, success, fail atomic.Int64
	sem := make(chan struct{}, cfg.Threads)

	go func() {
		defer func() {
			registerMu.Lock()
			registerCancel = nil
			registerMu.Unlock()
			cfg.Enabled = false
			broker.Log("⏹ 注册机已停止", "yellow", "", 0)
		}()

		broker.Log("▶ 开始调度任务...", "", "", 0)

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			sub := int(submitted.Load())
			dn := int(done.Load())

			// 检查目标（按成功数，失败自动重试）
			sc := int(success.Load())
			if targetReached(cfg, sc, getStats) {
				broker.Log("✅ 注册目标已达，自动停止", "yellow", "", 0)
				return
			}

			// 填充 worker：一次性填满所有空闲 slot，保证有效并发稳定在 Threads，
			// 不再「每轮只补 1 个」导致并发爬升慢 / 批量完成后掉档。
			active := sub - dn
			for active < cfg.Threads {
				// total 模式目标感知上界：已成功 + 在途 ≥ Total 则停止提交，
				// 避免 Threads≫Total 时一次性超额注册（available/quota 模式按 getStats 判停，不设此上界）。
				if cfg.Mode == "total" && sc+active >= cfg.Total {
					break
				}
				idx := int(submitted.Add(1))
				sem <- struct{}{}
				registerWG.Add(1)
				go func(taskIdx int) {
					defer registerWG.Done()
					defer func() { <-sem }()
					defer done.Add(1)

					registrar := NewPlatformRegistrar(mailCfg, cfg.Proxy)
					registrar.LogFunc = func(text, level string) {
						broker.Log(text, level, "", taskIdx)
					}
					acc, err := registrar.Register(taskIdx)
					registrar.Close()

					if err != nil {
						fail.Add(1)
						broker.UpdateStats(int(success.Load()), int(fail.Load()), int(done.Load()), int(submitted.Load()-done.Load()))
						broker.Log("❌ "+err.Error(), "red", "", taskIdx)
						return
					}

					success.Add(1)
					broker.UpdateStats(int(success.Load()), int(fail.Load()), int(done.Load()), int(submitted.Load()-done.Load()))
					broker.Log("🎉 注册成功", "green", acc.Email, taskIdx)
					if onAccount != nil {
						onAccount(acc)
					}
				}(idx)
				active++
			}

			time.Sleep(loopInterval(cfg))
		}
	}()
}

// RegisterOnce 一次性补号注册。
// getStats 用于按号池真实状态（配额/可用数）判停，传 nil 则退化为按成功数 cfg.Total 判停。
// 内置尝试次数上限与总耗时上限双重兜底，防止注册持续失败时无限循环（会烧邮箱/代理/费用）。
func RegisterOnce(cfg *model.RegisterConfig, onAccount func(*model.Account), getStats func() (quota int, active int)) {
	registerMu.Lock()
	if registerCancel != nil {
		registerMu.Unlock()
		log.Printf("[register] StartRegister 正在运行，跳过 RegisterOnce")
		return
	}
	registerMu.Unlock()

	broker := GetRegisterBroker()
	if cfg.Threads <= 0 { cfg.Threads = 3 }
	if cfg.Total <= 0 { cfg.Total = 1 }
	if cfg.WaitTimeout <= 0 { cfg.WaitTimeout = 300 }

	mailCfg := model.MailConfig{
		RequestTimeout: 60,
		WaitTimeout:    cfg.WaitTimeout,
		WaitInterval:   3,
		UserAgent:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
		Proxy:          cfg.Proxy,
		Providers:      cfg.Mail,
	}

	var success, fail, done, submitted atomic.Int64

	// 兜底上限：最多提交 max(cfg.Total*3, cfg.Total+10) 次任务（覆盖失败重试），
	// 但设绝对硬顶 50，避免 delta 巨大时单轮花费失控；
	// 或总耗时超过 30 分钟，即停止——防止注册持续失败导致无限循环。
	maxSubmit := cfg.Total * 3
	if maxSubmit < cfg.Total+10 { maxSubmit = cfg.Total + 10 }
	if maxSubmit > 50 { maxSubmit = 50 }
	deadline := time.Now().Add(30 * time.Minute)

	sem := make(chan struct{}, cfg.Threads)

	for {
		// 达成目标（按号池真实状态或成功数）→ 停
		if targetReached(cfg, int(success.Load()), getStats) {
			return
		}
		// 兜底 1：提交次数触顶 → 停（注册成功率过低时止损）
		if int(submitted.Load()) >= maxSubmit {
			broker.Log(fmt.Sprintf("⏹ 补号已达尝试上限(%d)，成功=%d 失败=%d，停止", maxSubmit, success.Load(), fail.Load()), "yellow", "", 0)
			registerWG.Wait()
			return
		}
		// 兜底 2：总耗时触顶 → 停
		if time.Now().After(deadline) {
			broker.Log(fmt.Sprintf("⏹ 补号已超时(30min)，成功=%d 失败=%d，停止", success.Load(), fail.Load()), "yellow", "", 0)
			registerWG.Wait()
			return
		}

		sub := int(submitted.Load())
		dn := int(done.Load())
		sc := int(success.Load())
		active := sub - dn
		// 填满所有空闲 slot（同 StartRegister），但额外尊重 maxSubmit 硬顶；
		// total 模式再加目标感知上界，避免 Threads≫缺口时超额提交。
		for active < cfg.Threads {
			if int(submitted.Load()) >= maxSubmit {
				break
			}
			if cfg.Mode == "total" && sc+active >= cfg.Total {
				break
			}
			idx := int(submitted.Add(1))
			sem <- struct{}{}
			registerWG.Add(1)
			go func(taskIdx int) {
				defer registerWG.Done()
				defer func() { <-sem; done.Add(1) }()
				defer func() {
					if rec := recover(); rec != nil {
						fail.Add(1)
						broker.Log(fmt.Sprintf("注册任务异常: %v", rec), "red", "", taskIdx)
					}
				}()
				registrar := NewPlatformRegistrar(mailCfg, cfg.Proxy)
				registrar.LogFunc = func(text, level string) {
					broker.Log(text, level, "", taskIdx)
				}
				acc, err := registrar.Register(taskIdx)
				registrar.Close()
				if err != nil {
					fail.Add(1)
					return
				}
				success.Add(1)
				broker.Log("🎉 补注册成功", "green", acc.Email, taskIdx)
				if onAccount != nil { onAccount(acc) }
			}(idx)
			active++
		}
		// 与 StartRegister 一致：按秒计、带 500ms 下限，避免 CheckInterval=0 时零睡眠自旋打爆 DB
		time.Sleep(loopInterval(cfg))
	}
}

// StopRegister 停止注册机
func StopRegister() {
	registerMu.Lock()
	if registerCancel != nil {
		registerCancel()
		registerCancel = nil
	}
	registerMu.Unlock()
	registerWG.Wait()
	log.Printf("[register] 所有 worker 已停止")
}

// IsRegisterRunning 检查注册机是否正在运行
func IsRegisterRunning() bool {
	registerMu.Lock()
	defer registerMu.Unlock()
	return registerCancel != nil
}

func targetReached(cfg *model.RegisterConfig, success int, getStats func() (int, int)) bool {
	switch cfg.Mode {
	case "total":
		return success >= cfg.Total
	case "quota":
		if getStats != nil {
			q, _ := getStats()
			return q >= cfg.TargetQuota
		}
		return success >= cfg.Total
	case "available":
		if getStats != nil {
			_, a := getStats()
			return a >= cfg.TargetAvailable
		}
		return success >= cfg.Total
	default:
		return success >= cfg.Total
	}
}

func loopInterval(cfg *model.RegisterConfig) time.Duration {
	if cfg.CheckInterval <= 0 {
		return 500 * time.Millisecond
	}
	return time.Duration(cfg.CheckInterval) * time.Second
}
