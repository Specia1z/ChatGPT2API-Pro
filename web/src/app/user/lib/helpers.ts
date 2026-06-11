// 用户中心纯函数 helpers + 动画 variants。
import type { Variants } from "framer-motion";

/* 动画配置 */
export const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
export const fadeUp: Variants = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } } };
export const scaleIn: Variants = { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } };

/* 倒计时格式化 H:MM:SS / MM:SS */
export function formatHMS(s: number): string {
  if (s <= 0) return "00:00";
  const t = Math.ceil(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* 优惠券描述 */
export function couponDesc(c: any): string {
  if (c.discount_type === "percent") return `${c.discount_value} 折优惠`;
  if (c.discount_type === "fixed") return `立减 ¥${c.discount_value}`;
  return c.code;
}

/* 积分流水类型 → 中文标签 */
const POINTS_TYPE_LABELS: Record<string, string> = {
  checkin: "每日签到",
  invite: "邀请奖励",
  redeem_code: "兑换码",
  admin: "管理员调整",
  exchange_token: "兑换令牌",
  shop: "积分商城",
};
export function pointsTypeLabel(t: string): string {
  return POINTS_TYPE_LABELS[t] || t || "积分变动";
}

// 后端返回的是已带正确墙钟数字的字符串。直接取数字部分展示，
// 不能过 new Date()——那会按浏览器时区再偏移一次（与站内其它时间不一致）。
export function formatLogTime(s: string): string {
  if (!s) return "";
  return s.replace("T", " ").slice(0, 16);
}
