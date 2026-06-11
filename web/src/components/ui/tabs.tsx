"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // 焦点胶囊容器：玻璃拟态药丸，relative 供 Indicator 绝对定位
        "relative inline-flex w-fit items-center gap-1 rounded-full border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.04] p-1 backdrop-blur-xl",
        className
      )}
      {...props}
    />
  )
}

// TabsIndicator 焦点胶囊：跟随激活 Tab 平滑滑动的背景。
// base-ui 暴露 --active-tab-left/top/width/height CSS 变量，据此定位 + transition 实现滑动。
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      renderBeforeHydration
      className={cn(
        "absolute left-0 top-0 z-0 rounded-full bg-zinc-900 dark:bg-white shadow-sm",
        "translate-x-[var(--active-tab-left)] translate-y-[var(--active-tab-top)]",
        "w-[var(--active-tab-width)] h-[var(--active-tab-height)]",
        "transition-[translate,width,height] duration-300 ease-out motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        // z-10 浮于胶囊之上；激活态文字反白，未激活灰、hover 微亮
        "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 outline-none select-none cursor-pointer",
        "text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white/90",
        "focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:focus-visible:ring-white/30",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[active]:text-white dark:data-[active]:text-zinc-900",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn(
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel }
