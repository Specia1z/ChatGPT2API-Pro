package api

import (
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// 公开 GET 接口缓存：plans/gallery/公告/stats 等匿名可刷、变化慢的响应，
// 用进程内缓存 + 短 TTL 降库压。TTL 由后台 settings.public_cache_ttl_seconds 控制，
// 0=不缓存（保持原行为）。缓存的是已序列化的响应体，命中直接写回。

var publicCacheTTL atomic.Int64 // 纳秒；0=禁用

// setPublicCacheTTL 设置公开接口缓存 TTL（秒）。0=禁用并清空。
func setPublicCacheTTL(seconds int) {
	if seconds < 0 {
		seconds = 0
	}
	publicCacheTTL.Store(int64(seconds) * int64(time.Second))
	if seconds == 0 {
		publicCache.purge()
	}
}

type cacheEntry struct {
	body   []byte
	status int
	at     time.Time
}

type respCache struct {
	mu sync.RWMutex
	m  map[string]cacheEntry
}

var publicCache = &respCache{m: make(map[string]cacheEntry)}

func (c *respCache) purge() {
	c.mu.Lock()
	c.m = make(map[string]cacheEntry)
	c.mu.Unlock()
}

func (c *respCache) get(key string, ttl int64) (cacheEntry, bool) {
	c.mu.RLock()
	e, ok := c.m[key]
	c.mu.RUnlock()
	if !ok || time.Since(e.at).Nanoseconds() >= ttl {
		return cacheEntry{}, false
	}
	return e, true
}

func (c *respCache) set(key string, e cacheEntry) {
	c.mu.Lock()
	c.m[key] = e
	c.mu.Unlock()
}

// cacheWriter 截获 handler 输出以便缓存
type cacheWriter struct {
	http.ResponseWriter
	status int
	buf    []byte
}

func (w *cacheWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *cacheWriter) Write(b []byte) (int, error) {
	w.buf = append(w.buf, b...)
	return w.ResponseWriter.Write(b)
}

// publicCached 包装公开 GET handler：命中缓存直接返回，否则执行并缓存。
// 缓存键 = 路径 + 原始查询串（区分分页）。仅缓存 200 响应。
func publicCached(keyPrefix string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ttl := publicCacheTTL.Load()
		if ttl <= 0 {
			next(w, r)
			return
		}
		key := keyPrefix + "?" + r.URL.RawQuery
		if e, ok := publicCache.get(key, ttl); ok {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(e.status)
			w.Write(e.body)
			return
		}
		cw := &cacheWriter{ResponseWriter: w, status: 200}
		next(cw, r)
		if cw.status == 200 && len(cw.buf) > 0 {
			publicCache.set(key, cacheEntry{body: cw.buf, status: cw.status, at: time.Now()})
		}
	}
}
