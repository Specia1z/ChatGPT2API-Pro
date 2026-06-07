"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Activity, Cpu, Gauge, Server, Timer, Boxes, Zap, AlertCircle, CheckCircle2,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { BASE, getToken } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface TimerStatus {
  name: string; running: boolean; last_run_at: string; last_ms: number; last_ok: boolean; last_note: string; runs: number;
}
interface Snapshot {
  time: string;
  qps: number;
  qps_series: number[];
  perf: { goroutines: number; heap_alloc_mb: number; sys_mb: number; num_gc: number; gc_pause_ms: number };
  scheduler: { global_active: number; global_max: number; per_user_max: number; per_account_max: number; active_users: number; total_active: number };
  timers: TimerStatus[];
  pool: { total_accounts: number; busy_accounts: number; total_slots: number; top: { account_id: number; email: string; slots: number }[] };
}

const TIMER_LABELS: Record<string, string> = {
  account_monitor: "账号健康监控",
  order_expirer: "订单超时检查",
  storage_cleaner: "存储清理",
};

export default function SystemMonitorPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${BASE}/api/admin/system/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          const reader = res.body?.getReader();
          if (!reader) break;
          setConnected(true);
          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              let data = "";
              for (const line of part.split("\n")) { if (line.startsWith("data: ")) data = line.slice(6); }
              if (data) { try { setSnap(JSON.parse(data)); } catch {} }
            }
          }
        } catch {}
        setConnected(false);
        await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  const s = snap;
  const qpsChart = (s?.qps_series || []).map((v, i) => ({ i, v }));
  const sched = s?.scheduler;
  const globalPct = sched && sched.global_max > 0 ? (sched.global_active / sched.global_max) * 100 : 0;
  const memPct = s ? Math.min((s.perf.heap_alloc_mb / 4096) * 100, 100) : 0;

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight flex items-center gap-2`}>
              系统监控
              <span className={`inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full ${connected ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "text-muted-foreground bg-muted"}`}>
                <span className="relative flex size-1.5">
                  {connected && <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative rounded-full size-1.5 ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                </span>
                {connected ? "实时" : "连接中"}
              </span>
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">每 2 秒刷新 · QPS / 性能 / 调度 / 号池 / 定时器{s ? ` · ${s.time}` : ""}</p>
          </div>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-4 sm:space-y-6 max-w-[1400px]">
            {!s ? (
              <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
                <div className="size-6 border-2 border-muted border-t-primary rounded-full animate-spin mr-3" /> 正在采集系统数据…
              </div>
            ) : (<>
              {/* ═══ 顶部 KPI ═══ */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge className="size-4 text-primary" /><span className="text-[11px] text-muted-foreground">实时 QPS</span>
                  </div>
                  <div className={`${mono.className} text-2xl font-medium tabular-nums`}>{s.qps}</div>
                  <div className="h-8 mt-1 -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={qpsChart} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                        <defs>
                          <linearGradient id="qpsG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="v" stroke="#6366f1" fill="url(#qpsG)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-muted-foreground/70">近 60 秒</div>
                </motion.div>

                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="size-4 text-blue-500" /><span className="text-[11px] text-muted-foreground">Goroutines</span>
                  </div>
                  <div className={`${mono.className} text-2xl font-medium tabular-nums`}>{s.perf.goroutines}</div>
                  <div className="text-[10px] text-muted-foreground/70 mt-2">GC {s.perf.num_gc} 次 · 暂停 {s.perf.gc_pause_ms.toFixed(1)}ms</div>
                </motion.div>

                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="size-4 text-emerald-500" /><span className="text-[11px] text-muted-foreground">堆内存</span>
                  </div>
                  <div className={`${mono.className} text-2xl font-medium tabular-nums`}>{s.perf.heap_alloc_mb.toFixed(0)}<span className="text-sm text-muted-foreground ml-1">MB</span></div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${memPct > 80 ? "bg-red-500" : memPct > 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${memPct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-1">Sys {s.perf.sys_mb.toFixed(0)}MB · 占 4G 约 {memPct.toFixed(0)}%</div>
                </motion.div>

                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="size-4 text-amber-500" /><span className="text-[11px] text-muted-foreground">生图并发</span>
                  </div>
                  <div className={`${mono.className} text-2xl font-medium tabular-nums`}>{sched?.global_active ?? 0}<span className="text-sm text-muted-foreground ml-1">/ {sched?.global_max ?? 0}</span></div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${globalPct > 80 ? "bg-red-500" : globalPct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${globalPct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-1">活跃用户 {sched?.active_users ?? 0}</div>
                </motion.div>
              </div>

              {/* ═══ 调度器闸门 + 号池占用 ═══ */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                {/* 调度三闸门 */}
                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><Zap className="size-4 text-amber-500" /></div>
                    <h2 className={`${heading.className} text-sm font-semibold`}>并发闸门</h2>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: "全局上限", v: sched?.global_max ?? 0, sub: `当前 ${sched?.global_active ?? 0}` },
                      { label: "单用户上限", v: sched?.per_user_max ?? 0, sub: `${sched?.active_users ?? 0} 用户活跃` },
                      { label: "单账号上限", v: sched?.per_account_max ?? 0, sub: `号池占 ${s.pool.total_slots}` },
                    ].map(g => (
                      <div key={g.label} className="rounded-xl bg-muted/40 p-3">
                        <div className={`${mono.className} text-2xl font-bold tabular-nums text-foreground`}>{g.v}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{g.label}</div>
                        <div className="text-[9px] text-muted-foreground/60 mt-0.5">{g.sub}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-3 leading-relaxed">实际产能 ≈ 单账号上限 × 正常账号数，且不超过全局上限。可在「系统设置 → 调度器」调整。</p>
                </motion.div>

                {/* 号池占用 */}
                <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center"><Boxes className="size-4 text-violet-500" /></div>
                    <h2 className={`${heading.className} text-sm font-semibold`}>号池实时占用</h2>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{s.pool.busy_accounts}/{s.pool.total_accounts} 账号忙</span>
                  </div>
                  {s.pool.top.length > 0 ? (
                    <div className="space-y-1.5">
                      {s.pool.top.map(a => {
                        const pct = sched && sched.per_account_max > 0 ? (a.slots / sched.per_account_max) * 100 : 0;
                        return (
                          <div key={a.account_id} className="flex items-center gap-3 text-xs">
                            <span className="flex-1 truncate text-foreground">{a.email || `#${a.account_id}`}</span>
                            <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : "bg-violet-500/70"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className={`${mono.className} tabular-nums w-12 text-right text-muted-foreground`}>{a.slots}/{sched?.per_account_max ?? "?"}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-xs text-muted-foreground text-center py-8">当前无账号在出图</p>}
                </motion.div>
              </div>

              {/* ═══ 后台定时器 ═══ */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="size-8 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Timer className="size-4 text-cyan-500" /></div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>后台定时器</h2>
                </div>
                {s.timers.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {s.timers.map(t => (
                      <div key={t.name} className="rounded-xl border bg-background p-3.5">
                        <div className="flex items-center gap-2 mb-2">
                          {t.running
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full"><span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />运行中</span>
                            : t.last_ok
                              ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                              : <AlertCircle className="size-3.5 text-amber-500" />}
                          <span className="text-sm font-medium text-foreground truncate">{TIMER_LABELS[t.name] || t.name}</span>
                        </div>
                        <div className={`${mono.className} text-[11px] text-muted-foreground space-y-0.5 tabular-nums`}>
                          <div>上次：{t.last_run_at || "未执行"}</div>
                          <div>耗时 {t.last_ms}ms · 累计 {t.runs} 轮</div>
                          {t.last_note && <div className="text-foreground/70 truncate">{t.last_note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-8">定时器尚未执行（启动后或首次触发才有记录）</p>}
              </motion.div>

            </>)}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
