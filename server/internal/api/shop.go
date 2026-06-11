package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"chatgpt2api-pro/internal/middleware"
	"chatgpt2api-pro/internal/model"
)

// parseShopItems 解析 settings.shop_config（JSON 数组），返回商品列表。
func parseShopItems(raw string) []model.ShopItem {
	if raw == "" {
		return nil
	}
	var items []model.ShopItem
	if json.Unmarshal([]byte(raw), &items) != nil {
		return nil
	}
	return items
}

// GET /api/user/shop — 用户可见的积分商城（仅上架商品 + 套餐名 + 当前积分）
func (h *Handler) ListShop(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	settings, _ := h.MySQL.GetSettings()
	items := parseShopItems(settings.ShopConfig)
	type shopView struct {
		model.ShopItem
		PlanName string      `json:"plan_name"`
		Plan     *model.Plan `json:"plan,omitempty"` // 关联套餐的完整内容（额度/并发/速率/特性），供前端展示
	}
	var out []shopView
	for _, it := range items {
		if !it.Enabled {
			continue
		}
		name := ""
		var plan *model.Plan
		if it.PlanID > 0 {
			if p, _ := h.MySQL.GetPlanByID(it.PlanID); p != nil {
				name = p.Name
				plan = p
			}
		}
		out = append(out, shopView{ShopItem: it, PlanName: name, Plan: plan})
	}
	if out == nil {
		out = []shopView{}
	}
	var points int
	if u, _ := h.MySQL.GetUserByID(uid); u != nil {
		points = u.Points
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Data: map[string]any{"items": out, "points": points}})
}

// POST /api/user/shop/redeem — 用积分兑换商城商品（套餐时长）
func (h *Handler) RedeemShop(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(middleware.UserIDKey).(int64)
	if !ok {
		writeJSON(w, 401, model.APIResponse{Code: 401, Message: "未登录"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	var req struct {
		ItemID string `json:"item_id"`
	}
	json.Unmarshal(body, &req)
	if req.ItemID == "" {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "参数错误"})
		return
	}

	// 商品必须来自后台配置（不信任前端传的价格/套餐），按 id 查
	settings, _ := h.MySQL.GetSettings()
	var item *model.ShopItem
	for _, it := range parseShopItems(settings.ShopConfig) {
		if it.ID == req.ItemID {
			it := it
			item = &it
			break
		}
	}
	if item == nil || !item.Enabled {
		writeJSON(w, 404, model.APIResponse{Code: 404, Message: "商品不存在或已下架"})
		return
	}
	if item.PlanID <= 0 || item.Points <= 0 {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "商品配置无效"})
		return
	}
	plan, _ := h.MySQL.GetPlanByID(item.PlanID)
	if plan == nil {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: "关联套餐不存在"})
		return
	}

	remaining, paid, err := h.MySQL.RedeemShopPlan(uid, item.PlanID, item.Days, item.Points)
	if err != nil {
		writeJSON(w, 500, model.APIResponse{Code: 500, Message: "兑换失败"})
		return
	}
	if !paid {
		writeJSON(w, 400, model.APIResponse{Code: 400, Message: fmt.Sprintf("积分不足，需要 %d（当前 %d）", item.Points, remaining)})
		return
	}
	writeJSON(w, 200, model.APIResponse{Code: 200, Message: "兑换成功", Data: map[string]any{
		"points_remain": remaining, "plan": plan.Name, "days": item.Days,
	}})
}
