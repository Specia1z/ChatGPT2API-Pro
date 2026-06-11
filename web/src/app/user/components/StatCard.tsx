"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

/* ── 指标卡（玻璃拟态 + 无衬线中性） ── */
export function StatCard({ icon, label, value, unit }: {
  icon: React.ReactNode; label: string; value: string; unit: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl p-5 space-y-3 hover:bg-white/80 dark:hover:bg-white/[0.06] transition-colors">
      <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center text-zinc-500 dark:text-white/55">
        {icon}
      </div>
      <div>
        <p className="text-xs text-zinc-500 dark:text-white/50">{label}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight mt-0.5 text-zinc-900 dark:text-white">
          {value}<span className="text-sm text-zinc-400 dark:text-white/40 ml-1 font-normal">{unit}</span>
        </p>
      </div>
    </div>
  );
}

/* ── 连续签到条（中性黑白） ── */
export function StreakBar({ streak, done }: { streak: number; done: boolean }) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  return (
    <div className="flex items-center gap-2">
      {days.map((d, i) => {
        const isToday = i === todayIdx;
        const filled = i < todayIdx
          ? done && i >= todayIdx - (done ? streak - 1 : streak)
          : isToday && done;
        return (
          <motion.div key={i}
            initial={filled ? { scale: 0.8 } : false}
            animate={filled ? { scale: 1 } : {}}
            transition={{ type: "spring", stiffness: 400, damping: 15, delay: i * 0.05 }}
            className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              filled ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm"
              : isToday ? "bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-900 dark:text-white ring-1 ring-zinc-900/15 dark:ring-white/20"
              : "bg-zinc-900/[0.03] dark:bg-white/[0.04] text-zinc-400 dark:text-white/40"
            }`}>
            {filled ? <Check className="size-4" /> : <span className="size-4 flex items-center justify-center">{isToday && !done ? "●" : "○"}</span>}
            <span className="text-[10px]">{d}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
