package service

import (
	"fmt"
	"log"
	"time"

	"chatgpt2api-pro/internal/metrics"
	"chatgpt2api-pro/internal/store"
)

// OrderExpirer 后台定时把超时未支付的订单置为 expired。
// 每分钟检查一次，超时分钟数由 settings.order_timeout_minutes 控制（0=不处理）。
// 读配置走 store 的缓存，开销极小；始终运行（开关由配置的 0 值表达）。
type OrderExpirer struct {
	mysql  *store.MySQLStore
	stopCh chan struct{}
}

func NewOrderExpirer(mysql *store.MySQLStore) *OrderExpirer {
	return &OrderExpirer{mysql: mysql, stopCh: make(chan struct{})}
}

func (e *OrderExpirer) Start() {
	go e.loop()
	log.Println("⏰ 订单超时检查已启动（每分钟一次）")
}

func (e *OrderExpirer) Stop() { close(e.stopCh) }

func (e *OrderExpirer) loop() {
	e.runOnce()
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			e.runOnce()
		case <-e.stopCh:
			return
		}
	}
}

func (e *OrderExpirer) runOnce() {
	cfg, err := e.mysql.GetSettings()
	if err != nil || cfg == nil || cfg.OrderTimeoutMinutes <= 0 {
		return // 未启用，不计为一轮执行
	}
	start := metrics.TimerStart("order_expirer")
	n, err := e.mysql.ExpireStaleOrders(cfg.OrderTimeoutMinutes)
	if err != nil {
		metrics.TimerDone("order_expirer", start, false, err.Error())
		log.Printf("❌ 订单超时检查失败：%v", err)
		return
	}
	metrics.TimerDone("order_expirer", start, true, fmt.Sprintf("过期%d单", n))
	if n > 0 {
		log.Printf("⏳ 已将 %d 个超时未支付订单置为「已过期」（阈值 %d 分钟）", n, cfg.OrderTimeoutMinutes)
	}
}
