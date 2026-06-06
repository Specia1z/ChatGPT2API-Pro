package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"chatgpt2api-pro/internal/model"
)

// newTestS3 构造一个指向 httptest server 的 s3Store（明文 http）。
func newTestS3(t *testing.T, serverURL, bucket string) *s3Store {
	t.Helper()
	endpoint := strings.TrimPrefix(serverURL, "http://")
	return &s3Store{
		endpoint:  endpoint,
		bucket:    bucket,
		accessKey: "AKIATEST",
		secretKey: "secret",
		region:    "us-east-1",
		useSSL:    false,
	}
}

func TestS3SaveSuccess(t *testing.T) {
	var gotMethod, gotPath, gotAuth, gotContentType string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	s := newTestS3(t, srv.URL, "my-bucket")
	data := []byte("fake-png-bytes")
	url, err := s.Save(context.Background(), "u/1/2.png", data)
	if err != nil {
		t.Fatalf("Save 失败: %v", err)
	}
	if gotMethod != "PUT" {
		t.Errorf("期望 PUT，得到 %s", gotMethod)
	}
	if gotPath != "/my-bucket/u/1/2.png" {
		t.Errorf("path-style 路径错误: %s", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("缺少 V4 签名头: %q", gotAuth)
	}
	if gotContentType != "image/png" {
		t.Errorf("Content-Type 错误: %s", gotContentType)
	}
	if string(gotBody) != string(data) {
		t.Errorf("body 不一致")
	}
	if !strings.HasSuffix(url, "/my-bucket/u/1/2.png") {
		t.Errorf("返回 URL 错误: %s", url)
	}
}

func TestS3SaveHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		io.WriteString(w, "AccessDenied")
	}))
	defer srv.Close()

	s := newTestS3(t, srv.URL, "b")
	_, err := s.Save(context.Background(), "k.png", []byte("x"))
	if err == nil {
		t.Fatal("HTTP 403 应返回错误")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("错误信息应含状态码: %v", err)
	}
}

func TestS3DeleteStatusHandling(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		wantErr bool
	}{
		{"204 成功", 204, false},
		{"200 成功", 200, false},
		{"404 幂等容忍", 404, false},
		{"403 失败", 403, true},
		{"500 失败", 500, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "DELETE" {
					t.Errorf("期望 DELETE，得到 %s", r.Method)
				}
				w.WriteHeader(c.status)
			}))
			defer srv.Close()

			s := newTestS3(t, srv.URL, "b")
			err := s.Delete(context.Background(), "u/1/2.png")
			if c.wantErr && err == nil {
				t.Errorf("状态 %d 应返回错误", c.status)
			}
			if !c.wantErr && err != nil {
				t.Errorf("状态 %d 不应返回错误，得到 %v", c.status, err)
			}
		})
	}
}

func TestS3SignedGETSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("S3SignedGET 应带签名")
		}
		w.WriteHeader(200)
		io.WriteString(w, "image-data")
	}))
	defer srv.Close()

	cfg := &model.StorageConfig{
		Type:        "s3",
		S3Endpoint:  srv.URL, // 带 http:// → useSSL=false
		S3Bucket:    "b",
		S3AccessKey: "AKIATEST",
		S3SecretKey: "secret",
		S3Region:    "us-east-1",
	}
	data, err := S3SignedGET(context.Background(), cfg, srv.URL+"/b/u/1/2.png")
	if err != nil {
		t.Fatalf("S3SignedGET 失败: %v", err)
	}
	if string(data) != "image-data" {
		t.Errorf("内容错误: %s", data)
	}
}

func TestS3SignedGETHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	}))
	defer srv.Close()

	cfg := &model.StorageConfig{Type: "s3", S3Endpoint: srv.URL, S3Bucket: "b", S3AccessKey: "k", S3SecretKey: "s", S3Region: "us-east-1"}
	if _, err := S3SignedGET(context.Background(), cfg, srv.URL+"/b/x.png"); err == nil {
		t.Fatal("404 应返回错误")
	}
}

func TestFromConfigFallback(t *testing.T) {
	cases := []struct {
		name string
		cfg  *model.StorageConfig
		want string // 期望底层类型名
	}{
		{"database 默认", &model.StorageConfig{Type: "database"}, "*storage.databaseStore"},
		{"未知类型回退 database", &model.StorageConfig{Type: "weird"}, "*storage.databaseStore"},
		{"s3 缺 endpoint 回退", &model.StorageConfig{Type: "s3", S3Bucket: "b"}, "*storage.databaseStore"},
		{"s3 缺 bucket 回退", &model.StorageConfig{Type: "s3", S3Endpoint: "s3.example.com"}, "*storage.databaseStore"},
		{"local 缺路径回退", &model.StorageConfig{Type: "local", LocalURL: "/u"}, "*storage.databaseStore"},
		{"s3 完整不回退", &model.StorageConfig{Type: "s3", S3Endpoint: "s3.example.com", S3Bucket: "b", S3AccessKey: "k", S3SecretKey: "s"}, "*storage.s3Store"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := FromConfig(c.cfg)
			got := typeName(st)
			if got != c.want {
				t.Errorf("FromConfig 类型 = %s, want %s", got, c.want)
			}
		})
	}
}

func typeName(v any) string {
	switch v.(type) {
	case *databaseStore:
		return "*storage.databaseStore"
	case *s3Store:
		return "*storage.s3Store"
	case *localStore:
		return "*storage.localStore"
	default:
		return "unknown"
	}
}
