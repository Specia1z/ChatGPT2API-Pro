package service

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"chatgpt2api-pro/internal/store"
)

type StorageCleaner struct {
	mu      sync.Mutex
	stopCh  chan struct{}
	running bool
	mysql   *store.MySQLStore
}

func NewStorageCleaner(mysql *store.MySQLStore) *StorageCleaner {
	return &StorageCleaner{mysql: mysql}
}

// Start 启动后台定时清理 goroutine（幂等）
func (sc *StorageCleaner) Start() {
	sc.mu.Lock()
	if sc.running {
		sc.mu.Unlock()
		return
	}
	sc.stopCh = make(chan struct{})
	sc.running = true
	sc.mu.Unlock()

	go sc.loop()
	log.Println("[cleaner] started")
}

// Stop 停止后台清理 goroutine（幂等）
func (sc *StorageCleaner) Stop() {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if !sc.running {
		return
	}
	close(sc.stopCh)
	sc.running = false
	log.Println("[cleaner] stopped")
}

// IsRunning 返回 cleaner 是否在运行
func (sc *StorageCleaner) IsRunning() bool {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.running
}

func (sc *StorageCleaner) loop() {
	// 启动后立即执行一次
	sc.RunOnce()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sc.RunOnce()
		case <-sc.stopCh:
			return
		}
	}
}

// RunOnce 执行一次清理：按 DB 过期记录驱动（而非遍历文件系统）。
// 流程：查早于阈值的 local 存储记录 → 删对应文件 → 删 DB 记录 → 清空残留空目录。
// 这样路径还原与读取端(handler 代理)完全一致，且记录连同删除，不会留下孤儿记录。
func (sc *StorageCleaner) RunOnce() {
	cfg, _ := sc.mysql.GetSettings()
	if cfg.StorageCleanupDays <= 0 {
		return
	}
	storageCfg, _ := sc.mysql.GetStorageConfig()
	if storageCfg.Type != "local" || storageCfg.LocalPath == "" {
		return
	}

	threshold := time.Now().AddDate(0, 0, -cfg.StorageCleanupDays)
	const batch = 500
	totalDeleted := 0

	for {
		gens, err := sc.mysql.ListExpiredLocalGenerations(threshold, batch)
		if err != nil {
			log.Printf("[cleaner] list expired fail: %v", err)
			return
		}
		if len(gens) == 0 {
			break
		}

		var doneIDs []int64
		for _, g := range gens {
			// 与读取端 handler 一致地还原文件路径：去掉 LocalURL 前缀再 Join LocalPath。
			// filepath.Join 接受正斜杠输入，跨平台安全（根治 Windows 分隔符不匹配问题）。
			relPath := strings.TrimPrefix(g.ImageURL, storageCfg.LocalURL)
			relPath = strings.TrimPrefix(relPath, "/")
			filePath := filepath.Join(storageCfg.LocalPath, filepath.Clean(relPath))
			if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
				// 删文件失败（非"文件已不存在")：保留 DB 记录，下轮重试，不强删避免数据丢失
				log.Printf("[cleaner] remove fail (keep record): %s: %v", filePath, err)
				continue
			}
			doneIDs = append(doneIDs, g.ID)
		}

		if len(doneIDs) > 0 {
			if _, err := sc.mysql.DeleteGenerationsByIDs(doneIDs); err != nil {
				log.Printf("[cleaner] delete records fail: %v", err)
			} else {
				totalDeleted += len(doneIDs)
			}
		}

		// 本批全部删文件失败（doneIDs 为空但 gens 非空）→ 避免死循环，跳出
		if len(doneIDs) == 0 {
			break
		}
		if len(gens) < batch {
			break
		}
	}

	if totalDeleted > 0 {
		removeEmptyDirs(storageCfg.LocalPath)
		log.Printf("[cleaner] done, %d expired generations cleaned (retention=%dd)", totalDeleted, cfg.StorageCleanupDays)
	}
}

// removeEmptyDirs 递归删除 root 下的空子目录（不删 root 本身）。清理过期文件后收尾用。
func removeEmptyDirs(root string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(root, e.Name())
		removeEmptyDirs(sub)
		// 子目录处理完后若已空则删除（os.Remove 对非空目录会失败，安全）
		if rest, err := os.ReadDir(sub); err == nil && len(rest) == 0 {
			os.Remove(sub)
		}
	}
}
