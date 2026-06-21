package store

import (
	"database/sql"

	"chatgpt2api-pro/internal/model"
)

// scanAnnouncements 把查询结果集扫描为公告切片（统一处理可空的 start_at/end_at）。
func scanAnnouncements(rows *sql.Rows) ([]model.Announcement, error) {
	defer rows.Close()
	var list []model.Announcement
	for rows.Next() {
		var a model.Announcement
		var start, end, created sql.NullString
		if err := rows.Scan(&a.ID, &a.Title, &a.Content, &a.Type, &a.DisplayMode, &a.Link, &a.Priority, &a.Enabled, &a.Dismissible, &start, &end, &created); err != nil {
			return nil, err
		}
		a.StartAt = start.String
		a.EndAt = end.String
		a.CreatedAt = created.String
		list = append(list, a)
	}
	return list, rows.Err()
}

// ListActiveAnnouncements 返回当前生效的公告（已启用，且在 start_at/end_at 时间窗内），按优先级倒序。
// 供公开接口使用。NULL 的起止时间表示不限。
func (s *MySQLStore) ListActiveAnnouncements() ([]model.Announcement, error) {
	rows, err := s.db.Query(`SELECT id, title, COALESCE(content,''), type, COALESCE(display_mode,'banner'), COALESCE(link,''), priority, enabled, dismissible,
		start_at, end_at, created_at FROM announcements
		WHERE enabled=1
		  AND (start_at IS NULL OR start_at <= NOW())
		  AND (end_at IS NULL OR end_at >= NOW())
		ORDER BY priority DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	return scanAnnouncements(rows)
}

// ListAnnouncements 返回全部公告（含禁用/过期），供管理端使用。
func (s *MySQLStore) ListAnnouncements() ([]model.Announcement, error) {
	rows, err := s.db.Query(`SELECT id, title, COALESCE(content,''), type, COALESCE(display_mode,'banner'), COALESCE(link,''), priority, enabled, dismissible,
		start_at, end_at, created_at FROM announcements ORDER BY priority DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	return scanAnnouncements(rows)
}

// nullableTime 把空字符串转为 SQL NULL，否则原样写入（期望 'YYYY-MM-DD HH:MM:SS' 或 RFC3339）。
func nullableTime(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *MySQLStore) CreateAnnouncement(a *model.Announcement) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO announcements (title, content, type, display_mode, link, priority, enabled, dismissible, start_at, end_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		a.Title, a.Content, a.Type, a.DisplayMode, a.Link, a.Priority, a.Enabled, a.Dismissible, nullableTime(a.StartAt), nullableTime(a.EndAt))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *MySQLStore) UpdateAnnouncement(a *model.Announcement) error {
	_, err := s.db.Exec(`UPDATE announcements SET title=?, content=?, type=?, display_mode=?, link=?, priority=?, enabled=?, dismissible=?, start_at=?, end_at=? WHERE id=?`,
		a.Title, a.Content, a.Type, a.DisplayMode, a.Link, a.Priority, a.Enabled, a.Dismissible, nullableTime(a.StartAt), nullableTime(a.EndAt), a.ID)
	return err
}

func (s *MySQLStore) DeleteAnnouncement(id int64) error {
	_, err := s.db.Exec(`DELETE FROM announcements WHERE id=?`, id)
	return err
}
