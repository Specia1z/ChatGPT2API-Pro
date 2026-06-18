package api

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"chatgpt2api-pro/internal/model"
)

// RemoveBGService 管理 Node.js 抠图子进程
type RemoveBGService struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	endpoint string // e.g. "http://127.0.0.1:3001"
	started  bool
}

var removeBG = &RemoveBGService{
	endpoint: "http://127.0.0.1:3001",
}

// Start 启动 Node.js 抠图微服务（仅启动一次）
func (s *RemoveBGService) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return nil
	}

	// 检查是否已经有服务在运行（通过健康检查）
	if resp, err := http.Get(s.endpoint + "/health"); err == nil {
		resp.Body.Close()
		log.Println("[removebg] 检测到已有服务运行")
		s.started = true
		return nil
	}

	// 启动 Node.js 子进程
	s.cmd = exec.Command("node", "internal/removebg/server.js")
	s.cmd.Dir = "."
	// 可以捕获输出日志
	s.cmd.Stdout = log.Writer()
	s.cmd.Stderr = log.Writer()

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("启动 removebg 服务失败: %w", err)
	}

	// 等待服务就绪（最多 30 秒）
	for i := 0; i < 60; i++ {
		time.Sleep(500 * time.Millisecond)
		if resp, err := http.Get(s.endpoint + "/health"); err == nil {
			resp.Body.Close()
			s.started = true
			log.Println("[removebg] Node.js 抠图服务已启动")
			return nil
		}
	}

	return fmt.Errorf("removebg 服务启动超时")
}

// RemoveBackground 调用 Node.js 抠图服务
func (s *RemoveBGService) RemoveBackground(imageData []byte, filename string) ([]byte, error) {
	// 构造 multipart 请求
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("image", filename)
	if err != nil {
		return nil, fmt.Errorf("创建表单失败: %w", err)
	}
	if _, err := part.Write(imageData); err != nil {
		return nil, fmt.Errorf("写入图片失败: %w", err)
	}
	w.Close()

	// 调用 Node.js 服务
	req, err := http.NewRequest("POST", s.endpoint+"/api/removebg", &buf)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用抠图服务失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("抠图失败 (status=%d): %s", resp.StatusCode, string(body))
	}

	return io.ReadAll(resp.Body)
}

// POST /api/user/removebg — 用户抠图（需要登录）
func (h *Handler) RemoveBackground(w http.ResponseWriter, r *http.Request) {
	if err := removeBG.Start(); err != nil {
		log.Printf("[removebg] 启动失败: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "抠图服务启动失败"})
		return
	}

	// 限制上传大小 10MB
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "文件太大或格式错误"})
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "请上传图片 (字段名: image)"})
		return
	}
	defer file.Close()

	imageData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "读取图片失败"})
		return
	}

	log.Printf("[removebg] 用户请求抠图: %s (%d bytes)", header.Filename, len(imageData))

	result, err := removeBG.RemoveBackground(imageData, header.Filename)
	if err != nil {
		log.Printf("[removebg] 抠图失败: %v", err)
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "抠图失败: " + err.Error()})
		return
	}

	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(result)))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="removed-bg.webp"`))
	w.WriteHeader(200)
	w.Write(result)

	log.Printf("[removebg] 抠图完成, 结果大小: %d bytes", len(result))
}
