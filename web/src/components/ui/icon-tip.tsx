"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * IconTip — 给图标按钮等元素加美观的 tooltip（替代原生 title 属性）。
 * 用法：<IconTip label="编辑"><Button size="icon-sm" onClick=...><Pencil/></Button></IconTip>
 * children 作为 TooltipTrigger 的渲染目标（base-ui 用 render 透传，不额外包 DOM）。
 */
export function IconTip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
