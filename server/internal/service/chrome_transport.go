package service

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	utls "github.com/refraction-networking/utls"
)

// chromeRoundTripper 自定义 RoundTripper:
// 代理 + utls 随机指纹 + HTTP/1.1
// 每次请求使用不同的随机 TLS 指纹
type chromeRoundTripper struct {
	ProxyURL *url.URL
}

func newChromeTransport(proxyURL *url.URL) http.RoundTripper {
	return &chromeRoundTripper{ProxyURL: proxyURL}
}

func newChromeTransportFromURL(proxyURL *url.URL) http.RoundTripper {
	return &chromeRoundTripper{ProxyURL: proxyURL}
}

func (t *chromeRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()
	targetHost := req.URL.Host
	if _, _, err := net.SplitHostPort(targetHost); err != nil {
		targetHost = net.JoinHostPort(targetHost, "443")
	}

	// utls TLS 握手（固定 Chrome 指纹优先，回退随机指纹）+ HTTP/1.1，失败重试。
	// 每次重试重新建立 TCP 连接
	tlsConn, err := dialUTLSWithRetry(ctx, t.ProxyURL, targetHost, 4)
	if err != nil {
		return nil, fmt.Errorf("TLS 握手失败: %w", err)
	}

	// 发送 HTTP/1.1 请求
	return sendHTTPRequest(tlsConn, req)
}

func dialProxy(ctx context.Context, proxyURL *url.URL, targetHost string) (net.Conn, error) {
	if proxyURL == nil {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		return dialer.DialContext(ctx, "tcp", targetHost)
	}

	proxyAddr := proxyURL.Host
	if _, _, err := net.SplitHostPort(proxyAddr); err != nil {
		proxyAddr = net.JoinHostPort(proxyAddr, "80")
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, fmt.Errorf("连接代理: %w", err)
	}

	// CONNECT 读写设 deadline，防止半开代理（接受 TCP 后静默）导致永久阻塞
	conn.SetDeadline(time.Now().Add(15 * time.Second))

	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", targetHost, targetHost)
	if _, err := conn.Write([]byte(connectReq)); err != nil {
		conn.Close()
		return nil, fmt.Errorf("CONNECT write: %w", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("CONNECT response: %w", err)
	}
	if resp.StatusCode != 200 {
		conn.Close()
		return nil, fmt.Errorf("CONNECT HTTP %d", resp.StatusCode)
	}
	// 清除 CONNECT 阶段的 deadline，后续握手/业务读写各自重设
	conn.SetDeadline(time.Time{})

	return conn, nil
}

// dialUTLSWithRetry 建立连接 + utls 指纹 TLS 握手，失败重试。
// 用固定 Chrome 指纹的曲线集（解决 HelloRandomized 偶发的 "unsupported curve"），
// 但强制把 ALPN 改成仅 "http/1.1"——因为本 transport 用手写的 HTTP/1.1 收发
// (sendHTTPRequest)，若通告 h2 则服务器(如 auth.openai.com)会回 HTTP/2 帧，
// 导致 "malformed HTTP response" 解析失败。
func dialUTLSWithRetry(ctx context.Context, proxyURL *url.URL, targetHost string, maxRetries int) (net.Conn, error) {
	host, _, _ := net.SplitHostPort(targetHost)

	// 指纹候选：优先多次尝试固定 Chrome 指纹，最后才回退随机指纹。
	fingerprints := []utls.ClientHelloID{
		utls.HelloChrome_120,
		utls.HelloChrome_131,
		utls.HelloChrome_120,
		utls.HelloRandomizedNoALPN,
	}

	var lastErr error
	for i := 0; i < maxRetries; i++ {
		idx := i
		if idx >= len(fingerprints) {
			idx = len(fingerprints) - 1
		}
		hello := fingerprints[idx]

		rawConn, err := dialProxy(ctx, proxyURL, targetHost)
		if err != nil {
			return nil, err
		}

		uconn := utls.UClient(rawConn, &utls.Config{
			ServerName:         host,
			InsecureSkipVerify: true,
		}, utls.HelloCustom)

		// 取指纹 spec，强制 ALPN 仅 http/1.1（避免协商出 h2）
		spec, specErr := utls.UTLSIdToSpec(hello)
		if specErr != nil {
			rawConn.Close()
			lastErr = specErr
			continue
		}
		forceHTTP1ALPN(&spec)
		if err := uconn.ApplyPreset(&spec); err != nil {
			rawConn.Close()
			lastErr = err
			continue
		}

		// TLS 握手设 deadline，防止对端在握手阶段静默导致永久阻塞
		rawConn.SetDeadline(time.Now().Add(30 * time.Second))
		if err := uconn.Handshake(); err != nil {
			rawConn.Close()
			lastErr = err
			continue // 换下一个指纹重试
		}
		rawConn.SetDeadline(time.Time{}) // 握手成功，清除握手 deadline（业务读写阶段另行重设）
		return uconn, nil
	}
	return nil, fmt.Errorf("TLS 握手重试 %d 次均失败: %w", maxRetries, lastErr)
}

// forceHTTP1ALPN 把 spec 中的 ALPN 扩展改成仅 "http/1.1"。
// 若指纹本身无 ALPN 扩展（如 HelloRandomizedNoALPN），保持原样即可。
func forceHTTP1ALPN(spec *utls.ClientHelloSpec) {
	for _, ext := range spec.Extensions {
		if alpn, ok := ext.(*utls.ALPNExtension); ok {
			alpn.AlpnProtocols = []string{"http/1.1"}
		}
	}
}

// sendHTTPRequest 在 TLS 连接上发送 HTTP/1.1 请求
func sendHTTPRequest(conn net.Conn, req *http.Request) (*http.Response, error) {
	// 业务请求读写设 deadline，防止对端在响应阶段静默导致永久阻塞。
	// 优先用调用方 context 的 deadline；否则用 200s 兜底（覆盖最长的生图请求 180s + 余量）。
	deadline := time.Now().Add(200 * time.Second)
	if d, ok := req.Context().Deadline(); ok {
		deadline = d
	}
	conn.SetDeadline(deadline)

	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("请求写入失败: %w", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("响应读取失败: %w", err)
	}
	// http.ReadResponse 的 resp.Body 读自裸 conn，调用方 Close() 只关 body reader、
	// 不会关闭底层连接——每个成功请求都会泄漏一个 conn(及走代理时的 socket)。
	// 这里把 Body 包一层，使其 Close() 连带关闭 conn；并发拉满时该泄漏尤为明显。
	resp.Body = &connClosingBody{ReadCloser: resp.Body, conn: conn}
	return resp, nil
}

// connClosingBody 包装 resp.Body，Close() 时连带关闭底层 net.Conn（幂等，防双关）。
type connClosingBody struct {
	io.ReadCloser
	conn   net.Conn
	closed bool
}

func (b *connClosingBody) Close() error {
	if b.closed {
		return nil
	}
	b.closed = true
	err := b.ReadCloser.Close()
	if cerr := b.conn.Close(); cerr != nil && err == nil {
		err = cerr
	}
	return err
}
