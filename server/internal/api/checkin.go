package api

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

var (
	checkinMu   sync.Mutex
	checkinMaps = make(map[int64]*sync.Mutex)
)

func init() {
	// 每 10 分钟清理无用的用户级互斥锁
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			checkinMu.Lock()
			// 尝试 Lock 每个锁，成功的就可以删（说明没人在用）
			for uid, mu := range checkinMaps {
				if mu.TryLock() {
					mu.Unlock()
					delete(checkinMaps, uid)
				}
			}
			checkinMu.Unlock()
		}
	}()
}

func getCheckinMu(uid int64) *sync.Mutex {
	checkinMu.Lock()
	defer checkinMu.Unlock()
	if m, ok := checkinMaps[uid]; ok {
		return m
	}
	m := &sync.Mutex{}
	checkinMaps[uid] = m
	return m
}

// POST /api/user/checkin — 每日签到 (并发安全)
func (h *Handler) Checkin(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}

	// 用户级互斥锁防并发重复
	mu := getCheckinMu(uid)
	mu.Lock()
	defer mu.Unlock()

	settings, _ := h.MySQL.GetSettings()
	if !settings.CheckinEnabled {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "签到功能未开放"})
		return
	}

	// 检查今日是否已签到
	done, _, err := h.MySQL.GetTodayCheckin(uid)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "系统错误"})
		return
	}
	if done {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "今日已签到"})
		return
	}

	// 计算连续签到奖励
	base := settings.CheckinBase
	if base <= 0 {
		base = 10
	}
	bonus := settings.CheckinStreakBonus
	if bonus <= 0 {
		bonus = 5
	}

	lastStreak, _ := h.MySQL.GetLastCheckinStreak(uid)
	streak := 1
	if lastStreak > 0 {
		streak = lastStreak + 1
	}
	pointsEarned := base + streak*bonus

	// 原子写入签到记录 + 积分（单事务）
	if err := h.MySQL.CompleteCheckin(uid, pointsEarned, streak); err != nil {
		log.Printf("[checkin] user=%d CompleteCheckin err: %v", uid, err)
		if me, ok := err.(*mysql.MySQLError); ok && me.Number == 1062 {
			writeJSON(w, 400, model.APIResponse{Code: 400, Message: "今日已签到"})
			return
		}
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "签到失败"})
		return
	}

	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"points_earned": pointsEarned,
		"streak":        streak,
		"base":          base,
		"bonus":         bonus,
	}})
}

// GET /api/user/checkin/status — 查签到状态
func (h *Handler) CheckinStatus(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}

	settings, _ := h.MySQL.GetSettings()
	done, streak, _ := h.MySQL.GetTodayCheckin(uid)
	// 今日未签到时 GetTodayCheckin 返回 streak=0，此时取「截至昨天延续中的连续天数」，
	// 让前端在签到前就能展示历史签到状态（已签则 streak 已含今日）。
	if !done {
		streak, _ = h.MySQL.GetLastCheckinStreak(uid)
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{
		"done":   done,
		"streak": streak,
		"base":   settings.CheckinBase,
		"bonus":  settings.CheckinStreakBonus,
		"enabled": settings.CheckinEnabled,
	}})
}
