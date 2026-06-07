package store

import (
	"database/sql"

	"chatgpt2api-pro/internal/model"
)

// --- Share / Gallery ---

// ToggleShare 用户切换分享：开启=进入待审队列(pending，不公开)，关闭=撤回(none，且下架)。
// 先审后发——shared 只有管理员审核通过才会置 1。
func (s *MySQLStore) ToggleShare(genID, userID int64, shared bool) error {
	var q string
	if shared {
		// 仅允许对已完成且有图的生成发起分享；重复发起时 pending/approved 保持幂等
		q = "UPDATE generations SET share_status='pending' WHERE id=? AND user_id=? AND share_status IN ('none','rejected')"
	} else {
		q = "UPDATE generations SET share_status='none', shared=0 WHERE id=? AND user_id=?"
	}
	res, err := s.db.Exec(q, genID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// AdminReviewShare 管理员审核：approve=通过(公开)，reject=拒绝(附原因，不公开)。
func (s *MySQLStore) AdminReviewShare(genID int64, approve bool, reason string) error {
	var err error
	if approve {
		_, err = s.db.Exec("UPDATE generations SET share_status='approved', shared=1, share_reject_reason='' WHERE id=?", genID)
	} else {
		_, err = s.db.Exec("UPDATE generations SET share_status='rejected', shared=0, share_reject_reason=? WHERE id=?", reason, genID)
	}
	return err
}

// AdminUnshare 下架已公开的分享（退回 rejected 状态，记录原因可选）。
func (s *MySQLStore) AdminUnshare(genID int64) error {
	_, err := s.db.Exec("UPDATE generations SET shared=0, share_status='rejected' WHERE id=?", genID)
	return err
}

// ListPendingShares 待审分享队列（管理员）。
func (s *MySQLStore) ListPendingShares(page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE share_status='pending' AND gen_type='image'").Scan(&total)
	rows, err := s.db.Query("SELECT g.id, g.user_id, g.prompt, g.model, COALESCE(g.size,\"\"), COALESCE(g.image_b64,\"\"), COALESCE(g.image_url,\"\"), g.status, COALESCE(u.email,\"\"), COALESCE(u.name,\"\"), g.shared, g.share_status, g.created_at FROM generations g LEFT JOIN users u ON g.user_id=u.id WHERE g.share_status='pending' AND g.status='completed' AND g.gen_type='image' ORDER BY g.id ASC LIMIT ? OFFSET ?", pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		if err := rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.UserEmail, &g.UserName, &g.Shared, &g.ShareStatus, &g.CreatedAt); err != nil {
			continue
		}
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}

func (s *MySQLStore) ListSharedGalleries(page, pageSize int) ([]model.Generation, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM generations WHERE shared=1 AND status=\"completed\" AND gen_type='image' AND ((image_b64 IS NOT NULL AND LENGTH(image_b64) > 100) OR (image_url IS NOT NULL AND image_url != \"\"))").Scan(&total)
	rows, err := s.db.Query("SELECT g.id, g.user_id, g.prompt, g.model, COALESCE(g.size,\"\"), COALESCE(g.image_b64,\"\"), COALESCE(g.image_url,\"\"), g.status, COALESCE(u.email,\"\"), COALESCE(u.name,\"\"), g.shared, g.created_at FROM generations g LEFT JOIN users u ON g.user_id=u.id WHERE g.shared=1 AND g.status=\"completed\" AND g.gen_type='image' AND ((g.image_b64 IS NOT NULL AND LENGTH(g.image_b64) > 100) OR (g.image_url IS NOT NULL AND g.image_url != \"\")) ORDER BY g.id DESC LIMIT ? OFFSET ?", pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var gens []model.Generation
	for rows.Next() {
		var g model.Generation
		if err := rows.Scan(&g.ID, &g.UserID, &g.Prompt, &g.Model, &g.Size, &g.ImageB64, &g.ImageURL, &g.Status, &g.UserEmail, &g.UserName, &g.Shared, &g.CreatedAt); err != nil {
			continue
		}
		gens = append(gens, g)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return gens, total, nil
}
