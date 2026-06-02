package storage

import "context"

type Storage interface {
	Save(ctx context.Context, path string, data []byte) (string, error)
	Delete(ctx context.Context, path string) error
}
