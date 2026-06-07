package store

import (
	"database/sql"
	"strings"
	"time"

	"chatgpt2api-pro/internal/model"
)

// --- Orders ---

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}

func (s *MySQLStore) CreateOrder(userID int64, plan *model.Plan, orderNo, billing string) (*model.Order, error) {
	duration := plan.DurationDays
	amount := plan.PriceMonthly
	if duration > 0 {
		amount = round2(plan.PriceMonthly * float64(duration) / 30)
	}
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			duration = plan.DurationDaysYearly
			amount = round2(plan.PriceYearly * 12 * float64(duration) / 365)
		} else {
			duration = 0
			amount = round2(plan.PriceYearly * 12)
		}
	}
	res, err := s.db.Exec(`INSERT INTO orders (order_no, user_id, plan_id, plan_name, duration_days, amount, status) VALUES (?,?,?,?,?,?,'pending')`,
		orderNo, userID, plan.ID, plan.Name, duration, amount)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &model.Order{
		ID: id, OrderNo: orderNo, UserID: userID, PlanID: plan.ID,
		PlanName: plan.Name, DurationDays: duration, Amount: amount,
		Status: "pending",
	}, nil
}

func (s *MySQLStore) GetOrderByOrderNo(orderNo string) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE order_no=?`, orderNo).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *MySQLStore) GetOrderByID(id int64) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE id=?`, id).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *MySQLStore) GetUserOrders(userID int64, page, pageSize int) ([]model.Order, int, error) {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE user_id=?", userID).Scan(&total)
	rows, err := s.db.Query("SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?", userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var orders []model.Order
	for rows.Next() {
		var o model.Order
		if err := rows.Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

func (s *MySQLStore) GetLastPaidOrder(userID int64) (*model.Order, error) {
	var o model.Order
	err := s.db.QueryRow(`SELECT id, order_no, user_id, plan_id, COALESCE(plan_name,''), COALESCE(duration_days,0), amount, status, COALESCE(alipay_trade_no,''), COALESCE(coupon_code,''), created_at, updated_at FROM orders WHERE user_id=? AND status='paid' ORDER BY id DESC LIMIT 1`, userID).
		Scan(&o.ID, &o.OrderNo, &o.UserID, &o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status, &o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *MySQLStore) CreateUpgradeOrder(userID int64, plan *model.Plan, orderNo, billing string, price float64) (*model.Order, error) {
	duration := plan.DurationDays
	if billing == "yearly" {
		if plan.DurationDaysYearly > 0 {
			duration = plan.DurationDaysYearly
		} else {
			duration = 0
		}
	}
	res, err := s.db.Exec(`INSERT INTO orders (order_no, user_id, plan_id, plan_name, duration_days, amount, status) VALUES (?,?,?,?,?,?,'pending')`,
		orderNo, userID, plan.ID, plan.Name, duration, price)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &model.Order{
		ID: id, OrderNo: orderNo, UserID: userID, PlanID: plan.ID,
		PlanName: plan.Name, DurationDays: duration, Amount: price,
		Status: "pending",
	}, nil
}

func (s *MySQLStore) UpdateOrderAmount(orderNo string, amount float64, couponCode string) error {
	_, err := s.db.Exec("UPDATE orders SET amount=?, coupon_code=? WHERE order_no=?", amount, couponCode, orderNo)
	return err
}

func (s *MySQLStore) MarkOrderPaid(orderNo, alipayTradeNo string) (bool, error) {
	res, err := s.db.Exec("UPDATE orders SET status='paid', alipay_trade_no=? WHERE order_no=? AND status='pending'", alipayTradeNo, orderNo)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ExpireStaleOrders 把创建超过 timeoutMinutes 分钟仍待支付的订单置为 expired。
// 仅影响 pending 订单，不动 paid；返回受影响行数。timeoutMinutes<=0 时不处理。
func (s *MySQLStore) ExpireStaleOrders(timeoutMinutes int) (int64, error) {
	if timeoutMinutes <= 0 {
		return 0, nil
	}
	res, err := s.db.Exec(
		"UPDATE orders SET status='expired' WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)",
		timeoutMinutes)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *MySQLStore) GetAllOrders(page, pageSize int, status, search string) ([]model.Order, int, error) {
	var total int
	var conds []string
	args := []any{}
	if status != "" {
		conds = append(conds, "o.status=?")
		args = append(args, status)
	}
	if search != "" {
		// 按订单号 / 用户邮箱 / 用户昵称 / 支付交易号模糊匹配
		conds = append(conds, "(o.order_no LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR o.alipay_trade_no LIKE ?)")
		kw := "%" + search + "%"
		args = append(args, kw, kw, kw, kw)
	}
	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	// 搜索关联 users，故 COUNT 也需 JOIN
	s.db.QueryRow("SELECT COUNT(*) FROM orders o LEFT JOIN users u ON o.user_id=u.id"+where, args...).Scan(&total)
	query := `SELECT o.id, o.order_no, o.user_id, COALESCE(u.email,''), COALESCE(u.name,''),
		o.plan_id, COALESCE(o.plan_name,''), COALESCE(o.duration_days,0), o.amount, o.status,
		COALESCE(o.alipay_trade_no,''), COALESCE(o.coupon_code,''), o.created_at, o.updated_at
		FROM orders o LEFT JOIN users u ON o.user_id=u.id` + where +
		` ORDER BY o.id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var orders []model.Order
	for rows.Next() {
		var o model.Order
		if err := rows.Scan(&o.ID, &o.OrderNo, &o.UserID, &o.UserEmail, &o.UserName,
			&o.PlanID, &o.PlanName, &o.DurationDays, &o.Amount, &o.Status,
			&o.AlipayTradeNo, &o.CouponCode, &o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

// --- Coupons ---

func (s *MySQLStore) CreateCoupon(c *model.CouponCode) (int64, error) {
	_, err := s.db.Exec("INSERT INTO coupon_codes (code, discount_type, discount_value, min_amount, max_uses, created_by) VALUES (?,?,?,?,?,?)",
		c.Code, c.DiscountType, c.DiscountValue, c.MinAmount, c.MaxUses, c.CreatedBy)
	if err != nil {
		return 0, err
	}
	return 0, nil
}

func (s *MySQLStore) ListCoupons() ([]model.CouponCode, error) {
	rows, err := s.db.Query("SELECT id, code, discount_type, discount_value, min_amount, max_uses, use_count, status, COALESCE(expires_at,''), created_by, created_at, updated_at FROM coupon_codes ORDER BY id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []model.CouponCode
	for rows.Next() {
		var c model.CouponCode
		if err := rows.Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.MinAmount, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *MySQLStore) DisableCoupon(id int64) error {
	_, err := s.db.Exec("UPDATE coupon_codes SET status=0 WHERE id=?", id)
	return err
}

func (s *MySQLStore) ValidateCoupon(code string, amount float64) (*model.CouponCode, error) {
	var c model.CouponCode
	err := s.db.QueryRow("SELECT id, code, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=?", code).
		Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.MinAmount, &c.MaxUses, &c.UseCount, &c.Status, &c.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !c.Status {
		return nil, nil
	}
	if c.MaxUses > 0 && c.UseCount >= c.MaxUses {
		return nil, nil
	}
	if c.ExpiresAt != nil && *c.ExpiresAt != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", *c.ExpiresAt, time.Local)
		if time.Now().After(exp) {
			return nil, nil
		}
	}
	if amount < c.MinAmount {
		return nil, nil
	}
	return &c, nil
}

func (s *MySQLStore) AtomicUseCoupon(code string, amount float64) (discountType string, discountValue float64, ok bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", 0, false, err
	}
	defer tx.Rollback()

	var id int64
	var dtype string
	var dval, minAmt float64
	var maxUses, useCount int
	var status bool
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT id, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=? FOR UPDATE", code).
		Scan(&id, &dtype, &dval, &minAmt, &maxUses, &useCount, &status, &expiresAt)
	if err == sql.ErrNoRows {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}

	if !status {
		return "", 0, false, nil
	}
	if maxUses > 0 && useCount >= maxUses {
		return "", 0, false, nil
	}
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.Local)
		if time.Now().After(exp) {
			return "", 0, false, nil
		}
	}
	if amount < minAmt {
		return "", 0, false, nil
	}

	_, err = tx.Exec("UPDATE coupon_codes SET use_count=use_count+1 WHERE id=?", id)
	if err != nil {
		return "", 0, false, err
	}

	if err := tx.Commit(); err != nil {
		return "", 0, false, err
	}
	return dtype, dval, true, nil
}

// --- User Coupons ---

func (s *MySQLStore) ClaimCoupon(userID int64, code string) (*model.UserCoupon, error) {
	// 原子地校验优惠码并绑定到用户
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	var dtype string
	var dval, minAmt float64
	var maxUses, useCount int
	var status bool
	var expiresAt sql.NullString
	err = tx.QueryRow("SELECT id, discount_type, discount_value, min_amount, max_uses, use_count, status, expires_at FROM coupon_codes WHERE code=? FOR UPDATE", code).
		Scan(&id, &dtype, &dval, &minAmt, &maxUses, &useCount, &status, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !status {
		return nil, nil
	}
	if maxUses > 0 && useCount >= maxUses {
		return nil, nil
	}
	if expiresAt.Valid && expiresAt.String != "" {
		exp, _ := time.ParseInLocation("2006-01-02 15:04:05", expiresAt.String, time.Local)
		if time.Now().After(exp) {
			return nil, nil
		}
	}

	// 检查用户是否已领过
	var existing int
	tx.QueryRow("SELECT COUNT(*) FROM user_coupons WHERE user_id=? AND coupon_id=? AND status='active'", userID, id).Scan(&existing)
	if existing > 0 {
		return nil, nil
	}

	// 创建用户优惠券记录
	res, err := tx.Exec("INSERT INTO user_coupons (user_id, coupon_id, code, discount_type, discount_value) VALUES (?,?,?,?,?)", userID, id, code, dtype, dval)
	if err != nil {
		return nil, err
	}
	cpID, _ := res.LastInsertId()

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &model.UserCoupon{ID: cpID, UserID: userID, CouponID: id, Code: code, DiscountType: dtype, DiscountValue: dval, Status: "active"}, nil
}

func (s *MySQLStore) ListUserCoupons(userID int64) ([]model.UserCoupon, error) {
	rows, err := s.db.Query("SELECT id, user_id, coupon_id, code, discount_type, discount_value, status, claimed_at, COALESCE(used_at,'') FROM user_coupons WHERE user_id=? ORDER BY FIELD(status,'active','used','expired'), claimed_at DESC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []model.UserCoupon
	for rows.Next() {
		var c model.UserCoupon
		if err := rows.Scan(&c.ID, &c.UserID, &c.CouponID, &c.Code, &c.DiscountType, &c.DiscountValue, &c.Status, &c.ClaimedAt, &c.UsedAt); err != nil {
			continue
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *MySQLStore) UseUserCoupon(couponID, userID int64) error {
	_, err := s.db.Exec("UPDATE user_coupons SET status='used', used_at=NOW() WHERE id=? AND user_id=? AND status='active'", couponID, userID)
	return err
}
