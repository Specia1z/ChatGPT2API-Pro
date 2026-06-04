package service

import (
	"testing"
	"time"
)

// 模拟修复前逻辑（Go time.Now）
func checkinStreakOld(lastDate string) int {
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if lastDate != today && lastDate != yesterday {
		return 0
	}
	return 1
}

// 模拟修复后逻辑（MySQL CURDATE，固定基准）
func checkinStreakNew(lastDate, curdate string) int {
	// 解析 curdate
	cd, _ := time.Parse("2006-01-02", curdate)
	today := cd.Format("2006-01-02")
	yesterday := cd.AddDate(0, 0, -1).Format("2006-01-02")
	if lastDate != today && lastDate != yesterday {
		return 0
	}
	return 1
}

func TestCheckinStreakOld(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	twoDaysAgo := time.Now().AddDate(0, 0, -2).Format("2006-01-02")

	tests := []struct {
		name     string
		lastDate string
		want     bool // true=连续
	}{
		{"今天签到过", today, true},
		{"昨天签到过（连续）", yesterday, true},
		{"前天签到（断签）", twoDaysAgo, false},
		{"一周前（断签）", "2026-01-01", false},
		{"从未签到", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkinStreakOld(tt.lastDate) > 0
			if got != tt.want {
				t.Errorf("old: lastDate=%q → got=%v, want=%v", tt.lastDate, got, tt.want)
			}
		})
	}
}

func TestCheckinStreakNew(t *testing.T) {
	// 固定基准日期 2026-06-15（周一）
	base := "2026-06-15"

	tests := []struct {
		name     string
		lastDate string
		curdate  string
		want     bool // true=连续
	}{
		{"同日不重复", base, base, true},
		{"昨天签到（连续）", "2026-06-14", base, true},
		{"前天签到（断签）", "2026-06-13", base, false},
		{"一周前（断签）", "2026-06-08", base, false},
		{"从未签到", "", base, false},

		// 跨月场景
		{"月底最后一天签到", "2026-06-30", "2026-07-01", true},
		{"月末昨天变成上月", "2026-05-31", "2026-06-01", true},
		{"跨年连续", "2025-12-31", "2026-01-01", true},
		{"跨年断签", "2025-12-30", "2026-01-01", false},

		// 修复后：CURDATE 统一用 MySQL 时间，日期一致，不应该断签
		{"新逻辑：昨天签到今天应连续", "2026-06-15", "2026-06-16", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkinStreakNew(tt.lastDate, tt.curdate) > 0
			if got != tt.want {
				t.Errorf("new: lastDate=%q curdate=%q → got=%v, want=%v", tt.lastDate, tt.curdate, got, tt.want)
			}
		})
	}
}
