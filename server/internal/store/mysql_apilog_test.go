package store

import (
	"testing"

	"chatgpt2api-pro/internal/apilog"
)

// 连不上 MySQL 则 Skip（沿用 admin_login_test 模式）
func apilogTestStore(t *testing.T) *MySQLStore {
	s, err := NewMySQLStore("root:@tcp(127.0.0.1:3306)/chatgpt2api_pro?parseTime=true")
	if err != nil {
		t.Skipf("MySQL not available: %v", err)
	}
	return s
}

func TestAPICallLogsAggregation(t *testing.T) {
	s := apilogTestStore(t)
	defer s.Close()

	const uid = 999999001 // 测试专用 user_id，避免污染真实数据
	s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)
	defer s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)

	// 喂种子：2 成功 (images.generations 扣10、vector 扣5)、1 失败 4xx、1×429
	seed := []apilog.Record{
		{UserID: uid, Endpoint: "images.generations", StatusCode: 200, TokensCost: 10, Count: 1},
		{UserID: uid, Endpoint: "vector", StatusCode: 200, TokensCost: 5, Count: 1},
		{UserID: uid, Endpoint: "images.generations", StatusCode: 400, TokensCost: 0},
		{UserID: uid, Endpoint: "images.generations", StatusCode: 429, TokensCost: 0},
	}
	if err := s.BatchInsertAPICallLogs(seed); err != nil {
		t.Fatalf("insert: %v", err)
	}

	sum, err := s.GetAPIUsageSummary(uid, 7)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if sum.TotalCalls != 4 {
		t.Errorf("TotalCalls = %d, want 4", sum.TotalCalls)
	}
	if sum.SuccessCalls != 2 {
		t.Errorf("SuccessCalls = %d, want 2", sum.SuccessCalls)
	}
	if sum.FailedCalls != 2 {
		t.Errorf("FailedCalls = %d, want 2", sum.FailedCalls)
	}
	if sum.RateLimited != 1 {
		t.Errorf("RateLimited = %d, want 1", sum.RateLimited)
	}
	if sum.TotalTokens != 15 {
		t.Errorf("TotalTokens = %d, want 15", sum.TotalTokens)
	}
	if len(sum.Trend) != 7 {
		t.Errorf("Trend len = %d, want 7", len(sum.Trend))
	}

	items, total, err := s.GetAPICallLogs(uid, 1, 20, 0, "", 0)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if total != 4 {
		t.Errorf("logs total = %d, want 4", total)
	}
	if len(items) != 4 {
		t.Errorf("logs items = %d, want 4", len(items))
	}

	// 按端点筛选
	_, totalVec, _ := s.GetAPICallLogs(uid, 1, 20, 0, "vector", 0)
	if totalVec != 1 {
		t.Errorf("vector logs total = %d, want 1", totalVec)
	}
	// 按状态筛选
	_, total429, _ := s.GetAPICallLogs(uid, 1, 20, 0, "", 429)
	if total429 != 1 {
		t.Errorf("429 logs total = %d, want 1", total429)
	}
}

func TestDeleteAPICallLogsBefore(t *testing.T) {
	s := apilogTestStore(t)
	defer s.Close()

	const uid = 999999002
	s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)
	defer s.db.Exec("DELETE FROM api_call_logs WHERE user_id=?", uid)

	// 一条「现在」、一条「40 天前」
	s.db.Exec("INSERT INTO api_call_logs (user_id, endpoint, status_code, created_at) VALUES (?, 'x', 200, NOW())", uid)
	s.db.Exec("INSERT INTO api_call_logs (user_id, endpoint, status_code, created_at) VALUES (?, 'x', 200, NOW() - INTERVAL 40 DAY)", uid)

	n, err := s.DeleteAPICallLogsBefore(30)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n < 1 {
		t.Errorf("deleted = %d, want >= 1 (the 40-day-old row)", n)
	}
	var remain int
	s.db.QueryRow("SELECT COUNT(*) FROM api_call_logs WHERE user_id=?", uid).Scan(&remain)
	if remain != 1 {
		t.Errorf("remaining = %d, want 1 (the fresh row)", remain)
	}
}
