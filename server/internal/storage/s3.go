package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

var s3Client = &http.Client{Timeout: 30 * time.Second}

type s3Store struct {
	endpoint  string
	bucket    string
	accessKey string
	secretKey string
	useSSL    bool
	region    string
}

func NewS3Store(endpoint, bucket, accessKey, secretKey, region string, useSSL bool) Storage {
	if endpoint == "" {
		panic("s3: endpoint must not be empty")
	}
	if bucket == "" {
		panic("s3: bucket must not be empty")
	}
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	return &s3Store{
		endpoint:  endpoint,
		bucket:    bucket,
		accessKey: accessKey,
		secretKey: secretKey,
		region:    region,
		useSSL:    useSSL,
	}
}

func (s *s3Store) baseURL() string {
	scheme := "http"
	if s.useSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/%s", scheme, s.endpoint, s.bucket)
}

func (s *s3Store) awsV4Sign(req *http.Request, body []byte) {
	if s.accessKey == "" || s.secretKey == "" {
		return
	}

	now := time.Now().UTC()
	dateStr := now.Format("20060102")
	dateTimeStr := now.Format("20060102T150405Z")
	service := "s3"

	bodyHash := sha256.Sum256(body)
	bodyHex := hex.EncodeToString(bodyHash[:])

	req.Header.Set("x-amz-content-sha256", bodyHex)
	req.Header.Set("x-amz-date", dateTimeStr)

	canonicalURI := req.URL.EscapedPath()
	canonicalQuery := req.URL.RawQuery

	headerSet := make(map[string]bool)
	headers := make(map[string]string)

	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	headers["host"] = host
	headerSet["host"] = true

	for k := range req.Header {
		lower := strings.ToLower(k)
		headers[lower] = strings.TrimSpace(req.Header.Get(k))
		headerSet[lower] = true
	}

	headerKeys := make([]string, 0, len(headerSet))
	for k := range headerSet {
		headerKeys = append(headerKeys, k)
	}
	sort.Strings(headerKeys)

	var canonicalHeaders strings.Builder
	for _, k := range headerKeys {
		canonicalHeaders.WriteString(k)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(headers[k])
		canonicalHeaders.WriteByte('\n')
	}
	signedHeaders := strings.Join(headerKeys, ";")

	canonicalReq := strings.Join([]string{
		req.Method, canonicalURI, canonicalQuery,
		canonicalHeaders.String(), signedHeaders, bodyHex,
	}, "\n")

	credScope := strings.Join([]string{dateStr, s.region, service, "aws4_request"}, "/")
	canonHash := sha256.Sum256([]byte(canonicalReq))
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", dateTimeStr, credScope,
		hex.EncodeToString(canonHash[:]),
	}, "\n")

	signKey := hmacSHA256([]byte("AWS4"+s.secretKey), dateStr)
	signKey = hmacSHA256(signKey, s.region)
	signKey = hmacSHA256(signKey, service)
	signKey = hmacSHA256(signKey, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signKey, stringToSign))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s,SignedHeaders=%s,Signature=%s",
		s.accessKey, credScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func S3SignedGET(ctx context.Context, cfg *model.StorageConfig, objectURL string) ([]byte, error) {
	endpoint := strings.TrimPrefix(cfg.S3Endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	s := &s3Store{
		endpoint:  endpoint,
		bucket:    cfg.S3Bucket,
		accessKey: cfg.S3AccessKey,
		secretKey: cfg.S3SecretKey,
		region:    cfg.S3Region,
		useSSL:    true,
	}
	if strings.HasPrefix(cfg.S3Endpoint, "http://") {
		s.useSSL = false
	} else if cfg.S3UseSSL {
		s.useSSL = true
	}

	req, err := http.NewRequestWithContext(ctx, "GET", objectURL, nil)
	if err != nil {
		return nil, err
	}
	s.awsV4Sign(req, nil)

	resp, err := s3Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return nil, fmt.Errorf("S3 GET HTTP %d: %s", resp.StatusCode, string(errBody))
	}
	return io.ReadAll(resp.Body)
}

func (s *s3Store) Save(ctx context.Context, path string, data []byte) (string, error) {
	url := fmt.Sprintf("%s/%s", s.baseURL(), path)
	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "image/png")
	s.awsV4Sign(req, data)
	resp, err := s3Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("s3 save: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return "", fmt.Errorf("s3 save HTTP %d: %s", resp.StatusCode, string(body))
	}
	return url, nil
}

func (s *s3Store) Delete(ctx context.Context, path string) error {
	url := fmt.Sprintf("%s/%s", s.baseURL(), path)
	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return err
	}
	s.awsV4Sign(req, nil)
	resp, err := s3Client.Do(req)
	if err != nil {
		return fmt.Errorf("s3 delete: %w", err)
	}
	defer resp.Body.Close()
	// S3 删除成功通常返回 204；404 视为对象已不存在，幂等容忍。
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return fmt.Errorf("s3 delete HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
