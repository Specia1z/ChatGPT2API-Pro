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
	if baseURL == "" {
		panic("local: baseURL must not be empty")
	}
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
	return s.baseURL + "/" + path, nil
}

func (s *localStore) Delete(ctx context.Context, path string) error {
	return os.Remove(filepath.Join(s.basePath, path))
}
