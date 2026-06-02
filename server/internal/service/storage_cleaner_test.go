package service

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRemoveEmptyDirs 验证过期清理收尾的空目录递归删除：
// 空子目录被删、含文件的目录保留、root 本身不被删。
func TestRemoveEmptyDirs(t *testing.T) {
	root := t.TempDir()

	// 构造：
	//   root/empty1/empty2      （全空，应被删）
	//   root/keep/a.png         （含文件，应保留）
	//   root/mixed/empty3       （empty3 空应删，mixed 因含 keepfile 保留）
	//   root/mixed/keepfile.txt
	mustMkdir(t, filepath.Join(root, "empty1", "empty2"))
	mustMkdir(t, filepath.Join(root, "keep"))
	mustWrite(t, filepath.Join(root, "keep", "a.png"))
	mustMkdir(t, filepath.Join(root, "mixed", "empty3"))
	mustWrite(t, filepath.Join(root, "mixed", "keepfile.txt"))

	removeEmptyDirs(root)

	// empty1 整条应被删
	if _, err := os.Stat(filepath.Join(root, "empty1")); !os.IsNotExist(err) {
		t.Errorf("empty1 应被删除，但仍存在")
	}
	// keep 及其文件保留
	if _, err := os.Stat(filepath.Join(root, "keep", "a.png")); err != nil {
		t.Errorf("keep/a.png 应保留: %v", err)
	}
	// mixed 保留（含文件），但其下 empty3 应被删
	if _, err := os.Stat(filepath.Join(root, "mixed")); err != nil {
		t.Errorf("mixed 应保留: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "mixed", "empty3")); !os.IsNotExist(err) {
		t.Errorf("mixed/empty3 应被删除，但仍存在")
	}
	// root 本身必须保留
	if _, err := os.Stat(root); err != nil {
		t.Errorf("root 不应被删除: %v", err)
	}
}

func mustMkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", p, err)
	}
}

func mustWrite(t *testing.T, p string) {
	t.Helper()
	if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
}
