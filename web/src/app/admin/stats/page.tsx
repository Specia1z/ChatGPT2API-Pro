"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  RefreshCw, CheckCircle, XCircle, AlertTriangle, Ban,
  TrendingUp, Users, ImageIcon, CreditCard, Activity, PieChart,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart as RPieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, ComposedChart, Line, Tooltip,
} from "recharts";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  ChartLegend, ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── 类型 ─────────────────────────────────── */
interface TrendPoint { date: string; value: number; }
interface ModelBreakdown { model: string; count: number; }
interface StatsData {
  stats: {
    total_users: number; today_users: number; active_users: number;
    total_generations: number; today_generations: number; today_success: number; today_failed: number;
    total_orders: number; paid_orders: number; today_revenue: number; total_revenue: number;
    total_accounts: number; normal_accounts: number; limited_accounts: number;
    abnormal_accounts: number; disabled_accounts: number;
  };
  trends: { generations: TrendPoint[]; success: TrendPoint[]; failed: TrendPoint[]; revenue: TrendPoint[]; users: TrendPoint[]; };
  model_breakdown: ModelBreakdown[];
}

/* ── 图表配置 ─────────────────────────────── */
const genChartConfig = {
  success: { label: "成功", theme: { light: "#10b981", dark: "#34d399" } },
  failed: { label: "失败", theme: { light: "#ef4444", dark: "#f87171" } },
  total: { label: "总计", theme: { light: "#6366f1", dark: "#818cf8" } },
} satisfies ChartConfig;
const revenueChartConfig = { value: { label: "收入 ¥", theme: { light: "#f59e0b", dark: "#fbbf24" } } } satisfies ChartConfig;
const usersChartConfig = { value: { label: "新用户", theme: { light: "#6366f1", dark: "#818cf8" } } } satisfies ChartConfig;
const dailyChartConfig = {
  success: { label: "成功", theme: { light: "#10b981", dark: "#34d399" } },
  failed: { label: "失败", theme: { light: "#ef4444", dark: "#f87171" } },
} satisfies ChartConfig;
const MODEL_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6"];

/* ── 计数动画 ─────────────────────────────── */
function useCountUp(target: number, duration = 800, start = true) {
  const [value, setValue] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration, start]);
  return value;
}

function CountUp({ to, fmt }: { to: number; fmt?: (n: number) => string }) {
  const [start, setStart] = useState(false);
  useEffect(() => { const t = setTimeout(() => setStart(true), 100); return () => clearTimeout(t); }, []);
  const val = useCountUp(to, 900, start);
  return <>{fmt ? fmt(val) : val.toLocaleString()}</>;
}

/* ── Sparkline ────────────────────────────── */
function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || data.length < 2) return <div className="w-full h-full" />;
  const vals = data.map(d => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const normalized = data.map(d => ({ ...d, n: ((d.value - min) / range) * 100 }));
  const gradId = `spark-${color.replace("#", "")}`;
  return (
    <ChartContainer config={{}} className="w-full h-full">
      <AreaChart data={normalized} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="n" stroke={color} fill={`url(#${gradId})`} strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ChartContainer>
  );
}

