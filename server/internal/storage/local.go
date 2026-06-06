package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type localStore struct {
	basePath string
	baseURL  string
}

func NewLocalStore(basePath, baseURL string) Storage {
	if basePath == "" {
		panic("local: basePath must not be empty")
	}
	// baseURL 可空：图片统一经 /api/images/{id} 代理读取，不依赖此前缀。
	// 保留它仅用于 Save 返回一个非空 image_url 作为「外部存储」标记。
	os.MkdirAll(basePath, 0755)
	return &localStore{basePath: basePath, baseURL: baseURL}
}

func (s *localStore) Save(ctx context.Context, path string, data []byte) (string, error) {
	if strings.Contains(path, "..") || strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("invalid path: %s", path)
	}
	fullPath := filepath.Join(s.basePath, path)
	os.MkdirAll(filepath.Dir(fullPath), 0755)
	if err := os.WriteFile(fullPath, data, 0644); err != nil {
		return "", fmt.Errorf("local save: %w", err)
	}
	// 返回非空 image_url 标记；读取端按 object key 重建路径，不解析此 URL。
	return strings.TrimRight(s.baseURL, "/") + "/" + path, nil
}

func (s *localStore) Delete(ctx context.Context, path string) error {
	return os.Remove(filepath.Join(s.basePath, path))
}
