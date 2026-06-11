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

/* ── 连续签到条 ──
   颜色区分：今日已签=强调绿、往日已签=中性黑白、今日待签=高亮待办、未签/未来=淡色。
   后端在未签到时也会回传截至昨天的连续 streak，故签到前即可展示历史状态。 */
export function StreakBar({ streak, done }: { streak: number; done: boolean }) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  // 已签到区间 [start, end]：done 时含今日，否则截至昨日。
  const end = done ? todayIdx : todayIdx - 1;
  const start = end - streak + 1;
  const isCheckedIn = (i: number) => streak > 0 && i >= start && i <= end;

  return (
    <div className="flex items-center gap-2">
      {days.map((d, i) => {
        const isToday = i === todayIdx;
        const checked = isCheckedIn(i);
        const isFuture = i > todayIdx;
        const todayDone = isToday && done;
        const todayPending = isToday && !done;

        // 四态配色
        let cls: string;
        if (todayDone) {
          cls = "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 ring-1 ring-emerald-400/50";
        } else if (todayPending) {
          cls = "bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/40 dark:ring-emerald-400/40";
        } else if (checked) {
          cls = "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm";
        } else {
          cls = `bg-zinc-900/[0.03] dark:bg-white/[0.04] ${isFuture ? "text-zinc-300 dark:text-white/25" : "text-zinc-400 dark:text-white/40"}`;
        }

        return (
          <motion.div key={i}
            initial={checked || todayDone ? { scale: 0.8 } : false}
            animate={checked || todayDone ? { scale: 1 } : {}}
            transition={{ type: "spring", stiffness: 400, damping: 15, delay: i * 0.05 }}
            className={`relative flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${cls}`}>
            {checked || todayDone
              ? <Check className="size-4" />
              : <span className="size-4 flex items-center justify-center">{todayPending ? <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" /> : "○"}</span>}
            <span className="text-[10px]">{isToday ? "今天" : d}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
