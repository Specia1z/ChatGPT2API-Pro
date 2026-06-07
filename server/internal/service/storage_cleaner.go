package service

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"chatgpt2api-pro/internal/storage"
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
	log.Println("🧽 存储清理已启动")
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
	log.Println("🧽 存储清理已停止")
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
// 流程：查早于阈值的外部存储记录 → 删对应对象（local 文件 / S3 对象）→ 删 DB 记录。
// 记录连同对象一起删除，不会留下孤儿记录或孤儿对象。
func (sc *StorageCleaner) RunOnce() {
	cfg, _ := sc.mysql.GetSettings()
	if cfg.StorageCleanupDays <= 0 {
		return
	}
	storageCfg, _ := sc.mysql.GetStorageConfig()
	if storageCfg == nil {
		return
	}
	// 仅外部存储需要清理；database 模式记录随行删除即可（此处不处理 base64 记录）。
	switch storageCfg.Type {
	case "local":
		if storageCfg.LocalPath == "" {
			return
		}
	case "s3":
		// S3 模式无需额外前置校验
	default:
		return
	}

	var s3st storage.Storage
	if storageCfg.Type == "s3" {
		s3st = storage.FromConfig(storageCfg)
	}

	threshold := time.Now().AddDate(0, 0, -cfg.StorageCleanupDays)
	const batch = 500
	totalDeleted := 0

	for {
		gens, err := sc.mysql.ListExpiredExternalGenerations(threshold, batch)
		if err != nil {
			log.Printf("[cleaner] list expired fail: %v", err)
			return
		}
		if len(gens) == 0 {
			break
		}

		var doneIDs []int64
		for _, g := range gens {
			var delErr error
			// 统一按确定性 object key 定位，不依赖 image_url 里嵌入的 LocalURL/endpoint，
			// 这样存储访问前缀热切换后清理仍能正确命中文件。
			key := storage.ObjectKey(g.UserID, g.ID)
			if storageCfg.Type == "s3" {
				delErr = s3st.Delete(context.Background(), key)
			} else {
				// local：filepath.Join 接受正斜杠输入，跨平台安全。
				filePath := filepath.Join(storageCfg.LocalPath, filepath.Clean(key))
				if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
					delErr = err
				}
			}
			if delErr != nil {
				// 删对象失败：保留 DB 记录，下轮重试，不强删避免对象泄漏后无从追溯
				log.Printf("[cleaner] delete object fail (keep record) gen=%d: %v", g.ID, delErr)
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

		// 本批全部删失败（doneIDs 为空但 gens 非空）→ 避免死循环，跳出
		if len(doneIDs) == 0 {
			break
		}
		if len(gens) < batch {
			break
		}
	}

	if totalDeleted > 0 {
		if storageCfg.Type == "local" {
			removeEmptyDirs(storageCfg.LocalPath)
		}
		log.Printf("[cleaner] done, %d expired generations cleaned (retention=%dd, type=%s)", totalDeleted, cfg.StorageCleanupDays, storageCfg.Type)
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
