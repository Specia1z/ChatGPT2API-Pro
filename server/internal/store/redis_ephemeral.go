package store

import (
	"context"
	"fmt"
	"time"
)

// 短时图片/SVG 缓存：API Key 生成的内容不永久落盘/落库，
// 只在 Redis 暂存（带 TTL），用户在有效期内通过签名代理地址取，过期自动清理。
// 省永久存储空间；凭证不外泄、后端地址不暴露（仍走 /api/images/{id} 代理）。

func ephImgKey(genID int64) string { return fmt.Sprintf("ephimg:%d", genID) }
func ephSVGKey(genID int64) string { return fmt.Sprintf("ephsvg:%d", genID) }

// SetEphemeralImage 暂存图片字节（PNG），TTL 到期自动删除。
func (r *RedisStore) SetEphemeralImage(ctx context.Context, genID int64, data []byte, ttl time.Duration) error {
	return r.client.Set(ctx, ephImgKey(genID), data, ttl).Err()
}

// GetEphemeralImage 取暂存图片字节；不存在/已过期返回 (nil, false)。
func (r *RedisStore) GetEphemeralImage(ctx context.Context, genID int64) ([]byte, bool) {
	b, err := r.client.Get(ctx, ephImgKey(genID)).Bytes()
	if err != nil || len(b) == 0 {
		return nil, false
	}
	return b, true
}

// SetEphemeralSVG 暂存 SVG 源码文本。
func (r *RedisStore) SetEphemeralSVG(ctx context.Context, genID int64, svg string, ttl time.Duration) error {
	return r.client.Set(ctx, ephSVGKey(genID), svg, ttl).Err()
}

// GetEphemeralSVG 取暂存 SVG 文本。
func (r *RedisStore) GetEphemeralSVG(ctx context.Context, genID int64) (string, bool) {
	s, err := r.client.Get(ctx, ephSVGKey(genID)).Result()
	if err != nil || s == "" {
		return "", false
	}
	return s, true
}