/* ── KPI 卡片 ─────────────────────────────── */
function KpiCard({ icon, iconBg, iconColor, label, value, sparkline, sparkColor, sub, fmt }: {
  icon: React.ReactNode; iconBg: string; iconColor: string;
  label: string; value: number; sparkline?: TrendPoint[]; sparkColor: string;
  sub: string; fmt?: (n: number) => string;
}) {
  return (
    <motion.div variants={fadeUp}
      className="group relative rounded-2xl border bg-card p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-3">
        <div className={`size-10 rounded-xl ${iconBg} flex items-center justify-center`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {sparkline && sparkline.length >= 2 && (
          <div className="w-20 h-8 opacity-50 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkline} color={sparkColor} />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className={`${mono.className} text-2xl font-medium tabular-nums tracking-tight`}>
        <CountUp to={value} fmt={fmt} />
      </p>
      <p className="text-[11px] text-muted-foreground/70 mt-1.5">{sub}</p>
    </motion.div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [chartTab, setChartTab] = useState<"generations" | "revenue" | "users">("generations");

  const load = async () => { setLoading(true); try { const r = await api("/api/admin/stats"); setData(r.data); } catch {} setLoading(false); };
  useEffect(() => { load(); }, []);
  useEffect(() => { setMounted(true); }, []);

  const s = data?.stats;
  const t = data?.trends;
  const mb = data?.model_breakdown || [];
  const successRate = s && s.today_generations > 0 ? Math.round((s.today_success / s.today_generations) * 100) : 0;

  const accountItems = s ? [
    { label: "正常", value: s.normal_accounts, color: "#10b981", icon: CheckCircle },
    { label: "限流", value: s.limited_accounts, color: "#f59e0b", icon: AlertTriangle },
    { label: "异常", value: s.abnormal_accounts, color: "#ef4444", icon: XCircle },
    { label: "禁用", value: s.disabled_accounts, color: "#71717a", icon: Ban },
  ] : [];

  const genTrend = useMemo(() => t?.generations.map((g, i) => ({
    date: g.date, success: t.success[i]?.value || 0, failed: t.failed[i]?.value || 0, total: g.value,
  })) || [], [t]);

  if (loading && !data) return (
    <div className="h-screen bg-background flex overflow-hidden">
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b bg-card px-8 py-4 shrink-0"><Skeleton className="h-6 w-32" /></div>
        <div className="flex-1 p-8 overflow-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
          <Skeleton className="h-[340px] rounded-2xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      </main>
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden`}>
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-base font-semibold tracking-tight`}>数据统计</h1>
            <p className="text-xs text-muted-foreground mt-0.5">最近 7 天运营概览</p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
        </div>

        <motion.div className="flex-1 p-6 lg:p-8 overflow-auto scrollbar-thin"
          variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-6 max-w-[1400px]">

            {/* ═══ KPI 卡片 ═══ */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={<CreditCard className="size-5" />} iconBg="bg-amber-500/10" iconColor="text-amber-500"
                label="总收入" value={s?.total_revenue || 0} fmt={n => `¥${n.toLocaleString()}`}
                sparkline={t?.revenue} sparkColor="#f59e0b"
                sub={`今日 ¥${(s?.today_revenue || 0).toFixed(0)} · 已付 ${s?.paid_orders || 0} 单`} />
              <KpiCard icon={<Users className="size-5" />} iconBg="bg-primary/10" iconColor="text-primary"
                label="总用户" value={s?.total_users || 0}
                sparkline={t?.users} sparkColor="#6366f1"
                sub={`今日 +${s?.today_users || 0} · 活跃 ${s?.active_users || 0}`} />
              <KpiCard icon={<ImageIcon className="size-5" />} iconBg="bg-emerald-500/10" iconColor="text-emerald-500"
                label="总生成" value={s?.total_generations || 0}
                sparkline={t?.generations} sparkColor="#10b981"
                sub={`今日 ${s?.today_generations || 0} 次 · 成功率 ${successRate}%`} />
              <KpiCard icon={<TrendingUp className="size-5" />} iconBg="bg-blue-500/10" iconColor="text-blue-500"
                label="总订单" value={s?.total_orders || 0}
                sparkline={t?.revenue} sparkColor="#3b82f6"
                sub={`已付 ${s?.paid_orders || 0} · 待付 ${(s?.total_orders || 0) - (s?.paid_orders || 0)}`} />
            </div>

            {/* ═══ 趋势图 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className={`${heading.className} text-sm font-semibold`}>
                  {chartTab === "generations" ? "生成量趋势" : chartTab === "revenue" ? "收入趋势" : "新用户趋势"}
                </h2>
                <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                  {(["generations", "revenue", "users"] as const).map(tab => (
                    <button key={tab} onClick={() => setChartTab(tab)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        chartTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}>
                      {tab === "generations" ? "生成量" : tab === "revenue" ? "收入" : "新用户"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[260px]">
                {mounted && (chartTab === "generations" ? (
                  <ChartContainer config={genChartConfig} className="h-full w-full" initialDimension={{ width: 700, height: 260 }}>
                    <ComposedChart data={genTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="success" stackId="a" fill="var(--color-success)" radius={[0, 0, 0, 0]} name="success" />
                      <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={[4, 4, 0, 0]} name="failed" />
                      <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} name="total" />
                    </ComposedChart>
                  </ChartContainer>
                ) : chartTab === "revenue" ? (
                  <ChartContainer config={revenueChartConfig} className="h-full w-full" initialDimension={{ width: 700, height: 260 }}>
                    <AreaChart data={t?.revenue || []}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} tickFormatter={v => `¥${v}`} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="value" stroke="var(--color-value)" fill="url(#revGrad)" strokeWidth={2} name="value" />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <ChartContainer config={usersChartConfig} className="h-full w-full" initialDimension={{ width: 700, height: 260 }}>
                    <AreaChart data={t?.users || []}>
                      <defs>
                        <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="value" stroke="var(--color-value)" fill="url(#userGrad)" strokeWidth={2} name="value" />
                    </AreaChart>
                  </ChartContainer>
                ))}
              </div>
            </motion.div>

            {/* ═══ 模型分布 + 号池状态 ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <PieChart className="size-4 text-violet-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>模型分布</h2>
                </div>
                {mb.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">尚无生成数据</div>
                ) : (
                  <div className="flex items-center gap-5">
                    <div className="w-[150px] h-[150px] shrink-0">
                      {mounted && (
                        <RPieChart width={150} height={150}>
                          <Pie data={mb} dataKey="count" nameKey="model" cx="50%" cy="50%" innerRadius={38} outerRadius={68} strokeWidth={2} paddingAngle={2}>
                            {mb.map((_, i) => <Cell key={i} fill={MODEL_PALETTE[i % MODEL_PALETTE.length]} stroke="var(--background)" />)}
                          </Pie>
                          <Tooltip content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            return (<div className="rounded-lg border bg-popover px-3 py-1.5 text-xs shadow-lg"><span className="font-medium">{payload[0].name}</span><span className="text-muted-foreground ml-2 tabular-nums">{payload[0].value?.toLocaleString()}</span></div>);
                          }} />
                        </RPieChart>
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      {mb.map((m, i) => {
                        const total = mb.reduce((a, b) => a + b.count, 0);
                        const pct = total > 0 ? ((m.count / total) * 100).toFixed(1) : "0";
                        return (
                          <div key={m.model} className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className="size-2 rounded-sm shrink-0" style={{ background: MODEL_PALETTE[i % MODEL_PALETTE.length] }} />
                            <span className="text-foreground truncate flex-1 font-medium">{m.model}</span>
                            <span className={`${mono.className} tabular-nums text-muted-foreground`}>{m.count}</span>
                            <span className={`${mono.className} tabular-nums text-muted-foreground/60 w-10 text-right`}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>

              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Activity className="size-4 text-blue-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>号池状态</h2>
                  <Badge variant="outline" className="ml-auto">{s?.total_accounts || 0} 个</Badge>
                </div>
                {s && s.total_accounts > 0 && (
                  <div className="mb-5">
                    <div className="flex h-2.5 rounded-full bg-muted overflow-hidden">
                      {accountItems.map((seg, i) => {
                        const pct = (seg.value / s.total_accounts) * 100;
                        if (pct <= 0) return null;
                        return <div key={i} className="h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full" style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
                      })}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  {accountItems.map(item => (
                    <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors">
                      <div className="size-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: item.color + "14" }}>
                        <item.icon className="size-4" style={{ color: item.color }} />
                      </div>
                      <div>
                        <div className={`${mono.className} text-base font-medium tabular-nums`}>{item.value}</div>
                        <div className="text-[10px] text-muted-foreground">{item.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* ═══ 每日生成状态 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-6">
              <div className="flex items-center gap-2 mb-5">
                <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <ImageIcon className="size-4 text-emerald-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>每日生成状态</h2>
              </div>
              <div className="h-[180px]">
                {mounted && (
                  <ChartContainer config={dailyChartConfig} className="h-full w-full" initialDimension={{ width: 700, height: 180 }}>
                    <BarChart data={genTrend} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="success" stackId="b" fill="var(--color-success)" radius={[0, 0, 0, 0]} name="success" />
                      <Bar dataKey="failed" stackId="b" fill="var(--color-failed)" radius={[4, 4, 0, 0]} name="failed" />
                    </BarChart>
                  </ChartContainer>
                )}
              </div>
            </motion.div>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
