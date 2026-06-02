package service

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"chatgpt2api-pro/internal/model"
	"chatgpt2api-pro/internal/store"
)

// AccountMonitor 账号健康监控 + 自动维护
type AccountMonitor struct {
	mu        sync.Mutex
	mysql     *store.MySQLStore
	stopCh    chan struct{}
	running   int32
	checking  int32
	refilling int32

	// 跨周期补号退避：连续低效（补了号但可用数没明显上涨）时暂停自动补号，防周期性烧钱
	refillLowYield   int        // 连续低效轮数
	refillCooldownTo time.Time  // 冷却截止时间，此前跳过自动补号
	lastActiveSeen   int        // 上轮补号前的可用数，用于判断本轮是否有效
}

var (
	monitorInstance *AccountMonitor
	monitorOnce     sync.Once
)

func GetMonitor(mysql ...*store.MySQLStore) *AccountMonitor {
	if len(mysql) > 0 {
		monitorOnce.Do(func() {
			monitorInstance = &AccountMonitor{
				mysql:  mysql[0],
				stopCh: make(chan struct{}),
			}
		})
	}
	return monitorInstance
}

func (m *AccountMonitor) Start() {
	m.mu.Lock()
	if atomic.LoadInt32(&m.running) == 1 {
		m.mu.Unlock()
		return
	}
	m.stopCh = make(chan struct{})
	atomic.StoreInt32(&m.running, 1)
	m.mu.Unlock()

	go func() {
		for {
			cfg, _ := m.mysql.GetMonitorConfig()
			interval := time.Duration(max(1, cfg.IntervalMinutes)) * time.Minute
			ticker := time.NewTicker(interval)

			select {
			case <-m.stopCh:
				ticker.Stop()
				return
			case <-ticker.C:
				if cfg.Enabled {
					m.runCheck()
				}
				ticker.Stop()
			}
		}
	}()

	log.Println("[monitor] 账号健康监控已启动")
}

func (m *AccountMonitor) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if atomic.LoadInt32(&m.running) == 0 {
		return
	}
	atomic.StoreInt32(&m.running, 0)
	close(m.stopCh)
	log.Println("[monitor] 账号健康监控已停止")
}

