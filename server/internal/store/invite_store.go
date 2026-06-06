package store

import (
	"crypto/rand"
	"database/sql"
	"chatgpt2api-pro/internal/model"
)

// 邀请码字符集：去掉易混字符（0/O/1/I/L）
const inviteCodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func genInviteCode(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	for i := range b {
		b[i] = inviteCodeChars[int(b[i])%len(inviteCodeChars)]
	}
	return string(b)
}

// GetOrCreateInviteCode 返回用户的邀请码，没有则懒生成（兼容存量用户 NULL）。
func (s *MySQLStore) GetOrCreateInviteCode(userID int64) (string, error) {
	var code sql.NullString
	if err := s.db.QueryRow("SELECT invite_code FROM users WHERE id=?", userID).Scan(&code); err != nil {
		return "", err
	}
	if code.Valid && code.String != "" {
		return code.String, nil
	}
	// 生成唯一码，撞库重试
	for i := 0; i < 6; i++ {
		c := genInviteCode(8)
		res, err := s.db.Exec("UPDATE users SET invite_code=? WHERE id=? AND (invite_code IS NULL OR invite_code='')", c, userID)
		if err != nil {
			// 唯一冲突则换一个重试
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			return c, nil
		}
		// 未更新（可能并发已生成），回读
		if err := s.db.QueryRow("SELECT invite_code FROM users WHERE id=?", userID).Scan(&code); err == nil && code.Valid && code.String != "" {
			return code.String, nil
		}
	}
	return "", sql.ErrNoRows
}

// GetUserIDByInviteCode 按邀请码查邀请人 ID；无效返回 0。
func (s *MySQLStore) GetUserIDByInviteCode(code string) int64 {
	var id int64
	s.db.QueryRow("SELECT id FROM users WHERE invite_code=?", code).Scan(&id)
	return id
}

// BindInviteAndReward 绑定邀请关系并发放注册奖励（事务、幂等）。
// 仅当被邀请人尚未被绑定（invited_by=0 且 invite_logs 无记录）时生效。
// 返回 ok=true 表示首次绑定并发奖励。
func (s *MySQLStore) BindInviteAndReward(inviterID, inviteeID int64, rewardInviter, rewardInvitee int) (ok bool, err error) {
	if inviterID <= 0 || inviteeID <= 0 || inviterID == inviteeID {
		return false, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	// 锁定被邀请人行，确保 invited_by 只能设置一次
	var invitedBy int64
	if err = tx.QueryRow("SELECT invited_by FROM users WHERE id=? FOR UPDATE", inviteeID).Scan(&invitedBy); err != nil {
		return false, err
	}
	if invitedBy != 0 {
		return false, nil // 已被绑定过
	}

	if _, err = tx.Exec("UPDATE users SET invited_by=? WHERE id=?", inviterID, inviteeID); err != nil {
		return false, err
	}
	// 唯一约束 uniq_invitee 兜底防并发重复
	if _, err = tx.Exec("INSERT INTO invite_logs (inviter_id, invitee_id, reward_register) VALUES (?,?,?)", inviterID, inviteeID, rewardInviter); err != nil {
		return false, nil // 撞唯一约束=已绑定，幂等返回
	}
	if rewardInviter > 0 {
		if _, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", rewardInviter, inviterID); err != nil {
			return false, err
		}
	}
	if rewardInvitee > 0 {
		if _, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", rewardInvitee, inviteeID); err != nil {
			return false, err
		}
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// RewardInviteRecharge 被邀请人首充时给邀请人+被邀请人发首充奖励（事务、幂等）。
// 仅当该被邀请人存在邀请记录且首充奖励未发放时生效。
func (s *MySQLStore) RewardInviteRecharge(inviteeID int64, rewardInviter, rewardInvitee int) (ok bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var inviterID int64
	var rewarded bool
	err = tx.QueryRow("SELECT inviter_id, rewarded_recharge FROM invite_logs WHERE invitee_id=? FOR UPDATE", inviteeID).Scan(&inviterID, &rewarded)
	if err == sql.ErrNoRows {
		return false, nil // 非被邀请用户
	}
	if err != nil {
		return false, err
	}
	if rewarded {
		return false, nil // 首充奖励已发
	}

	if _, err = tx.Exec("UPDATE invite_logs SET rewarded_recharge=1, reward_recharge=? WHERE invitee_id=?", rewardInviter, inviteeID); err != nil {
		return false, err
	}
	if rewardInviter > 0 && inviterID > 0 {
		if _, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", rewardInviter, inviterID); err != nil {
			return false, err
		}
	}
	if rewardInvitee > 0 {
		if _, err = tx.Exec("UPDATE users SET points = points + ? WHERE id=?", rewardInvitee, inviteeID); err != nil {
			return false, err
		}
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// InviteStats 邀请战绩：邀请人数 + 累计奖励积分。
func (s *MySQLStore) InviteStats(userID int64) (count int, totalReward int, err error) {
	err = s.db.QueryRow("SELECT COUNT(*), COALESCE(SUM(reward_register + reward_recharge),0) FROM invite_logs WHERE inviter_id=?", userID).
		Scan(&count, &totalReward)
	return
}

// ListInvitees 邀请的用户列表（脱敏邮箱 + 是否已首充）。
func (s *MySQLStore) ListInvitees(userID int64, limit int) ([]model.InviteeItem, error) {
	rows, err := s.db.Query(`SELECT COALESCE(u.email,''), il.reward_register, il.reward_recharge, il.rewarded_recharge, il.created_at
		FROM invite_logs il LEFT JOIN users u ON il.invitee_id=u.id
		WHERE il.inviter_id=? ORDER BY il.id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []model.InviteeItem
	for rows.Next() {
		var it model.InviteeItem
		var email string
		if err := rows.Scan(&email, &it.RewardRegister, &it.RewardRecharge, &it.Recharged, &it.CreatedAt); err != nil {
			continue
		}
		it.MaskedEmail = maskEmail(email)
		list = append(list, it)
	}
	return list, nil
}

// maskEmail 脱敏邮箱：ab***@domain
func maskEmail(email string) string {
	at := -1
	for i := 0; i < len(email); i++ {
		if email[i] == '@' {
			at = i
			break
		}
	}
	if at <= 0 {
		return "***"
	}
	local := email[:at]
	domain := email[at:]
	if len(local) <= 2 {
		return local[:1] + "***" + domain
	}
	return local[:2] + "***" + domain
}
