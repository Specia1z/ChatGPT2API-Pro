package storage

import (
	"context"
	"fmt"
)

type Storage interface {
	Save(ctx context.Context, path string, data []byte) (string, error)
	Delete(ctx context.Context, path string) error
}

// ObjectKey 返回某条生图记录在外部存储中的对象 key（相对路径）。
// 规则在保存、读取、删除、清理之间必须保持一致——所有地方都应调用此函数，
// 不要再在别处硬编码 "u/%d/%d.png"，否则规则漂移会导致读不到/删不掉对象。
// 该 key 不含任何 LocalURL/endpoint 前缀，因此前端访问前缀热切换不影响它。
func ObjectKey(userID, genID int64) string {
	return fmt.Sprintf("u/%d/%d.png", userID, genID)
}