func (m *AccountMonitor) runCheck() {
	if !atomic.CompareAndSwapInt32(&m.checking, 0, 1) {
		log.Printf("[monitor] 已有检查任务在进行，跳过")
		return
	}
	defer atomic.StoreInt32(&m.checking, 0)

	broker := GetRegisterBroker()
	broker.Log("🔍 开始健康检查...", "", "", 0)

	monCfg, _ := m.mysql.GetMonitorConfig()
	regCfg, _ := m.mysql.GetRegisterConfig()
	stats, _ := m.mysql.GetAccountStats()

	broker.Log(fmt.Sprintf("📊 当前号池: 总数=%d 可用=%d 限流=%d 异常=%d 总配额=%d",
		stats.Total, stats.Active, stats.Limited, stats.Abnormal, stats.TotalQuota), "", "", 0)

	accounts, err := m.mysql.GetAccountsForRefresh()
	if err != nil {
		broker.Log("❌ 获取账号列表失败: "+err.Error(), "red", "", 0)
		return
	}

	type checkResult struct {
		idx int
		acc *model.Account
		err error
	}

	total := len(accounts)
	sem := make(chan struct{}, 10) // 最多 10 并发
	ch := make(chan checkResult, total)

	for i := range accounts {
		sem <- struct{}{}
		go func(idx int, acc *model.Account) {
			defer func() { <-sem }()
			err := RefreshAccount(acc, regCfg.Proxy)
			ch <- checkResult{idx, acc, err}
		}(i, &accounts[i])
	}

	var removed, refreshed int
	for i := 0; i < total; i++ {
		r := <-ch
		acc := r.acc

		if r.err != nil {
			// 401 封禁 → 直接删除
			if strings.Contains(r.err.Error(), "banned") || strings.Contains(r.err.Error(), "401") {
				m.mysql.DeleteAccounts([]int64{acc.ID})
				removed++
				broker.Log("🚫 账号被封禁已删除: "+acc.Email, "red", acc.Email, 0)
				continue
			}
			// 本地 TLS/网络层故障 → 与账号无关，跳过本轮，保持原状（不标记异常、不删除）
			if isTransientNetErr(r.err) {
				log.Printf("[monitor] 刷新账号 %s 网络/TLS 故障，跳过本轮: %v", acc.Email, r.err)
				broker.Log("⚠ 网络故障跳过(非账号问题): "+acc.Email, "yellow", acc.Email, 0)
				continue
			}
			// 其他错误 → 标记为异常，由自动删除逻辑处理
			log.Printf("[monitor] 刷新账号 %s 失败: %v", acc.Email, r.err)
			acc.Status = "异常"
		} else {
			refreshed++
			if (refreshed)%10 == 0 || i == total-1 {
				broker.Log(fmt.Sprintf("⏳ 检查中... (%d/%d) 已刷新=%d", i+1, total, refreshed), "", "", 0)
			}
		}

		if acc.Status == "异常" && monCfg.AutoRemoveAbnormal {
			m.mysql.DeleteAccounts([]int64{acc.ID})
			removed++
			broker.Log("🗑 删除异常账号: "+acc.Email, "red", acc.Email, 0)
			continue
		}
		if acc.Status == "禁用" && monCfg.AutoRemoveDisabled {
			m.mysql.DeleteAccounts([]int64{acc.ID})
			removed++
			broker.Log("🗑 删除禁用账号: "+acc.Email, "red", acc.Email, 0)
			continue
		}

		m.mysql.UpdateAccountByToken(acc)
	}

	// 汇总
	stats2, _ := m.mysql.GetAccountStats()
	broker.Log(fmt.Sprintf("✅ 检查完成: 刷新=%d 删除=%d | 当前可用=%d 配额=%d",
		refreshed, removed, stats2.Active, stats2.TotalQuota), "green", "", 0)

	log.Printf("[monitor] ✅ 检查完成: 总数=%d 可用=%d 限流=%d 异常=%d 禁用=%d 配额=%d | 刷新=%d 删除=%d",
		stats.Total, stats2.Active, stats2.Limited, stats2.Abnormal, stats2.Disabled, stats2.TotalQuota, refreshed, removed)

	// 自动补注册：补号目标取监控页「智能补号」配置（refill_mode / refill_target），
	// 注册机配置仅提供注册参数（代理/线程/邮箱）——前者决定补到多少，后者决定怎么注册。
	if monCfg.AutoRefill && regCfg.Enabled {
		if IsRegisterRunning() {
			broker.Log("⏭ StartRegister 正在运行，跳过自动补注册", "yellow", "", 0)
		} else {
			refillMode := monCfg.RefillMode
			if refillMode != "available" {
				refillMode = "total" // 兜底：空值/未知一律按总数
			}
			target := monCfg.RefillTarget
			if target < 1 {
				target = 1
			}
			// delta 基数与判停量纲保持一致：
			//   available → 看号池可用数(Active)，按可用数判停（受限号不计）
			//   total     → 看号池总数(Total)，按本轮成功注册数判停（每成功 1 个总数 +1）
			current := stats2.Active
			if refillMode == "total" {
				current = stats2.Total
			}
			delta := target - current
			needRefill := delta > 0
			// 跨周期退避：若处于冷却期，跳过本轮自动补号（防注册号全受限时周期性烧钱）
			m.mu.Lock()
			cooldownTo := m.refillCooldownTo
			lowYield := m.refillLowYield
			m.mu.Unlock()
			if needRefill && time.Now().Before(cooldownTo) {
				broker.Log(fmt.Sprintf("⏸ 补号冷却中（连续%d轮低效），剩 %.0f 分钟，跳过", lowYield, time.Until(cooldownTo).Minutes()), "yellow", "", 0)
				needRefill = false
			}
			if needRefill {
				if !atomic.CompareAndSwapInt32(&m.refilling, 0, 1) {
					log.Printf("[monitor] 已有补号任务在进行，跳过")
					broker.Log("⏭ 补注册任务已在进行，跳过本次", "yellow", "", 0)
				} else {
					broker.Log(fmt.Sprintf("📉 账号不足(差%d)，自动补注册...", delta), "yellow", "", 0)
					beforeActive := stats2.Active // 记录补号前可用数，用于评估本轮成效
					tmpCfg := *regCfg
					if tmpCfg.Threads < 1 {
						tmpCfg.Threads = 3
					}
					tmpCfg.Total = delta // 兜底上限基数（maxSubmit ≈ delta*3，硬顶 50）
					// 判停按监控页补号模式：
					//   available → getStats 真实可用数补到 target
					//   total     → 成功注册数补满 delta（每成功 1 个号池总数 +1，即补到 target）
					if refillMode == "available" {
						tmpCfg.Mode = "available"
						tmpCfg.TargetAvailable = target
					} else {
						tmpCfg.Mode = "total"
					}
					go func() {
						defer atomic.StoreInt32(&m.refilling, 0)
						defer func() {
							if rec := recover(); rec != nil {
								log.Printf("[monitor] 补号 goroutine panic: %v", rec)
								broker.Log(fmt.Sprintf("❌ 补号异常: %v", rec), "red", "", 0)
							}
							// 评估本轮成效：补号后可用数涨幅 < 1 视为低效，累计退避
							st, _ := m.mysql.GetAccountStats()
							gained := 0
							if st != nil {
								gained = st.Active - beforeActive
							}
							m.mu.Lock()
							if gained < 1 {
								m.refillLowYield++
								if m.refillLowYield >= 3 {
									m.refillCooldownTo = time.Now().Add(30 * time.Minute)
									m.refillLowYield = 0
									m.mu.Unlock()
									broker.Log("🛑 连续3轮补号低效，自动补号冷却30分钟（请检查代理/注册成功率）", "red", "", 0)
									return
								}
							} else {
								m.refillLowYield = 0 // 有效则重置
							}
							m.mu.Unlock()
						}()
						RegisterOnce(&tmpCfg, func(acc *model.Account) {
							if err := RefreshAccount(acc, regCfg.Proxy); err == nil {
								m.mysql.AddAccounts([]string{acc.AccessToken}, "web")
								m.mysql.UpdateAccountByToken(acc)
							}
						}, func() (int, int) {
							// 按号池真实状态判停（量纲与 delta 一致），而非只看注册成功数
							st, _ := m.mysql.GetAccountStats()
							if st == nil {
								return 0, 0
							}
							return st.TotalQuota, st.Active
						})
					}()
					broker.Log("🔧 补注册任务已提交", "", "", 0)
				}
			}
		}
	}
}

func (m *AccountMonitor) IsRunning() bool {
	return atomic.LoadInt32(&m.checking) == 1
}

func (m *AccountMonitor) RunOnce() {
	m.runCheck()
}

// isTransientNetErr 判断错误是否为本地 TLS/网络层故障（与账号本身无关）。
// 这类错误（如 TLS 握手失败、连接超时、代理不可用）不应导致账号被标记异常或删除，
// 否则会因本地环境抖动误删好账号。
func isTransientNetErr(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	markers := []string{
		"tls 握手失败",            // 自定义 TLS 握手错误
		"unsupported curve",      // utls 指纹生成偶发
		"handshake",              // TLS handshake failure
		"tls:",                   // 其他 TLS 错误
		"connection refused",     // 代理/网络拒绝
		"connection reset",       // 连接被重置
		"timeout",                // 超时
		"deadline exceeded",      // context 超时
		"no such host",           // DNS 解析失败
		"network is unreachable", // 网络不可达
		"eof",                    // 连接意外断开
		"连接代理",                // 代理连接失败
		"网络:",                   // healthCheck 的网络错误前缀
	}
	for _, mk := range markers {
		if strings.Contains(s, mk) {
			return true
		}
	}
	return false
}
