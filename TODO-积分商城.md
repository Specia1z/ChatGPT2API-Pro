# 待办：积分商城

> 状态：规划中（未开发）
> 目标：给积分增加消耗出口，提升用户攒积分动力，并借"积分换套餐"拉付费转化。

## 背景

当前积分**入口**：每日签到、邀请裂变（注册/首充奖励）。
当前积分**出口**：仅「兑换突发令牌」（`POST /api/user/points/exchange`）。

出口单一 → 攒积分动力弱。积分商城用于扩展出口。

## 分期计划

### 第一期（优先，价值最高）：积分换套餐时长
- 本质：给现有兑换能力加一种「兑换类型 = 套餐天数」，而非令牌。
- 让免费用户靠攒积分尝到付费套餐 → 转化付费。
- 复用：现有套餐表、订阅到期逻辑（`subscription_expires_at` 累加）、`DeductUserPoints` 原子扣减。
- 后台可配：`X 积分 = Y 天 Z 套餐`（建议放 settings 的 JSON 配置，类似 invite_config）。
- 防白嫖关键：定价必须结合签到/邀请的积分发放速率核算，避免免费白嫖会员。

### 第二期（看数据再定）
- 突发令牌包（打包：100/500 令牌包，比单兑有仪式感）。
- 优惠券兑换（积分换满减/折扣券，复用现有 coupon 系统，再导向付费）。
- 抽奖/盲盒（消耗积分抽上述奖品，加速积分消耗，做活动）。
- 功能解锁类（专属风格、提并发、去水印、优先队列）——需新开发。

## ⚠️ 开发前必须先做的事：积分经济平衡

商城只是「货架」，核心是积分**发放 vs 消耗**是否平衡：
- 发太快、商城太便宜 → 积分通胀、白嫖会员、损收入。
- 商城太贵 → 没人买，形同虚设。

**动手开发前**先定价并算账：
1. 统计当前积分发放速率（签到日均 + 邀请均量）。
2. 据此定「积分换 1 天会员」的价格，确保不被薅。
3. 跑一段数据验证平衡后，再扩展第二期花样。

## 技术落点（第一期预估）
- 后端：扩展 `ExchangePoints` 或新增 `POST /api/user/shop/redeem`，支持 type=plan_days；
  settings 加 `shop_config` JSON（商品列表 + 定价）；扣积分走 `DeductUserPoints`（已具备原子防超扣）。
- 迁移：settings 加 `shop_config` 列（建表 ALTER + struct + GetSettings SELECT + SaveSettings UPDATE 四处，参考 invite_config）。
- 前端：用户中心「优惠与兑换」Tab 内扩展，或新增「积分商城」Tab；admin 系统设置加「积分商城」配置区。

## 相关已有实现（复用参考）
- 积分原子扣减：`DeductUserPoints`（commit fa4f353，防 TOCTOU 超扣）。
- 兑换突发令牌：`server/internal/api/points_exchange.go`。
- 配置化模式：`invite_config` / `email_config`（settings JSON 列）。
- 订阅天数累加：见 `AlipayNotify` 里 `DATE_ADD(... INTERVAL ? DAY)`。
