import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 生成图片代理 URL，优先使用代理端点隐藏真实存储地址
 */
export function imageProxyUrl(item: { id?: number; image_url?: string; image_b64?: string }): string {
  if (item.id) {
    return `/api/images/${item.id}`;
  }
  // fallback：没有 id 时使用原始数据（极少数情况）
  if (item.image_url) return item.image_url;
  if (item.image_b64) return `data:image/png;base64,${item.image_b64}`;
  return "";
}

/**
 * 统一时间格式化。
 * ⚠️ 重要：后端 MySQL 容器时区为 Asia/Shanghai，CURRENT_TIMESTAMP 存的是**北京墙钟值**，
 * 但后端 DSN 未设 loc、parseTime 默认按 UTC 解析，导致序列化成带 `Z` 的串
 * （如 `2026-06-10T02:55:21Z`，其中数字其实已是北京时间）。
 * 因此**绝不能过 new Date() 做时区转换**——那会让东八区用户再 +8 小时而显示错误。
 * 正确做法：剥掉 T/Z/秒/毫秒，直接展示字符串里的墙钟数字。
 */
function wallParts(s?: string): { y: string; mo: string; d: string; h: string; mi: string } | null {
  if (!s) return null;
  // 统一分隔符，去掉时区后缀与毫秒
  const t = s.replace("T", " ").replace("Z", "").trim();
  // 匹配 yyyy-MM-dd HH:mm(:ss)
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  return { y: m[1], mo: m[2], d: m[3], h: m[4] || "00", mi: m[5] || "00" };
}

/** 完整时间 `yyyy-MM-dd HH:mm`（墙钟，不转时区）。无效返回空串。 */
export function formatTime(s?: string): string {
  const p = wallParts(s);
  if (!p) return "";
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`;
}

/** 仅日期 `yyyy-MM-dd`。 */
export function formatDay(s?: string): string {
  const p = wallParts(s);
  if (!p) return "";
  return `${p.y}-${p.mo}-${p.d}`;
}

/** 短时间 `MM-dd HH:mm`，用于空间紧凑的角标。 */
export function formatShort(s?: string): string {
  const p = wallParts(s);
  if (!p) return "";
  return `${p.mo}-${p.d} ${p.h}:${p.mi}`;
}

/** 判断某时间是否为「今天」（墙钟日期 vs 浏览器本地日期，与显示一致）。 */
export function isLocalToday(s?: string): boolean {
  const p = wallParts(s);
  if (!p) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${p.y}-${p.mo}-${p.d}` === today;
}
