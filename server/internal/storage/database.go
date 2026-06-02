package storage

import "context"

type databaseStore struct{}

func NewDatabaseStore() Storage {
	return &databaseStore{}
}

func (s *databaseStore) Save(ctx context.Context, path string, data []byte) (string, error) {
	return "", nil // 返回空 URL，由上层写 image_b64
}

func (s *databaseStore) Delete(ctx context.Context, path string) error {
	return nil // 不做操作
}
