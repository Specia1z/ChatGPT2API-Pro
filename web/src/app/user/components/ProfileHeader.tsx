"use client";

import { motion } from "framer-motion";
import { Crown, Coins, ArrowUpRight, LogOut, Battery, Zap, Layers, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { fadeUp } from "../lib/helpers";
import { StatCard } from "./StatCard";

type Props = {
  user: any;
  isPro: boolean;
  refill: number;
  concurrency: number;
  capacity: number;
  displayTokens: number;
  animatedTokens: number;
  pct: number;
  burst: number;
  exchangeRate: number;
  cdNextHMS: string | null;
  onUpgrade: () => void;
  onLogout: () => void;
  onExchange: () => void;
};

// 用户中心头部：欢迎信息 + 令牌仪表盘 + 倒计时（玻璃拟态 + 中性黑白）。
export function ProfileHeader(p: Props) {
  const { user, isPro, refill, concurrency, capacity, displayTokens, animatedTokens, pct, burst, exchangeRate, cdNextHMS, onUpgrade, onLogout, onExchange } = p;
  return (
    <>
      {/* 欢迎头部 */}
      <motion.div variants={fadeUp} className="relative overflow-hidden rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8">
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="relative size-16 sm:size-20 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center ring-1 ring-zinc-900/[0.06] dark:ring-white/10">
              <span className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white">
                {(user.name || user.email)[0].toUpperCase()}
              </span>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
                欢迎回来，{user.name || "用户"}
              </h1>
              <p className="text-sm text-zinc-500 dark:text-white/50">{user.email}</p>
              <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                <Badge variant={isPro ? "default" : "secondary"} className="gap-1">
                  {isPro && <Crown className="size-3" />} {user.plan_name || "免费版"}
                </Badge>
                {user?.subscription_expires_at ? (
                  <Badge variant="secondary" className="text-[11px] gap-1">
                    {(user.created_at || "").slice(0, 10)} ~ {user.subscription_expires_at.slice(0, 10)}
                  </Badge>
                ) : user?.plan_name && user.plan_name !== "免费版" ? (
                  <Badge variant="secondary" className="text-[11px]">永久</Badge>
                ) : null}
                <Badge variant="default" className="text-[11px] gap-1">
                  <Coins className="size-3" /> {user.points || 0} 积分
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <Button onClick={onUpgrade} className="gap-1.5">
              {isPro ? "管理订阅" : "升级套餐"} <ArrowUpRight className="size-3.5" />
            </Button>
            <Button variant="outline" onClick={onLogout} className="gap-1.5" aria-label="退出登录">
              <LogOut className="size-3.5" /> <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* 令牌仪表盘 */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="sm:col-span-2 rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                <Battery className="size-5 text-zinc-700 dark:text-white/70" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">令牌余额</p>
                <p className="text-xs text-zinc-500 dark:text-white/50">每小时恢复 {refill} 个</p>
              </div>
            </div>
            <span className={`text-2xl font-semibold tabular-nums ${pct < 0.15 ? "text-red-500 animate-pulse" : "text-zinc-900 dark:text-white"}`}>
              {animatedTokens.toFixed(2)}
            </span>
          </div>
          <div className="space-y-1.5">
            <Progress value={pct * 100} className="h-2.5 rounded-full" />
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-white/50">
              <span>已用 {(capacity - displayTokens).toFixed(2)}</span>
              <span className="tabular-nums">{displayTokens.toFixed(2)} / {capacity}</span>
            </div>
            {burst > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 h-1.5 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(burst / capacity * 100, 100)}%` }} />
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">突发 +{burst.toFixed(1)}</TooltipTrigger>
                    <TooltipContent side="top">优先消耗突发令牌，用完后再消耗额度</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
            {burst > 0 && <p className="text-[10px] text-zinc-400 dark:text-white/40 -mt-0.5">优先使用突发令牌，额度不受影响</p>}
            {exchangeRate > 0 && (
              <div className="pt-2 flex items-center justify-between border-t border-zinc-900/[0.07] dark:border-white/10 mt-3">
                <span className="text-xs text-zinc-500 dark:text-white/50">
                  <Coins className="size-3 inline -mt-px mr-1" />
                  {user?.points ?? 0} 积分
                </span>
                <button onClick={onExchange}
                  className="text-xs font-medium text-zinc-700 dark:text-white/80 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-1">
                  兑换突发 <Zap className="size-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <StatCard icon={<Zap className="size-4" />} label="恢复速率" value={`${refill}`} unit="/小时" />
        <StatCard icon={<Layers className="size-4" />} label="并发任务" value={`${concurrency}`} unit="并发" />
      </motion.div>

      {/* 下个令牌倒计时 */}
      {cdNextHMS && (
        <motion.div variants={fadeUp} className="flex items-center gap-2 px-1">
          <Timer className="size-3.5 text-zinc-400 dark:text-white/40" />
          <span className="text-xs text-zinc-500 dark:text-white/50">
            下个令牌恢复: <span className="text-zinc-900 dark:text-white font-medium">{cdNextHMS}</span>
          </span>
        </motion.div>
      )}
    </>
  );
}
