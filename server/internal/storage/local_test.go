package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestObjectKeyStable(t *testing.T) {
	// object key 规则是保存/读取/删除/清理共享的契约，固定格式不可随意更改
	if got := ObjectKey(1, 2); got != "u/1/2.png" {
		t.Errorf("ObjectKey(1,2) = %q, want u/1/2.png", got)
	}
	if got := ObjectKey(42, 1000); got != "u/42/1000.png" {
		t.Errorf("ObjectKey(42,1000) = %q", got)
	}
}

// TestLocalSaveThenReadByObjectKey 验证 local 模式下：Save 写入后，
// 仅凭 ObjectKey 重建路径即可读回文件，不依赖 Save 返回的 URL。
// 这是「LocalURL 前端路径热切换不影响读取」的核心保证。
func TestLocalSaveThenReadByObjectKey(t *testing.T) {
	dir := t.TempDir()
	st := NewLocalStore(dir, "/uploads")

	key := ObjectKey(7, 99)
	data := []byte("png-bytes")
	urlA, err := st.Save(context.Background(), key, data)
	if err != nil {
		t.Fatalf("Save 失败: %v", err)
	}

	// 读取端只用 LocalPath + ObjectKey 定位，完全不碰返回的 URL
	got, err := os.ReadFile(filepath.Join(dir, filepath.Clean(key)))
	if err != nil {
		t.Fatalf("按 ObjectKey 读取失败: %v", err)
	}
	if string(got) != string(data) {
		t.Errorf("内容不一致: %q", got)
	}

	// 即便之后 LocalURL 改了（用不同前缀重新构造 store），同一 key 仍能读到旧文件
	st2 := NewLocalStore(dir, "/files-new-prefix")
	urlB, _ := st2.Save(context.Background(), ObjectKey(7, 100), []byte("x"))
	if urlA == urlB {
		t.Error("不同 key 不应产生相同 URL")
	}
	if _, err := os.ReadFile(filepath.Join(dir, filepath.Clean(key))); err != nil {
		t.Errorf("LocalURL 变更后旧文件应仍可按 ObjectKey 读取: %v", err)
	}
}

func TestLocalSaveRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	st := NewLocalStore(dir, "/uploads")
	if _, err := st.Save(context.Background(), "../escape.png", []byte("x")); err == nil {
		t.Error("含 .. 的路径应被拒绝")
	}
	if _, err := st.Save(context.Background(), "/abs.png", []byte("x")); err == nil {
		t.Error("绝对路径应被拒绝")
	}
}

// TestLocalEmptyBaseURL 验证 baseURL 留空时不 panic，且返回非空 image_url 标记。
func TestLocalEmptyBaseURL(t *testing.T) {
	dir := t.TempDir()
	st := NewLocalStore(dir, "") // 代理读取模式下 LocalURL 可选
	url, err := st.Save(context.Background(), ObjectKey(1, 2), []byte("x"))
	if err != nil {
		t.Fatalf("空 baseURL Save 失败: %v", err)
	}
	if url == "" {
		t.Error("image_url 标记不应为空，否则代理会误走 base64 分支")
	}
	// 文件仍按 object key 落盘
	if _, err := os.ReadFile(filepath.Join(dir, filepath.Clean(ObjectKey(1, 2)))); err != nil {
		t.Errorf("文件应已写入: %v", err)
	}
}
