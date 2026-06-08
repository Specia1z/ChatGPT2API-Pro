package store

import (
	"database/sql"
	"time"
)

// FulfillOrderTx 在单个事务内原子完成支付开通的三步：
//  1. 标记订单已付（仅 pending→paid，幂等）
//  2. 按套餐续期/设置用户订阅（未过期累加，过期从现在起；days<=0 永久）
//  3. 核销订单关联的优惠券（带条件校验，FOR UPDATE 防并发重复核销）
// 三步要么全成功要么全回滚，杜绝"已付未开通"或"优惠券漏核销/重复核销"的不一致。
//
// 返回 fulfilled=true 表示本次真正完成开通（订单此前为 pending 且成功提交）。
// planID<=0 或 plan 不存在时只标记已付、不开通（由调用方决定是否记日志）。
func (s *MySQLStore) FulfillOrderTx(orderNo, tradeNo string, userID int64, planID, days int, couponCode string, amount float64) (fulfilled bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	// 1. 标记订单已付（条件 status='pending'，并发只成功一次）
	res, err := tx.Exec("UPDATE orders SET status='paid', alipay_trade_no=? WHERE order_no=? AND status='pending'", tradeNo, orderNo)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// 已被处理过或非 pending：非错误，直接返回未开通
		return false, nil
	}

	// 2. 开通/续期套餐（planID>0 才开通）
	if planID > 0 {
		if days > 0 {
			_, err = tx.Exec(`UPDATE users SET plan_id=?, subscription_expires_at=DATE_ADD(CASE WHEN subscription_expires_at IS NULL OR subscription_expires_at < NOW() THEN NOW() ELSE subscription_expires_at END, INTERVAL ? DAY) WHERE id=?`, planID, days, userID)
		} else {
			_, err = tx.Exec("UPDATE users SET plan_id=?, subscription_expires_at=NULL WHERE id=?", planID, userID)
		}
		if err != nil {
			return false, err
		}

		// 3. 核销优惠券（条件校验 + FOR UPDATE）。校验不过则跳过核销，不影响开通。
		if couponCode != "" {
			var id int64
			var minAmt float64
			var maxUses, useCount int
			var status bool
			var expiresAt sql.NullString
			qerr := tx.QueryRow("SELECT id, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=? FOR UPDATE", couponCode).
				Scan(&id, &minAmt, &maxUses, &useCount, &status, &expiresAt)
			if qerr == nil {
				valid := status && (maxUses <= 0 || useCount < maxUses) && amount >= minAmt
				if valid && expiresAt.Valid && expiresAt.String != "" {
					if exp, perr := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.Local); perr == nil && time.Now().After(exp) {
						valid = false
					}
				}
				if valid {
					if _, uerr := tx.Exec("UPDATE coupon_codes SET use_count=use_count+1 WHERE id=?", id); uerr != nil {
						return false, uerr
					}
				}
			} else if qerr != sql.ErrNoRows {
				return false, qerr
			}
		}
	}

	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
