package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"chatgpt2api-pro/internal/model"
)

// 合法公告类型，非法值回退为 info
var validAnnouncementTypes = map[string]bool{"info": true, "warning": true, "success": true, "activity": true}

func normalizeAnnouncementType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if validAnnouncementTypes[t] {
		return t
	}
	return "info"
}

// 合法展示模式，非法值回退为 banner
var validDisplayModes = map[string]bool{"banner": true, "popup": true}

func normalizeDisplayMode(m string) string {
	m = strings.ToLower(strings.TrimSpace(m))
	if validDisplayModes[m] {
		return m
	}
	return "banner"
}

// GET /api/announcements — 公开：当前生效的公告（顶部 Banner 用）
func (h *Handler) ListActiveAnnouncements(w http.ResponseWriter, r *http.Request) {
	list, err := h.MySQL.ListActiveAnnouncements()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	if list == nil {
		list = []model.Announcement{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: list})
}

// GET /api/admin/announcements — 管理：全部公告
func (h *Handler) AdminListAnnouncements(w http.ResponseWriter, r *http.Request) {
	list, err := h.MySQL.ListAnnouncements()
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	if list == nil {
		list = []model.Announcement{}
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: list})
}

// POST /api/admin/announcements — 新建
func (h *Handler) CreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var a model.Announcement
	if err := json.Unmarshal(body, &a); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if strings.TrimSpace(a.Title) == "" && strings.TrimSpace(a.Content) == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "标题与内容不能都为空"})
		return
	}
	a.Type = normalizeAnnouncementType(a.Type)
	a.DisplayMode = normalizeDisplayMode(a.DisplayMode)
	id, err := h.MySQL.CreateAnnouncement(&a)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	a.ID = id
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: a})
}

// PUT /api/admin/announcements — 更新
func (h *Handler) UpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var a model.Announcement
	if err := json.Unmarshal(body, &a); err != nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}
	if a.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "缺少 id"})
		return
	}
	a.Type = normalizeAnnouncementType(a.Type)
	if err := h.MySQL.UpdateAnnouncement(&a); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: a})
}

// DELETE /api/admin/announcements — 删除
func (h *Handler) DeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(body, &req)
	if req.ID <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "缺少 id"})
		return
	}
	if err := h.MySQL.DeleteAnnouncement(req.ID); err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: err.Error()})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "已删除"})
}
