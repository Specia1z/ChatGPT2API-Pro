package store

import (
	"database/sql"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Generations ---

func (s *MySQLStore) CreateGeneration(userID int64, prompt, model, size string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO generations (user_id, prompt, model, size, status) VALUES (?, ?, ?, ?, 'pending')`, userID, prompt, model, size)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// CreateSVGGeneration 新建一条 AI 矢量(svg)生成记录（pending）。内容后续 UpdateSVGGeneration 写入。
func (s *MySQLStore) CreateSVGGeneration(userID int64, prompt, model string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO generations (user_id, prompt, model, gen_type, status) VALUES (?, ?, ?, 'svg', 'pending')`, userID, prompt, model)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateSVGGeneration 写入 svg 结果：成功时 svg 文本存 image_b64(MEDIUMTEXT)，status=completed；失败写 error_msg。
func (s *MySQLStore) UpdateSVGGeneration(id int64, svg, status, errMsg string) error {
	_, err := s.db.Exec("UPDATE generations SET image_b64=?, status=?, error_msg=? WHERE id=?", svg, status, errMsg, id)
	return err
}

func (s *MySQLStore) SetUserCooldown(userID int64, minutes int) error {
	_, err := s.db.Exec("UPDATE users SET cooldown_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?", minutes, userID)
	return err
}

func (s *MySQLStore) CountUserGenerations(userID int64) (today, week int) {
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND created_at >= CURDATE()", userID).Scan(&today)
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image' AND created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)", userID).Scan(&week)
	return
}

func (s *MySQLStore) CleanupStaleGenerations(timeoutMinutes int) (int64, error) {
	res, err := s.db.Exec(`UPDATE generations SET status='failed', error_msg='生成超时' WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`, timeoutMinutes)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *MySQLStore) DeleteUserGeneration(id, userID int64) error {
	res, err := s.db.Exec(`DELETE FROM generations WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ListExpiredExternalGenerations 取早于 before 的「外部存储」记录（image_url 非空），用于过期清理。
// 涵盖 local 与 s3 两种模式（两者都写 image_url），database 模式记录随行删除不在此列。
// 跳过已分享到广场的图（shared=0），按 created_at 升序优先清理最旧的，limit 分批控制单次量。
func (s *MySQLStore) ListExpiredExternalGenerations(before time.Time, limit int) ([]model.Generation, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, COALESCE(image_url,'') FROM generations
		 WHERE image_url IS NOT NULL AND image_url != '' AND shared=0 AND created_at < ?
		 ORDER BY created_at ASC LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		if err := rows.Scan(&g.ID, &g.UserID, &g.ImageURL); err != nil {
			return nil, err
		}
		gens = append(gens, g)
	}
	return gens, rows.Err()
}

// DeleteGenerationsByIDs 按 id 批量删除记录，返回删除行数。
func (s *MySQLStore) DeleteGenerationsByIDs(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	res, err := s.db.Exec(`DELETE FROM generations WHERE id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *MySQLStore) GetGenerationByID(id int64) (*model.Generation, error) {
	var g model.Generation
	err := s.db.QueryRow("SELECT id, user_id, prompt, model, COALESCE(size,''), COALESCE(image_b64,''), COALESCE(image_url,''), status, COALESCE(error_msg,''), shared, created_at FROM generations WHERE id=?", id).
		Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.Shared, &g.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (s *MySQLStore) UpdateGeneration(id int64, imageB64, status, errMsg, imageURL string) error {
	_, err := s.db.Exec("UPDATE generations SET image_b64=?, image_url=?, status=?, error_msg=? WHERE id=?", imageB64, imageURL, status, errMsg, id)
	return err
}

func (s *MySQLStore) GetUserGenerations(userID int64, page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='image'", userID).Scan(&total)
	rows, err := s.db.Query("SELECT id, user_id, prompt, model, COALESCE(size,''), COALESCE(image_b64,''), COALESCE(image_url,''), status, COALESCE(error_msg,''), created_at, shared, COALESCE(share_status,'none'), COALESCE(share_reject_reason,'') FROM generations WHERE user_id=? AND gen_type='image' ORDER BY id DESC LIMIT ? OFFSET ?", userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.CreatedAt, &g.Shared, &g.ShareStatus, &g.ShareRejectReason)
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

// GetUserSVGGenerations 用户的 AI 矢量历史（gen_type=svg）。SVG 文本存在 image_b64 列。
func (s *MySQLStore) GetUserSVGGenerations(userID int64, page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE user_id=? AND gen_type='svg'", userID).Scan(&total)
	rows, err := s.db.Query("SELECT id, user_id, prompt, model, COALESCE(image_b64,''), status, COALESCE(error_msg,''), created_at FROM generations WHERE user_id=? AND gen_type='svg' ORDER BY id DESC LIMIT ? OFFSET ?", userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.ImageB64, &g.Status, &g.ErrorMsg, &g.CreatedAt)
		g.GenType = "svg"
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

func (s *MySQLStore) GetAllGenerations(page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE gen_type='image'").Scan(&total)
	rows, err := s.db.Query("SELECT g.id, g.user_id, g.prompt, g.model, COALESCE(g.size,''), COALESCE(g.image_b64,''), COALESCE(g.image_url,''), g.status, COALESCE(g.error_msg,''), g.created_at, COALESCE(u.email,''), COALESCE(u.name,''), g.shared, COALESCE(g.share_status,'none') FROM generations g LEFT JOIN users u ON g.user_id=u.id WHERE g.gen_type='image' ORDER BY g.id DESC LIMIT ? OFFSET ?", pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.ErrorMsg, &g.CreatedAt, &g.UserEmail, &g.UserName, &g.Shared, &g.ShareStatus)
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}
