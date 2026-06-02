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
