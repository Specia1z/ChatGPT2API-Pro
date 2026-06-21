"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  RefreshCw, CheckCircle, XCircle, AlertTriangle, Ban,
  TrendingUp, Users, ImageIcon, CreditCard, Activity, PieChart,
  Sparkles, PenTool, Coins, Zap, UserCheck, ListX, UserPlus, Trash2,
  Layers, Server, Clock, Gift, BarChart3,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart as RPieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, ComposedChart, Line, Tooltip, ReferenceDot,
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
interface PointsTypeStat { type: string; issued: number; consumed: number; }
interface PointsStats {
  today_issued: number; today_consumed: number;
  total_issued: number; total_consumed: number;
  by_type: PointsTypeStat[];
}
interface FailureReason { reason: string; count: number; }
interface AccountProductivity {
  id: number; email: string; status: string; plan_type: string;
  success_count: number; fail_count: number; last_used_at: string;
}
interface RetentionStats {
  active_users_7d: number;
  d1_cohort: number; d1_retained: number;
  d7_cohort: number; d7_retained: number;
}
interface AccountEventStats {
  today_registered: number; total_registered: number;
  today_banned: number; total_banned: number;
  today_deleted: number; total_deleted: number;
}
interface AccountEventTrends {
  registered: TrendPoint[]; banned: TrendPoint[]; deleted: TrendPoint[];
}
interface HourlyHeat { hour: number; count: number; }
interface PlanDistribution { plan_name: string; active: number; expired: number; }
interface RevenueByPlan { plan_name: string; orders: number; amount: number; }
interface RevenueComposition { by_plan: RevenueByPlan[]; coupon_orders: number; total_paid: number; }
interface InviteLeader { email: string; invites: number; recharged: number; reward_sum: number; }
interface StatsData {
  stats: {
    total_users: number; today_users: number; active_users: number;
    total_generations: number; today_generations: number; today_success: number; today_failed: number;
    total_svg: number; today_svg: number;
    total_orders: number; paid_orders: number; paid_users: number; today_revenue: number; total_revenue: number;
    total_accounts: number; normal_accounts: number; limited_accounts: number;
    abnormal_accounts: number; disabled_accounts: number;
  };
  trends: {
    generations: TrendPoint[]; success: TrendPoint[]; failed: TrendPoint[]; svg: TrendPoint[];
    revenue: TrendPoint[]; users: TrendPoint[];
    points_issued: TrendPoint[]; points_consumed: TrendPoint[];
  };
  model_breakdown: ModelBreakdown[];
  points: PointsStats;
  failure_reasons: FailureReason[];
  account_prod: AccountProductivity[];
  retention: RetentionStats;
  account_events: AccountEventStats;
  account_event_trends: AccountEventTrends;
  hourly_heat: HourlyHeat[];
  plan_distribution: PlanDistribution[];
  revenue_composition: RevenueComposition;
  invite_leaderboard: InviteLeader[];
  token_usage_dist: TokenUsageDist;
}

interface TokenUsageDist {
  days: number;
  user_count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  suggested: number;
}

/* ── 图表配置 ─────────────────────────────── */
const genChartConfig = {
  success: { label: "成功", theme: { light: "#10b981", dark: "#34d399" } },
  failed: { label: "失败", theme: { light: "#ef4444", dark: "#f87171" } },
  total: { label: "总计", theme: { light: "#6366f1", dark: "#818cf8" } },
} satisfies ChartConfig;
const revenueChartConfig = { value: { label: "收入 ¥", theme: { light: "#f59e0b", dark: "#fbbf24" } } } satisfies ChartConfig;
const usersChartConfig = { value: { label: "新用户", theme: { light: "#6366f1", dark: "#818cf8" } } } satisfies ChartConfig;
const hourChartConfig = { count: { label: "出图", theme: { light: "#6366f1", dark: "#818cf8" } } } satisfies ChartConfig;
const dailyChartConfig = {
  success: { label: "成功", theme: { light: "#10b981", dark: "#34d399" } },
  failed: { label: "失败", theme: { light: "#ef4444", dark: "#f87171" } },
} satisfies ChartConfig;
const pointsChartConfig = {
  issued: { label: "发放", theme: { light: "#10b981", dark: "#34d399" } },
  consumed: { label: "消耗", theme: { light: "#f59e0b", dark: "#fbbf24" } },
} satisfies ChartConfig;
const acctEventChartConfig = {
  registered: { label: "注册", theme: { light: "#10b981", dark: "#34d399" } },
  banned: { label: "封禁", theme: { light: "#ef4444", dark: "#f87171" } },
  deleted: { label: "删除", theme: { light: "#71717a", dark: "#a1a1aa" } },
} satisfies ChartConfig;
const MODEL_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6"];

