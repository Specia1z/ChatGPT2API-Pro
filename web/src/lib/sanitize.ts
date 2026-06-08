"use client";

import DOMPurify from "dompurify";

// sanitizeSVG 净化用户/AI 生成的 SVG，防存储型 XSS。
// 只允许 SVG 图形元素，禁掉 script / on* 事件 / foreignObject / a[href=javascript:] 等可执行向量。
// 用于任何 dangerouslySetInnerHTML 渲染 SVG 的地方。
export function sanitizeSVG(svg: string): string {
  if (typeof window === "undefined") return ""; // SSR 阶段不渲染，交给客户端
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // 显式禁掉高危标签/属性（USE_PROFILES 已默认禁 script，这里再加固）
    FORBID_TAGS: ["script", "foreignObject", "iframe", "a", "use"],
    FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover", "href", "xlink:href"],
  });
}
