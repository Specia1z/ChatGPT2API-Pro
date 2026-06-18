// 创作页纯函数 helpers：参考图 src 推断、尺寸标签、分享状态、图标解析。
import * as LucideIcons from "lucide-react";
import { Palette } from "lucide-react";

/* 图标名称 → 组件映射（风格预设的 icon 字段是字符串名） */
export const resolveIcon = (name: string) => (LucideIcons as any)[name] || Palette;

/* 风格预设：以后台 /api/settings 的 style_presets 为唯一真相源 */
export type StylePreset = { id: string; label: string; icon: any; desc: string; hint: string };

/* ── 参考图 src ────────────────────── */
// 从裸 base64 的 magic 前缀推断 MIME（FileReader 读出的 dataURL 已被剥掉前缀只剩 base64）
const b64Mime = (b64: string): string => {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
};
export const refImageSrc = (img: string): string => {
  if (img.startsWith("data:")) return img;
  if (img.startsWith("http://") || img.startsWith("https://")) return img;
  // 仅服务端代理路径才当 URL；注意 JPEG 的 base64 以 "/9j/" 开头，不能用 startsWith("/") 判断
  if (img.startsWith("/api/")) return img;
  return `data:${b64Mime(img)};base64,${img}`;
};

// size 展示：Auto 出图存为复合值 "auto:宽x高"。角标只显「Auto」，详情可显「Auto · 宽×高」。
// 历史遗留的「分辨率档」(HD/2K/4K/A4 等) 实际是固定比例，统一映射回比例展示，避免误导。
const LEGACY_SIZE_RATIO: Record<string, string> = {
  "HD": "16:9", "2K": "1:1", "4K": "1:1", "8K": "1:1", "A4": "3:4",
};
export const sizeLabel = (size: string, withDim = false): string => {
  if (size.startsWith("auto:")) {
    const dim = size.slice(5).replace(/[xX*]/, "×");
    return withDim && dim ? `Auto · ${dim}` : "Auto";
  }
  return LEGACY_SIZE_RATIO[size] || size;
};
// hover 提示：复合值返回精确像素（宽×高），其余返回空串（无需 title）。
export const sizeTitle = (size: string): string => {
  if (size.startsWith("auto:")) return size.slice(5).replace(/[xX*]/, "×");
  return "";
};
// 解析 Auto 复合值 "auto:宽x高" 的像素；非 Auto 或解析失败返回 null。
export const autoDim = (size: string): { w: number; h: number } | null => {
  if (!size.startsWith("auto:")) return null;
  const m = size.slice(5).match(/^(\d+)[xX*](\d+)$/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
};

// 分享审核状态 → UI 语义（先审后发）。兼容无 share_status 的老数据（用 shared 推断）。
export type ShareUI = { key: "none" | "pending" | "approved" | "rejected"; label: string; active: boolean };
export const shareState = (g: any): ShareUI => {
  const ss = g.share_status || (g.shared ? "approved" : "none");
  switch (ss) {
    case "pending":  return { key: "pending",  label: "审核中",   active: true };
    case "approved": return { key: "approved", label: "已展示",   active: true };
    case "rejected": return { key: "rejected", label: "未通过",   active: false };
    default:          return { key: "none",     label: "分享到广场", active: false };
  }
};

// hasImageData：记录是否带可渲染的图片数据。与 GalleryGrid 卡片「分支A」渲染条件保持一致——
// 二者必须同源，否则计数与实际渲染会漂移。
export const hasImageData = (g: any): boolean =>
  !!(g.image_url || (g.image_b64 && g.image_b64.length > 100));

// isAbnormalGen：判定一条记录是否「异常」，纳入「清除异常」批量入口。三类：
//  1) status=failed —— 生成失败
//  2) status=completed 但无图片数据 —— 对象被清/落地失败，服务端以为成功但实际无图
//  3) brokenIds 命中 —— 有 URL 但浏览器 <img> 加载失败（裂图/URL 失效）
// pending（生成中）永不算异常。
export const isAbnormalGen = (g: any, brokenIds: Set<number>): boolean => {
  if (g.status === "pending") return false;
  if (g.status === "failed") return true;
  if (g.status === "completed" && !hasImageData(g)) return true;
  return brokenIds.has(g.id);
};
