package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

var turnstileClient = &http.Client{Timeout: 10 * time.Second}

func VerifyTurnstileToken(token, secretKey string) (bool, error) {
	if token == "" || secretKey == "" {
		return false, nil
	}
	data := url.Values{
		"secret":   {secretKey},
		"response": {token},
	}
	resp, err := turnstileClient.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", data)
	if err != nil {
		return false, fmt.Errorf("turnstile verify: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Success bool `json:"success"`
	}
	json.Unmarshal(body, &result)
	return result.Success, nil
}
