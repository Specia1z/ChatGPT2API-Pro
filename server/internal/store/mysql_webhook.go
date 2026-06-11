package store

import (
	"database/sql"

	"chatgpt2api-pro/internal/model"
)

// --- User Webhook ---
// 每用户一行（user_id 主键）。API Key 异步生图完成/失败时，service 层据此投递回调。

// GetUserWebhook 取用户 webhook 配置；未配置返回 (nil, nil)。
func (s *MySQLStore) GetUserWebhook(userID int64) (*model.UserWebhook, error) {
	var w model.UserWebhook
	var lastDeliverAt, createdAt, updatedAt sql.NullString
	err := s.db.QueryRow(`SELECT user_id, url, secret, enabled, last_status, last_error, last_deliver_at, created_at, updated_at
		FROM user_webhooks WHERE user_id=?`, userID).
		Scan(&w.UserID, &w.URL, &w.Secret, &w.Enabled, &w.LastStatus, &w.LastError, &lastDeliverAt, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.HasSecret = w.Secret != ""
	w.LastDeliverAt = lastDeliverAt.String
	w.CreatedAt = createdAt.String
	w.UpdatedAt = updatedAt.String
	return &w, nil
}

// SaveUserWebhook upsert 用户 webhook（url/secret/enabled）。
// secret 为空时保留 DB 中现有值（前端 GET 抹除密钥后回填保存不应清空）。
func (s *MySQLStore) SaveUserWebhook(userID int64, url, secret string, enabled bool) error {
	if secret == "" {
		if existing, _ := s.GetUserWebhook(userID); existing != nil {
			secret = existing.Secret
		}
	}
	_, err := s.db.Exec(`INSERT INTO user_webhooks (user_id, url, secret, enabled)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE url=VALUES(url), secret=VALUES(secret), enabled=VALUES(enabled)`,
		userID, url, secret, enabled)
	return err
}

// DeleteUserWebhook 删除用户 webhook 配置。
func (s *MySQLStore) DeleteUserWebhook(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM user_webhooks WHERE user_id=?`, userID)
	return err
}

// UpdateWebhookDeliveryResult 记录最近一次投递结果（status=HTTP 码，0=网络错误；errMsg 空=成功）。
// 仅当用户已配置 webhook 时更新，best-effort，失败不影响生图主流程。
func (s *MySQLStore) UpdateWebhookDeliveryResult(userID int64, status int, errMsg string) {
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	s.db.Exec(`UPDATE user_webhooks SET last_status=?, last_error=?, last_deliver_at=NOW() WHERE user_id=?`,
		status, errMsg, userID)
}