/* ── 积分类型标签 ─────────────────────────── */
const POINTS_TYPE_LABELS: Record<string, string> = {
  checkin: "每日签到", invite: "邀请奖励", redeem_code: "兑换码",
  admin: "管理员调整", exchange_token: "兑换令牌", shop: "积分商城",
};
const pointsTypeLabel = (t: string) => POINTS_TYPE_LABELS[t] || t || "其它";

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
      className="group relative rounded-2xl border bg-card p-4 sm:p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-2 sm:mb-3">
        <div className={`size-9 sm:size-10 rounded-xl ${iconBg} flex items-center justify-center`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {sparkline && sparkline.length >= 2 && (
          <div className="w-16 h-7 sm:w-20 sm:h-8 opacity-50 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkline} color={sparkColor} />
          </div>
        )}
      </div>
      <p className="text-[11px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">{label}</p>
      <p className={`${mono.className} text-xl sm:text-2xl font-medium tabular-nums tracking-tight`}>
        <CountUp to={value} fmt={fmt} />
      </p>
      <p className="text-[10px] sm:text-[11px] text-muted-foreground/70 mt-1 sm:mt-1.5">{sub}</p>
    </motion.div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [chartTab, setChartTab] = useState<"generations" | "revenue" | "users" | "points">("generations");
  const [mainTab, setMainTab] = useState<"overview" | "generation" | "revenue" | "users" | "accounts">("overview");

  const load = async () => { setLoading(true); try { const r = await api("/api/admin/stats"); setData(r.data); } catch {} setLoading(false); };
  useEffect(() => { load(); }, []);
  useEffect(() => { setMounted(true); }, []);

  const s = data?.stats;
  const t = data?.trends;
  const mb = data?.model_breakdown || [];
  const pts = data?.points;
  const successRate = s && s.today_generations > 0 ? Math.round((s.today_success / s.today_generations) * 100) : 0;
  // 付费转化率 = 付费用户 / 总用户
  const conversionRate = s && s.total_users > 0 ? ((s.paid_users / s.total_users) * 100).toFixed(1) : "0";
  // 客单价 ARPU = 总收入 / 已付订单
  const arpu = s && s.paid_orders > 0 ? (s.total_revenue / s.paid_orders) : 0;
  // 今日积分净流入（发放 - 消耗），正=通胀风险
  const pointsNet = pts ? pts.today_issued - pts.today_consumed : 0;
  const failures = data?.failure_reasons || [];
  const accountProd = data?.account_prod || [];
  const ret = data?.retention;
  const d1Rate = ret && ret.d1_cohort > 0 ? Math.round((ret.d1_retained / ret.d1_cohort) * 100) : 0;
  const d7Rate = ret && ret.d7_cohort > 0 ? Math.round((ret.d7_retained / ret.d7_cohort) * 100) : 0;
  const failTotal = failures.reduce((a, b) => a + b.count, 0);
  const ae = data?.account_events;
  const aeTrends = data?.account_event_trends;
  const aeTrend = useMemo(() => aeTrends?.registered.map((r, i) => ({
    date: r.date, registered: r.value, banned: aeTrends.banned[i]?.value || 0, deleted: aeTrends.deleted[i]?.value || 0,
  })) || [], [aeTrends]);
  const hourlyHeat = data?.hourly_heat || [];
  const hourTotal = hourlyHeat.reduce((a, h) => a + h.count, 0);
  // 主/次高峰：主峰=出图最多的小时；次峰=与主峰相隔≥3 小时的第二高（避开相邻同一波）
  const peakHour = hourlyHeat.reduce((m, h) => (h.count > m.count ? h : m), { hour: 0, count: 0 });
  const secondPeak = hourlyHeat
    .filter(h => Math.abs(h.hour - peakHour.hour) >= 3 && h.count > 0)
    .reduce((m, h) => (h.count > m.count ? h : m), { hour: -1, count: 0 });
  const planDist = data?.plan_distribution || [];
  const revComp = data?.revenue_composition;
  const inviteBoard = data?.invite_leaderboard || [];
  const revTotal = revComp ? revComp.by_plan.reduce((a, b) => a + b.amount, 0) : 0;
  const tokenDist = data?.token_usage_dist;

  const accountItems = s ? [
    { label: "正常", value: s.normal_accounts, color: "#10b981", icon: CheckCircle },
    { label: "限流", value: s.limited_accounts, color: "#f59e0b", icon: AlertTriangle },
    { label: "异常", value: s.abnormal_accounts, color: "#ef4444", icon: XCircle },
    { label: "禁用", value: s.disabled_accounts, color: "#71717a", icon: Ban },
  ] : [];

  const genTrend = useMemo(() => t?.generations.map((g, i) => ({
    date: g.date, success: t.success[i]?.value || 0, failed: t.failed[i]?.value || 0, total: g.value,
  })) || [], [t]);

  const pointsTrend = useMemo(() => t?.points_issued.map((p, i) => ({
    date: p.date, issued: p.value, consumed: t.points_consumed[i]?.value || 0,
  })) || [], [t]);

  if (loading && !data) return (
    <div className="h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b bg-card px-4 sm:px-8 py-4 shrink-0"><Skeleton className="h-6 w-32" /></div>
        <div className="flex-1 p-4 sm:p-8 overflow-auto space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 sm:h-36 rounded-2xl" />)}
          </div>
          <Skeleton className="h-[260px] sm:h-[340px] rounded-2xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <Skeleton className="h-60 sm:h-72 rounded-2xl" />
            <Skeleton className="h-60 sm:h-72 rounded-2xl" />
          </div>
        </div>
      </main>
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>数据统计</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">运营数据概览 · 趋势区间近 7 天</p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin"
          variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-6 max-w-[1400px]">

            {/* ═══ 主 Tab 导航 ═══ */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
              {([
                { key: "overview", label: "总览", icon: BarChart3 },
                { key: "generation", label: "生成", icon: ImageIcon },
                { key: "revenue", label: "营收", icon: CreditCard },
                { key: "users", label: "用户", icon: Users },
                { key: "accounts", label: "账号", icon: Server },
              ] as const).map(tab => (
                <button key={tab.key} onClick={() => setMainTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                    mainTab === tab.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}>
                  <tab.icon className="size-3.5" /> {tab.label}
                </button>
              ))}
            </div>

            {/* ═══════════ 总览 ═══════════ */}
            {mainTab === "overview" && (<>

            {/* ═══ KPI 卡片 ═══ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <KpiCard icon={<CreditCard className="size-5" />} iconBg="bg-amber-500/10" iconColor="text-amber-500"
                label="总收入" value={s?.total_revenue || 0} fmt={n => `¥${n.toLocaleString()}`}
                sparkline={t?.revenue} sparkColor="#f59e0b"
                sub={`今日 ¥${(s?.today_revenue || 0).toFixed(0)} · 已付 ${s?.paid_orders || 0} 单`} />
              <KpiCard icon={<Users className="size-5" />} iconBg="bg-primary/10" iconColor="text-primary"
                label="总用户" value={s?.total_users || 0}
                sparkline={t?.users} sparkColor="#6366f1"
                sub={`今日 +${s?.today_users || 0} · 活跃 ${s?.active_users || 0}`} />
              <KpiCard icon={<Sparkles className="size-5" />} iconBg="bg-rose-500/10" iconColor="text-rose-500"
                label="付费转化" value={s?.paid_users || 0}
                sparkline={t?.revenue} sparkColor="#f43f5e"
                sub={`转化率 ${conversionRate}% · ARPU ¥${arpu.toFixed(1)}`} />
              <KpiCard icon={<ImageIcon className="size-5" />} iconBg="bg-emerald-500/10" iconColor="text-emerald-500"
                label="图片生成" value={s?.total_generations || 0}
                sparkline={t?.generations} sparkColor="#10b981"
                sub={`今日 ${s?.today_generations || 0} 次 · 成功率 ${successRate}%`} />
              <KpiCard icon={<PenTool className="size-5" />} iconBg="bg-violet-500/10" iconColor="text-violet-500"
                label="矢量生成" value={s?.total_svg || 0}
                sparkline={t?.svg} sparkColor="#8b5cf6"
                sub={`今日 ${s?.today_svg || 0} 次`} />
              <KpiCard icon={<TrendingUp className="size-5" />} iconBg="bg-blue-500/10" iconColor="text-blue-500"
                label="总订单" value={s?.total_orders || 0}
                sparkline={t?.revenue} sparkColor="#3b82f6"
                sub={`已付 ${s?.paid_orders || 0} · 待付 ${(s?.total_orders || 0) - (s?.paid_orders || 0)}`} />
            </div>

            {/* ═══ 趋势图 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <h2 className={`${heading.className} text-sm font-semibold`}>
                  {chartTab === "generations" ? "生成量趋势" : chartTab === "revenue" ? "收入趋势" : chartTab === "users" ? "新用户趋势" : "积分收支趋势"}
                </h2>
                <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                  {(["generations", "revenue", "users", "points"] as const).map(tab => (
                    <button key={tab} onClick={() => setChartTab(tab)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        chartTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}>
                      {tab === "generations" ? "生成量" : tab === "revenue" ? "收入" : tab === "users" ? "新用户" : "积分"}
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
                ) : chartTab === "users" ? (
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
                ) : (
                  <ChartContainer config={pointsChartConfig} className="h-full w-full" initialDimension={{ width: 700, height: 260 }}>
                    <AreaChart data={pointsTrend}>
                      <defs>
                        <linearGradient id="issuedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-issued)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--color-issued)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="consumedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-consumed)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--color-consumed)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Area type="monotone" dataKey="issued" stroke="var(--color-issued)" fill="url(#issuedGrad)" strokeWidth={2} name="issued" />
                      <Area type="monotone" dataKey="consumed" stroke="var(--color-consumed)" fill="url(#consumedGrad)" strokeWidth={2} name="consumed" />
                    </AreaChart>
                  </ChartContainer>
                ))}
              </div>
            </motion.div>

            </>)}

            {/* ═══════════ 生成 ═══════════ */}
            {mainTab === "generation" && (<>

            {/* ═══ 令牌用量分布 · 月配额参考 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Coins className="size-4 text-amber-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>令牌用量分布 · 月配额参考</h2>
              </div>
              <p className="text-[11px] text-muted-foreground mb-4 ml-10">
                近 {tokenDist?.days ?? 30} 天每用户令牌消耗总量分布（{tokenDist?.user_count ?? 0} 位活跃用户）。
                用于为套餐设定「每月令牌上限」——建议取 P99 的数倍，正常用户碰不到，仅工业级转卖会撞顶。
              </p>
              {!tokenDist || tokenDist.user_count === 0 ? (
                <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">暂无足够用量数据</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                    {[
                      { label: "P50 中位", v: tokenDist.p50, hint: "一半用户低于此" },
                      { label: "P90", v: tokenDist.p90, hint: "90% 用户低于此" },
                      { label: "P95", v: tokenDist.p95, hint: "95% 用户低于此" },
                      { label: "P99", v: tokenDist.p99, hint: "99% 用户低于此" },
                      { label: "Max 峰值", v: tokenDist.max, hint: "最重度用户" },
                    ].map(c => (
                      <div key={c.label} className="rounded-xl border bg-muted/30 p-2.5 sm:p-3">
                        <p className="text-[10px] text-muted-foreground">{c.label}</p>
                        <p className="text-base sm:text-lg font-semibold tabular-nums leading-tight mt-0.5">{c.v.toLocaleString()}</p>
                        <p className="text-[9px] text-muted-foreground/70 mt-0.5">{c.hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                    <Coins className="size-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-[11px] leading-relaxed">
                      <span className="text-muted-foreground">建议月配额（P99 × 4）：</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums text-sm ml-1">{tokenDist.suggested.toLocaleString()}</span>
                      <span className="text-muted-foreground"> 令牌/月</span>
                      <p className="text-muted-foreground/70 mt-0.5">在「套餐管理」中为各套餐填入「每月令牌上限」。设 0 表示不限。</p>
                      {tokenDist.user_count < 20 && (
                        <p className="text-amber-600/80 dark:text-amber-400/80 mt-1">
                          ⚠ 当前仅 {tokenDist.user_count} 位用户有用量记录，样本偏少（Web 生图采集为近期接入，历史数据不全），此建议值参考意义有限。建议积累 2-4 周真实流量后再据此定配额。
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </motion.div>

            {/* ═══ 模型分布 ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <PieChart className="size-4 text-violet-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>模型分布</h2>
                </div>
                {mb.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">尚无生成数据</div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
                    <div className="w-[120px] h-[120px] sm:w-[150px] sm:h-[150px] shrink-0">
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

              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                    <Clock className="size-4 text-indigo-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>出图时段分布</h2>
                  <span className="ml-auto text-[10px] text-muted-foreground">近 7 天 · 按小时</span>
                </div>
                {hourTotal > 0 ? (
                  <>
                    {/* 高峰提示：主峰 + 次峰 */}
                    <div className="flex items-center flex-wrap gap-2 mb-3 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
                        主高峰 {peakHour.hour}:00–{peakHour.hour + 1}:00
                      </span>
                      <span className="text-muted-foreground">{peakHour.count} 张 · 占比 {Math.round((peakHour.count / hourTotal) * 100)}%</span>
                      {secondPeak.hour >= 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          次高峰 {secondPeak.hour}:00–{secondPeak.hour + 1}:00 · {secondPeak.count} 张
                        </span>
                      )}
                    </div>
                    {/* 24h 面积曲线 */}
                    <div className="h-[200px]">
                      {mounted && (
                        <ChartContainer config={hourChartConfig} className="h-full w-full" initialDimension={{ width: 500, height: 200 }}>
                          <AreaChart data={hourlyHeat} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                            <defs>
                              <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.4} />
                                <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                            <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 10 }}
                              ticks={[0, 3, 6, 9, 12, 15, 18, 21]} tickFormatter={(v) => `${v}时`} interval={0} />
                            <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 10 }} allowDecimals={false} width={40} />
                            <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `${p?.[0]?.payload?.hour ?? 0}:00–${(p?.[0]?.payload?.hour ?? 0) + 1}:00`} />} />
                            <Area type="monotone" dataKey="count" stroke="var(--color-count)" fill="url(#hourGrad)" strokeWidth={2}
                              dot={false} activeDot={{ r: 4 }} name="count" />
                            {/* 主高峰：大实心高亮点 */}
                            <ReferenceDot x={peakHour.hour} y={peakHour.count} r={5}
                              fill="var(--color-count)" stroke="var(--background)" strokeWidth={2} />
                            {/* 次高峰：小一号半透明点 */}
                            {secondPeak.hour >= 0 && (
                              <ReferenceDot x={secondPeak.hour} y={secondPeak.count} r={4}
                                fill="var(--color-count)" fillOpacity={0.45} stroke="var(--background)" strokeWidth={2} />
                            )}
                          </AreaChart>
                        </ChartContainer>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-2">近 7 天按小时聚合，反映当前用户活跃时段。可据高峰安排号池补充与维护窗口。</p>
                  </>
                ) : <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">尚无生成数据</div>}
              </motion.div>
            </div>

            {/* ═══ 每日生成状态 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
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

            {/* ═══ 失败原因 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
                <div className="size-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <ListX className="size-4 text-red-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>失败原因</h2>
                <Badge variant="outline" className="ml-auto">近 7 天 {failTotal}</Badge>
              </div>
              {failures.length > 0 ? (
                <div className="space-y-2.5">
                  {failures.map(f => {
                    const pct = failTotal > 0 ? (f.count / failTotal) * 100 : 0;
                    return (
                      <div key={f.reason} className="flex items-center gap-3 text-xs">
                        <span className="w-24 shrink-0 font-medium text-foreground truncate">{f.reason}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-red-500/70 transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`${mono.className} tabular-nums w-16 text-right text-muted-foreground`}>
                          {f.count} · {pct.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">近 7 天无失败记录 🎉</p>}
            </motion.div>

            </>)}

            {/* ═══════════ 营收 ═══════════ */}
            {mainTab === "revenue" && (<>

            {/* ═══ 收入构成 + 套餐分布 ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {/* 收入构成 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <CreditCard className="size-4 text-amber-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>收入构成</h2>
                  {revComp && revComp.total_paid > 0 && (
                    <Badge variant="outline" className="ml-auto">用券 {Math.round((revComp.coupon_orders / revComp.total_paid) * 100)}%</Badge>
                  )}
                </div>
                {revComp && revComp.by_plan.length > 0 ? (
                  <div className="space-y-2.5">
                    {revComp.by_plan.map((r, i) => {
                      const pct = revTotal > 0 ? (r.amount / revTotal) * 100 : 0;
                      return (
                        <div key={r.plan_name} className="flex items-center gap-3 text-xs">
                          <span className="size-2 rounded-sm shrink-0" style={{ background: MODEL_PALETTE[i % MODEL_PALETTE.length] }} />
                          <span className="w-24 shrink-0 font-medium text-foreground truncate">{r.plan_name}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: MODEL_PALETTE[i % MODEL_PALETTE.length] }} />
                          </div>
                          <span className={`${mono.className} tabular-nums w-24 text-right text-muted-foreground`}>¥{r.amount.toLocaleString()} · {r.orders}单</span>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground/70 pt-1">已付订单按套餐拆解。用券率 = 使用优惠券的已付订单占比。</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-8">尚无已付订单</p>}
              </motion.div>

              {/* 套餐订阅分布 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Layers className="size-4 text-blue-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>套餐订阅分布</h2>
                </div>
                {planDist.length > 0 ? (
                  <div className="space-y-3">
                    {planDist.map(p => {
                      const tot = p.active + p.expired;
                      const activePct = tot > 0 ? (p.active / tot) * 100 : 0;
                      return (
                        <div key={p.plan_name} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground truncate">{p.plan_name}</span>
                            <span className={`${mono.className} tabular-nums text-muted-foreground`}>
                              <span className="text-emerald-600 dark:text-emerald-400">{p.active} 活跃</span> · {p.expired} 过期
                            </span>
                          </div>
                          <div className="flex h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-emerald-500/70 first:rounded-l-full" style={{ width: `${activePct}%` }} />
                            <div className="h-full bg-muted-foreground/30" style={{ width: `${100 - activePct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground/70 pt-1">绿色=当前未过期订阅，灰色=已过期。仅统计付费套餐用户。</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-8">尚无付费订阅</p>}
              </motion.div>
            </div>

            </>)}

            {/* ═══════════ 用户 ═══════════ */}
            {mainTab === "users" && (<>

            {/* ═══ 积分经济 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
                <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Coins className="size-4 text-amber-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>积分经济</h2>
                <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${pointsNet > 0 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                  今日净{pointsNet >= 0 ? "流入" : "流出"} {Math.abs(pointsNet).toLocaleString()}
                </span>
              </div>

              {/* 概览数字 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-5">
                {[
                  { label: "今日发放", value: pts?.today_issued || 0, color: "text-emerald-600 dark:text-emerald-400" },
                  { label: "今日消耗", value: pts?.today_consumed || 0, color: "text-amber-600 dark:text-amber-400" },
                  { label: "累计发放", value: pts?.total_issued || 0, color: "text-muted-foreground" },
                  { label: "累计消耗", value: pts?.total_consumed || 0, color: "text-muted-foreground" },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-muted/40 p-3">
                    <p className="text-[10px] text-muted-foreground mb-0.5">{item.label}</p>
                    <p className={`${mono.className} text-lg font-medium tabular-nums ${item.color}`}>{item.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>

              {/* 按类型拆解 */}
              {pts && pts.by_type.length > 0 ? (
                <div className="space-y-2.5">
                  {pts.by_type.map(bt => {
                    const max = Math.max(...pts.by_type.map(x => Math.max(x.issued, x.consumed)), 1);
                    return (
                      <div key={bt.type} className="flex items-center gap-3 text-xs">
                        <span className="w-16 shrink-0 font-medium text-foreground truncate">{pointsTypeLabel(bt.type)}</span>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden flex justify-end">
                            {bt.issued > 0 && <div className="h-full rounded-l-full bg-emerald-500/70" style={{ width: `${(bt.issued / max) * 100}%` }} />}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            {bt.consumed > 0 && <div className="h-full rounded-r-full bg-amber-500/70" style={{ width: `${(bt.consumed / max) * 100}%` }} />}
                          </div>
                        </div>
                        <span className={`${mono.className} tabular-nums w-24 text-right text-muted-foreground`}>
                          <span className="text-emerald-600 dark:text-emerald-400">+{bt.issued.toLocaleString()}</span>
                          {" / "}
                          <span className="text-amber-600 dark:text-amber-400">-{bt.consumed.toLocaleString()}</span>
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-muted-foreground/70 pt-1">左侧绿条=发放，右侧橙条=消耗。净流入持续为正提示积分通胀风险。</p>
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-6">尚无积分流水</p>}
            </motion.div>

            {/* ═══ 留存 + 邀请榜 ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {/* 邀请裂变榜 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
                    <Gift className="size-4 text-pink-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>邀请裂变榜 Top 8</h2>
                </div>
                {inviteBoard.length > 0 ? (
                  <div className="space-y-2">
                    {inviteBoard.map((l, i) => (
                      <div key={l.email} className="flex items-center gap-3 text-xs">
                        <span className={`${mono.className} w-5 text-center tabular-nums ${i < 3 ? "text-amber-500 font-bold" : "text-muted-foreground/60"}`}>{i + 1}</span>
                        <span className="flex-1 font-medium text-foreground truncate">{l.email}</span>
                        <span className={`${mono.className} tabular-nums text-muted-foreground`}>
                          <span className="text-foreground">{l.invites}</span> 邀 · <span className="text-emerald-600 dark:text-emerald-400">{l.recharged}</span> 充 · <span className="text-amber-600 dark:text-amber-400">{l.reward_sum}</span> 分
                        </span>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground/70 pt-1">邀=邀请注册数，充=其中已首充人数，分=累计获得邀请积分。</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-8">尚无邀请记录</p>}
              </motion.div>

              {/* 留存 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4 sm:mb-5">
                  <div className="size-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                    <UserCheck className="size-4 text-cyan-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>用户留存</h2>
                  <Badge variant="outline" className="ml-auto">7日活跃 {ret?.active_users_7d || 0}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "次日留存", rate: d1Rate, retained: ret?.d1_retained || 0, cohort: ret?.d1_cohort || 0, color: "#06b6d4" },
                    { label: "7 日留存", rate: d7Rate, retained: ret?.d7_retained || 0, cohort: ret?.d7_cohort || 0, color: "#6366f1" },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl bg-muted/40 p-4 flex flex-col items-center justify-center text-center">
                      <div className="relative size-16 mb-2">
                        <svg className="size-16 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-muted" strokeWidth="3" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke={item.color} strokeWidth="3"
                            strokeDasharray={`${item.rate} 100`} strokeLinecap="round" className="transition-all duration-1000" />
                        </svg>
                        <div className={`${mono.className} absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums`}>{item.rate}%</div>
                      </div>
                      <p className="text-xs font-medium text-foreground">{item.label}</p>
                      <p className={`${mono.className} text-[10px] text-muted-foreground tabular-nums mt-0.5`}>{item.retained}/{item.cohort}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-3 leading-relaxed">基于出图行为推断：注册后第 1/7 天有出图即视为留存。分母为注册满对应天数的用户。</p>
              </motion.div>
            </div>

            </>)}

            {/* ═══════════ 账号 ═══════════ */}
            {mainTab === "accounts" && (<>

            {/* ═══ 号池状态 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                {accountItems.map(item => (
                  <div key={item.label} className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors">
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

            {/* ═══ 账号生命周期 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
                <div className="size-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                  <UserPlus className="size-4 text-teal-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>账号生命周期</h2>
                <span className="ml-auto text-[10px] text-muted-foreground">自建表起累计</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* 指标格子 */}
                <div className="grid grid-cols-3 gap-2.5 sm:gap-3 content-start">
                  {[
                    { label: "注册/补号", icon: UserPlus, color: "#10b981", today: ae?.today_registered || 0, total: ae?.total_registered || 0 },
                    { label: "封禁(401)", icon: Ban, color: "#ef4444", today: ae?.today_banned || 0, total: ae?.total_banned || 0 },
                    { label: "删除清理", icon: Trash2, color: "#71717a", today: ae?.today_deleted || 0, total: ae?.total_deleted || 0 },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl bg-muted/40 p-3 flex flex-col">
                      <div className="flex items-center gap-1.5 mb-2">
                        <item.icon className="size-3.5" style={{ color: item.color }} />
                        <span className="text-[10px] text-muted-foreground truncate">{item.label}</span>
                      </div>
                      <p className={`${mono.className} text-xl font-medium tabular-nums`} style={{ color: item.color }}>{item.total.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">今日 +{item.today}</p>
                    </div>
                  ))}
                  <div className="col-span-3 rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted-foreground">当前异常账号</p>
                      <p className={`${mono.className} text-lg font-medium tabular-nums text-amber-600 dark:text-amber-400`}>{s?.abnormal_accounts || 0}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">当前限流</p>
                      <p className={`${mono.className} text-lg font-medium tabular-nums text-amber-500`}>{s?.limited_accounts || 0}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">当前禁用</p>
                      <p className={`${mono.className} text-lg font-medium tabular-nums text-muted-foreground`}>{s?.disabled_accounts || 0}</p>
                    </div>
                  </div>
                </div>

                {/* 趋势图 */}
                <div className="h-[200px]">
                  {mounted && (
                    <ChartContainer config={acctEventChartConfig} className="h-full w-full" initialDimension={{ width: 500, height: 200 }}>
                      <BarChart data={aeTrend} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 11 }} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar dataKey="registered" fill="var(--color-registered)" radius={[3, 3, 0, 0]} name="registered" />
                        <Bar dataKey="banned" fill="var(--color-banned)" radius={[3, 3, 0, 0]} name="banned" />
                        <Bar dataKey="deleted" fill="var(--color-deleted)" radius={[3, 3, 0, 0]} name="deleted" />
                      </BarChart>
                    </ChartContainer>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-3 leading-relaxed">封禁=401 被官方封号后自动删除；删除清理=手动删 + 异常/禁用自动清理。账号删除后行即消失，故这些累计数依赖事件流水（自本次建表起记录）。</p>
            </motion.div>

            {/* ═══ 账号产能排行 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4 sm:mb-5">
                <div className="size-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Zap className="size-4 text-orange-500" />
                </div>
                <h2 className={`${heading.className} text-sm font-semibold`}>账号产能 Top 8</h2>
              </div>
              {accountProd.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-[10px] text-muted-foreground uppercase tracking-wider">
                        <th className="text-left py-2 font-medium">账号</th>
                        <th className="text-center py-2 font-medium">状态</th>
                        <th className="text-right py-2 font-medium">成功</th>
                        <th className="text-right py-2 font-medium">失败</th>
                        <th className="text-right py-2 font-medium">成功率</th>
                        <th className="text-right py-2 font-medium hidden sm:table-cell">最近使用</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {accountProd.map(a => {
                        const tot = a.success_count + a.fail_count;
                        const rate = tot > 0 ? Math.round((a.success_count / tot) * 100) : 0;
                        const stColor = a.status === "正常" ? "#10b981" : a.status === "限流" ? "#f59e0b" : a.status === "禁用" ? "#71717a" : "#ef4444";
                        return (
                          <tr key={a.id} className="hover:bg-muted/40 transition-colors">
                            <td className="py-2.5 max-w-[160px]">
                              <div className="font-medium truncate">{a.email || `#${a.id}`}</div>
                              <div className="text-[10px] text-muted-foreground">{a.plan_type}</div>
                            </td>
                            <td className="py-2.5 text-center">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ color: stColor, backgroundColor: stColor + "1a" }}>{a.status}</span>
                            </td>
                            <td className={`${mono.className} py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400`}>{a.success_count.toLocaleString()}</td>
                            <td className={`${mono.className} py-2.5 text-right tabular-nums text-muted-foreground`}>{a.fail_count.toLocaleString()}</td>
                            <td className={`${mono.className} py-2.5 text-right tabular-nums ${rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : rate >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{rate}%</td>
                            <td className={`${mono.className} py-2.5 text-right tabular-nums text-[11px] text-muted-foreground hidden sm:table-cell`}>{a.last_used_at || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">尚无账号数据</p>}
            </motion.div>

            </>)}

          </div>
        </motion.div>
      </main>
    </div>
  );
}
