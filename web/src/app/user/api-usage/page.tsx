"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity, CheckCircle2, AlertTriangle, Coins, ArrowLeft, Loader2, ListFilter,
  TrendingUp, Boxes, KeyRound, Clock,
} from "lucide-react";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip,
  BarChart, Bar, Cell,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAnimatedNumber } from "../lib/hooks";
import { stagger, fadeUp } from "../lib/helpers";

const CARD = "rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl";

// 端点标签中文化
const EP_LABEL: Record<string, string> = {
  "images.generations": "生图",
  "images.query": "生图查询",
  "vector": "矢量生成",
  "image-to-text": "图生文",
  "image-enhance": "智能增强",
  "openai.images": "OpenAI 生图",
  "openai.models": "模型探测",
  "user.tokens": "令牌查询",
};
const epLabel = (e: string) => EP_LABEL[e] || e;

// 状态码配色
function statusTone(code: number): string {
  if (code >= 200 && code < 300) return "text-emerald-600 dark:text-emerald-400";
  if (code === 429) return "text-amber-600 dark:text-amber-400";
  if (code >= 400) return "text-red-600 dark:text-red-400";
  return "text-zinc-500 dark:text-white/50";
}

const BAR_COLORS = ["#6366f1", "#22d3ee", "#e879f9", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#60a5fa"];

const DAY_OPTIONS = [7, 14, 30];
const PAGE_SIZE = 20;

// 概览指标卡：与 ProfileHeader/StatCard 一致的图标徽章 + 缓动数字。
function OverviewCard({ icon, label, value, sub, tone, loading, animate }: {
  icon: React.ReactNode; label: string; value: number | string; sub: string;
  tone: string; loading: boolean; animate?: boolean;
}) {
  const numeric = typeof value === "number" ? value : 0;
  const animated = useAnimatedNumber(animate ? numeric : 0);
  const shown = animate ? Math.round(animated).toLocaleString() : value;
  return (
    <motion.div variants={fadeUp}
      className={`${CARD} p-5 space-y-3 hover:bg-white/80 dark:hover:bg-white/[0.06] transition-colors`}>
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center text-zinc-500 dark:text-white/55">
          {icon}
        </div>
      </div>
      <div>
        <p className="text-xs text-zinc-500 dark:text-white/50">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums tracking-tight mt-0.5 ${tone}`}>
          {loading ? <span className="text-zinc-300 dark:text-white/20">—</span> : shown}
        </p>
        <p className="text-[10px] text-zinc-400 dark:text-white/40 mt-0.5">{sub}</p>
      </div>
    </motion.div>
  );
}

export default function APIUsagePage() {
  const { user, token, loading: authLoading } = useAuth();

  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // 明细表
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterEndpoint, setFilterEndpoint] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const r = await api(`/api/user/api-usage/summary?days=${days}`);
      setSummary(r.data || null);
    } catch { /* 静默 */ }
    finally { setLoadingSummary(false); }
  }, [days]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterEndpoint) params.set("endpoint", filterEndpoint);
      if (filterStatus) params.set("status", filterStatus);
      const r = await api(`/api/user/api-usage/logs?${params.toString()}`);
      setLogs(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch { /* 静默 */ }
    finally { setLoadingLogs(false); }
  }, [page, filterEndpoint, filterStatus]);

  useEffect(() => { if (user && token) fetchSummary(); }, [user, token, fetchSummary]);
  useEffect(() => { if (user && token) fetchLogs(); }, [user, token, fetchLogs]);

  if (authLoading) return null;
  if (!user) { if (typeof window !== "undefined") window.location.href = "/login"; return null; }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const successRate = summary && summary.total_calls > 0
    ? ((summary.success_calls / summary.total_calls) * 100).toFixed(1)
    : "100";

  const endpointBars = (summary?.by_endpoint || []).map((d: any) => ({ name: epLabel(d.name), calls: d.calls, tokens: d.tokens }));
  const keyBars = (summary?.by_key || []).map((d: any) => ({ name: d.key_name, calls: d.calls, tokens: d.tokens }));
  const maxKeyCalls = Math.max(...keyBars.map((x: any) => x.calls), 1);

  return (
    <div className="min-h-screen bg-[#fbfbfd] dark:bg-[#06070d] pb-16 md:pb-0">
      <Navbar />

      {/* ════ 流体头部：与全站统一（顶部浓、向下淡出） ════ */}
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[36rem] overflow-hidden pointer-events-none">
          <div className="absolute top-[-12%] left-[-6%] w-[40vw] h-[40vw] rounded-full blur-[110px] opacity-40 dark:opacity-45 mix-blend-multiply dark:mix-blend-screen bg-[#22d3ee] [will-change:transform]" style={{ animation: "fluidA 18s ease-in-out infinite" }} />
          <div className="absolute top-[-8%] right-[-4%] w-[36vw] h-[36vw] rounded-full blur-[110px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidB 20s ease-in-out infinite" }} />
          <div className="absolute top-[6%] left-1/3 w-[34vw] h-[34vw] rounded-full blur-[110px] opacity-30 dark:opacity-35 mix-blend-multiply dark:mix-blend-screen bg-[#e879f9] [will-change:transform]" style={{ animation: "fluidC 22s ease-in-out infinite" }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#fbfbfd] dark:to-[#06070d]" />
        </div>
        <div className="absolute inset-x-0 top-0 h-[36rem] opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

        <motion.div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6"
          variants={stagger} initial="hidden" animate="visible">

          {/* PLACEHOLDER_HEADER */}
          <motion.div variants={fadeUp} className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Link href="/user" aria-label="返回用户中心"
                className="flex items-center justify-center size-10 rounded-xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-white/[0.06] transition-colors">
                <ArrowLeft className="size-4" />
              </Link>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">API 用量</h1>
                <p className="text-sm text-zinc-500 dark:text-white/50 mt-0.5">开发者调用视角 · 按 Key 与端点拆分</p>
              </div>
            </div>
            {/* 时间范围切换（胶囊） */}
            <div className="flex items-center gap-1 p-1 rounded-xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl">
              {DAY_OPTIONS.map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${days === d ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm" : "text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white"}`}>
                  {d} 天
                </button>
              ))}
            </div>
          </motion.div>

          {/* PLACEHOLDER_OVERVIEW */}
          <motion.div variants={stagger} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OverviewCard icon={<Activity className="size-4" />} label="本期调用"
              value={summary?.total_calls ?? 0} sub={`近 ${days} 天累计`}
              tone="text-zinc-900 dark:text-white" loading={loadingSummary} animate />
            <OverviewCard icon={<CheckCircle2 className="size-4" />} label="成功率"
              value={`${successRate}%`} sub={`成功 ${summary?.success_calls ?? 0} 次`}
              tone="text-emerald-600 dark:text-emerald-400" loading={loadingSummary} />
            <OverviewCard icon={<Coins className="size-4" />} label="消耗令牌"
              value={summary?.total_tokens ?? 0} sub="下单时计费"
              tone="text-zinc-900 dark:text-white" loading={loadingSummary} animate />
            <OverviewCard icon={<AlertTriangle className="size-4" />} label="限流 (429)"
              value={summary?.rate_limited ?? 0} sub="被限流次数"
              tone="text-amber-600 dark:text-amber-400" loading={loadingSummary} animate />
          </motion.div>

          {/* PLACEHOLDER_CHARTS */}
          {/* 每日趋势：成功 vs 失败 */}
          <motion.div variants={fadeUp} className={`${CARD} p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <TrendingUp className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">每日调用趋势</p>
                  <p className="text-xs text-zinc-500 dark:text-white/50">成功与失败按日堆叠</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-white/50">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> 成功</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-400" /> 失败</span>
              </div>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary?.trend || []} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="okGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                  <RechartsTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                    labelStyle={{ fontWeight: 600, color: "var(--popover-foreground)" }} />
                  <Area type="monotone" dataKey="success" name="成功" stackId="1" stroke="#34d399" strokeWidth={2} fill="url(#okGrad)" animationDuration={700} />
                  <Area type="monotone" dataKey="failed" name="失败" stackId="1" stroke="#f87171" strokeWidth={2} fill="url(#failGrad)" animationDuration={700} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* 端点分布 + 按 Key 用量 */}
          <motion.div variants={fadeUp} className="grid md:grid-cols-2 gap-4">
            <div className={`${CARD} p-6 space-y-4`}>
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <Boxes className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">端点分布</p>
                  <p className="text-xs text-zinc-500 dark:text-white/50">各接口调用次数</p>
                </div>
              </div>
              {endpointBars.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-white/40">
                  <Boxes className="size-8 opacity-30" />
                  <span className="text-xs">暂无数据</span>
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={endpointBars} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                      <RechartsTooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                        formatter={(val: any) => [`${val} 次`, "调用"]} cursor={{ fill: "transparent" }} />
                      <Bar dataKey="calls" radius={[0, 4, 4, 0]} animationDuration={700}>
                        {endpointBars.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className={`${CARD} p-6 space-y-4`}>
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <KeyRound className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">按 Key 用量</p>
                  <p className="text-xs text-zinc-500 dark:text-white/50">各密钥调用与令牌消耗</p>
                </div>
              </div>
              {keyBars.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-white/40">
                  <KeyRound className="size-8 opacity-30" />
                  <span className="text-xs">暂无数据</span>
                </div>
              ) : (
                <div className="h-52 overflow-y-auto space-y-3 pr-1">
                  {keyBars.map((k: any, i: number) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 truncate max-w-[55%] text-zinc-700 dark:text-white/70">
                          <span className="size-2 rounded-full shrink-0" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
                          {k.name}
                        </span>
                        <span className="tabular-nums text-zinc-400 dark:text-white/40">{k.calls} 次 · {k.tokens} 令牌</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(k.calls / maxKeyCalls) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* PLACEHOLDER_TABLE */}
          <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 flex-wrap px-6 py-4 border-b border-zinc-900/[0.06] dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <ListFilter className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                    调用明细 <Badge variant="outline">{total}</Badge>
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-white/50">逐次调用记录</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={filterEndpoint} onValueChange={(v) => { setFilterEndpoint(v as string); setPage(1); }}>
                  <SelectTrigger className="h-9 rounded-xl text-xs bg-white/60 dark:bg-white/[0.03]">
                    <SelectValue placeholder="全部端点" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">全部端点</SelectItem>
                    {Object.keys(EP_LABEL).map(e => <SelectItem key={e} value={e}>{epLabel(e)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v as string); setPage(1); }}>
                  <SelectTrigger className="h-9 rounded-xl text-xs bg-white/60 dark:bg-white/[0.03]">
                    <SelectValue placeholder="全部状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">全部状态</SelectItem>
                    <SelectItem value="200">200 成功</SelectItem>
                    <SelectItem value="429">429 限流</SelectItem>
                    <SelectItem value="400">400 请求错误</SelectItem>
                    <SelectItem value="401">401 未授权</SelectItem>
                    <SelectItem value="500">500 服务错误</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingLogs ? (
              <div className="py-20 flex items-center justify-center text-zinc-400 dark:text-white/40">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <div className="size-14 rounded-2xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <Clock className="size-6 text-zinc-400 dark:text-white/40" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-white/55">暂无调用记录</p>
                <p className="text-xs text-zinc-400 dark:text-white/40">用 API Key 调用接口后，明细会显示在这里</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-400 dark:text-white/40 border-b border-zinc-900/[0.04] dark:border-white/[0.06]">
                      <th className="font-medium px-6 py-3">时间</th>
                      <th className="font-medium px-3 py-3">端点</th>
                      <th className="font-medium px-3 py-3">Key</th>
                      <th className="font-medium px-3 py-3 text-right">状态</th>
                      <th className="font-medium px-3 py-3 text-right">令牌</th>
                      <th className="font-medium px-6 py-3 text-right">耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l: any) => (
                      <tr key={l.id} className="border-b border-zinc-900/[0.03] dark:border-white/[0.04] last:border-0 hover:bg-zinc-900/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-3 tabular-nums text-zinc-500 dark:text-white/50 whitespace-nowrap">{l.created_at}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-zinc-700 dark:text-white/70">{epLabel(l.endpoint)}</span>
                        </td>
                        <td className="px-3 py-3 text-zinc-500 dark:text-white/50 truncate max-w-[120px]">{l.key_name}</td>
                        <td className={`px-3 py-3 text-right tabular-nums font-semibold ${statusTone(l.status_code)}`}>{l.status_code}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-600 dark:text-white/60">{l.tokens_cost || "—"}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-zinc-400 dark:text-white/40 whitespace-nowrap">{l.latency_ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3.5 border-t border-zinc-900/[0.06] dark:border-white/10">
                <span className="text-[11px] text-zinc-400 dark:text-white/40">第 {page} / {totalPages} 页</span>
                <div className="flex items-center gap-2">
                  <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3.5 py-1.5 rounded-lg text-xs border border-zinc-900/[0.06] dark:border-white/10 text-zinc-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-900/[0.03] dark:hover:bg-white/[0.04] transition-colors">上一页</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-3.5 py-1.5 rounded-lg text-xs border border-zinc-900/[0.06] dark:border-white/10 text-zinc-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-900/[0.03] dark:hover:bg-white/[0.04] transition-colors">下一页</button>
                </div>
              </div>
            )}
          </motion.div>

        </motion.div>
      </div>

      {/* 流体背景 keyframes：内联注入，保证不依赖访问顺序即可呈现动画（与主页一致） */}
      <style jsx global>{`
        @keyframes fluidA {
          0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
          25%  { transform: translate(28%, 18%) scale(1.25) rotate(8deg); }
          50%  { transform: translate(14%, 36%) scale(0.85) rotate(-6deg); }
          75%  { transform: translate(-18%, 16%) scale(1.15) rotate(5deg); }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes fluidB {
          0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
          25%  { transform: translate(-30%, 22%) scale(0.8) rotate(-10deg); }
          50%  { transform: translate(-12%, -20%) scale(1.3) rotate(7deg); }
          75%  { transform: translate(22%, -10%) scale(0.95) rotate(-4deg); }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes fluidC {
          0%   { transform: translate(0, 0) scale(1.05) rotate(0deg); }
          33%  { transform: translate(-26%, 30%) scale(0.78) rotate(9deg); }
          66%  { transform: translate(20%, 14%) scale(1.28) rotate(-8deg); }
          100% { transform: translate(0, 0) scale(1.05) rotate(0deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="fluid"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
