"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Trash2, Plus, Search, RefreshCw, RotateCw, Sparkles,
  Copy, Check, Key, Loader2, ChevronLeft, ChevronRight,
  X, Shield, Zap, AlertTriangle, Ban, CheckCircle, XCircle, Database, Activity, Users,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { api, getToken } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const rowFade = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.3 } } };

/* ── 类型 ─────────────────────────────────── */
interface Account {
  id: number; access_token: string; email: string; plan_type: string;
  status: string; quota: number; success: number; fail: number;
  restore_at?: string; created_at: string; active_slots?: number;
}
interface Stats {
  total: number; active: number; limited: number; abnormal: number; disabled: number;
  total_quota: number; total_success: number; total_fail: number; by_type: Record<string, number>;
}

const PAGE_SIZE = 15;
const STATUS_OPTS = ["正常", "限流", "异常", "禁用"] as const;

const STATUS_META: Record<string, { color: string; icon: typeof CheckCircle; bg: string }> = {
  "正常": { color: "#10b981", icon: CheckCircle, bg: "bg-emerald-500/10" },
  "限流": { color: "#f59e0b", icon: AlertTriangle, bg: "bg-amber-500/10" },
  "异常": { color: "#ef4444", icon: XCircle, bg: "bg-red-500/10" },
  "禁用": { color: "#71717a", icon: Ban, bg: "bg-muted" },
};

const PLAN_STYLE: Record<string, string> = {
  "plus": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "pro": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "team": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "free": "bg-muted text-muted-foreground",
};

/* ── 恢复倒计时 ─────────────────────────────── */
function RestoreTimer({ value }: { value?: string }) {
  const [tick, setTick] = useState(0);
  const totalRef = useRef(0);
  useEffect(() => {
    setTick(0);
    let total = 0;
    if (!value) { totalRef.current = 0; return; }
    if (/^\d+s$/.test(value)) { total = parseInt(value); }
    else {
      const d = new Date(value);
      if (!isNaN(d.getTime())) { total = Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000)); }
      else if (/^\d+$/.test(value)) { const ms = parseInt(value); total = ms > 1e15 ? 0 : Math.max(0, Math.floor((ms - Date.now()) / 1000)); }
    }
    totalRef.current = total;
    if (total <= 0) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [value]);
  if (!value) return <span className="text-muted-foreground">—</span>;
  const remaining = Math.max(0, totalRef.current - tick);
  if (remaining <= 0) return <span className="text-emerald-500 text-xs">已恢复</span>;
  const d = Math.floor(remaining / 86400), h = Math.floor((remaining % 86400) / 3600), m = Math.floor((remaining % 3600) / 60), s = remaining % 60;
  const parts = []; if (d > 0) parts.push(`${d}天`); if (h > 0) parts.push(`${h}时`); if (m > 0) parts.push(`${m}分`); parts.push(`${s}秒`);
  return <span className={`${mono.className} text-xs tabular-nums ${remaining < 300 ? "text-amber-500" : "text-muted-foreground"}`}>{parts.join("")}</span>;
}

/* ── 主页面 ─────────────────────────────────── */
export default function AdminPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [newTokens, setNewTokens] = useState("");
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sched, setSched] = useState<{ global_active: number; global_max: number; active_users: number } | null>(null);
  const [chartData, setChartData] = useState<{ t: string; slots: number; tasks: number }[]>([]);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const status = statusFilter === "all" ? "" : statusFilter;
      const [accRes, statsRes, schedRes] = await Promise.all([
        api<any>(`/api/accounts?search=${encodeURIComponent(search)}&status=${status}&page=${page}&page_size=${PAGE_SIZE}`),
        api<any>("/api/accounts/stats"),
        api<any>("/api/admin/scheduler/stats").catch(() => null),
      ]);
      const items = accRes.data.items || [];
      setAccounts(items); setTotal(accRes.data.total || 0); setStats(statsRes.data);
      // 采集实时并发/占用时序：号池总占用 = 当前页各账号 active_slots 之和；全局任务 = 调度器 global_active
      const slots = items.reduce((sum: number, a: Account) => sum + (a.active_slots ?? 0), 0);
      const sd = schedRes?.data || null;
      setSched(sd);
      const tasks = sd?.global_active ?? 0;
      setChartData(prev => {
        const next = [...prev, { t: new Date().toLocaleTimeString("zh-CN", { hour12: false }), slots, tasks }];
        return next.length > 30 ? next.slice(-30) : next; // 保留最近 30 个采样点
      });
    } catch (e: any) { if (e.message?.includes("401")) router.push("/login"); }
    if (!silent) setLoading(false);
  }, [search, statusFilter, page, router]);

  useEffect(() => { if (!getToken()) { router.push("/login"); return; } fetchData(); }, [fetchData, router]);

  // 静默轮询：每 5 秒刷新一次，实时反映各账号的并发占用数（不触发 loading 骨架，避免闪烁）
  useEffect(() => {
    const id = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const addAccounts = async () => {
    const tokens = newTokens.split(/[\n,]/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return; setAdding(true);
    try { const res = await api<any>("/api/accounts", { method: "POST", body: JSON.stringify({ tokens }) }); toast.success(`已添加 ${res.data.added} 个账号`); setNewTokens(""); setShowAdd(false); fetchData(); }
    catch (e: any) { toast.error(e.message); } setAdding(false);
  };
  const deleteSelected = async () => {
    try { const res = await api<any>("/api/accounts", { method: "DELETE", body: JSON.stringify({ ids: [...selected] }) }); toast.success(`已删除 ${res.data.removed} 个`); setSelected(new Set()); setShowDelete(false); fetchData(); }
    catch (e: any) { toast.error(e.message); }
  };
  const refreshSelected = async () => {
    const id = toast.loading(`正在刷新 ${selected.size} 个账号...`);
    try { const res = await api<any>("/api/accounts/refresh", { method: "POST", body: JSON.stringify({ ids: [...selected] }) }); toast.success(`已刷新 ${res.data.refreshed} 个`, { id }); fetchData(); }
    catch { toast.error("刷新失败", { id }); }
  };
  const refreshSingle = async (e: React.MouseEvent, accId: number) => {
    e.stopPropagation();
    const id = toast.loading("刷新中...");
    try { await api("/api/accounts/refresh", { method: "POST", body: JSON.stringify({ ids: [accId] }) }); toast.success("已刷新", { id }); fetchData(); }
    catch { toast.error("刷新失败", { id }); }
  };
  const copyToken = async (e: React.MouseEvent, token: string, accId: number) => {
    e.stopPropagation(); await navigator.clipboard.writeText(token); setCopiedId(accId); setTimeout(() => setCopiedId(null), 1800);
  };
  const toggle = (id: number) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => { selected.size === accounts.length ? setSelected(new Set()) : setSelected(new Set(accounts.map(a => a.id))); };

  const parsedTokens = useMemo(() => newTokens.split(/[\n,]/).map(t => t.trim()).filter(Boolean), [newTokens]);
  const statusCounts = useMemo(() => ({ 正常: stats?.active ?? 0, 限流: stats?.limited ?? 0, 异常: stats?.abnormal ?? 0, 禁用: stats?.disabled ?? 0 }), [stats]);

  if (loading && !stats) return (
    <div className="h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b bg-card px-4 sm:px-8 py-4 shrink-0"><Skeleton className="h-6 w-32" /></div>
        <div className="flex-1 p-4 sm:p-8 overflow-auto space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <Skeleton className="h-[400px] rounded-2xl" />
        </div>
      </main>
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-start sm:items-center justify-between shrink-0 gap-2">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>号池管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {stats ? `${stats.total} 个账号 · ${stats.active} 正常 · 配额 ${stats.total_quota}` : "加载中..."}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => fetchData()} disabled={loading} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-muted-foreground px-1.5 sm:px-2">
              <RefreshCw className={`size-3 sm:size-3.5 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2" onClick={async () => {
              const id = toast.loading("正在同步账号信息...");
              try { const res = await api<any>("/api/accounts/refresh", { method: "POST" }); toast.success(`已同步 ${res.data.refreshed}/${res.data.total}`, { id }); fetchData(); }
              catch { toast.error("同步失败", { id }); }
            }}>
              <RefreshCw className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">同步信息</span><span className="sm:hidden">同步</span>
            </Button>
            <Button size="sm" className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2" onClick={() => setShowAdd(true)}>
              <Plus className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">添加账号</span><span className="sm:hidden">添加</span>
            </Button>
          </div>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">

            {/* ═══ 统计卡片 ═══ */}
            <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
              {[
                { label: "总账号", value: stats?.total ?? 0, icon: Database, color: "text-foreground", bg: "bg-muted" },
                { label: "正常", value: stats?.active ?? 0, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "限流", value: stats?.limited ?? 0, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
                { label: "异常", value: stats?.abnormal ?? 0, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
                { label: "禁用", value: stats?.disabled ?? 0, icon: Ban, color: "text-muted-foreground", bg: "bg-muted" },
                { label: "总配额", value: stats?.total_quota ?? 0, icon: Zap, color: "text-primary", bg: "bg-primary/10" },
                { label: "成功数", value: stats?.total_success ?? 0, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/10" },
              ].map(item => (
                <div key={item.label} className="rounded-xl border bg-card p-3 sm:p-3.5 hover:shadow-sm transition-shadow">
                  <div className={`size-7 sm:size-8 rounded-lg ${item.bg} flex items-center justify-center mb-1.5 sm:mb-2`}>
                    <item.icon className={`size-3.5 sm:size-4 ${item.color}`} />
                  </div>
                  <p className={`${mono.className} text-base sm:text-lg font-medium tabular-nums`}>{item.value.toLocaleString()}</p>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                </div>
              ))}
            </motion.div>

            {/* ═══ 实时并发 / 占用图表 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b gap-3">
                <div className="flex items-center gap-2">
                  <div className="size-7 sm:size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Activity className="size-3.5 sm:size-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className={`${heading.className} text-xs sm:text-sm font-semibold`}>实时并发监控</p>
                    <p className="text-[9px] sm:text-[10px] text-muted-foreground">每 5 秒采样 · 号池占用与全局任务</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-4">
                  {[
                    { label: "号池占用", value: chartData.length ? chartData[chartData.length - 1].slots : 0, color: "text-emerald-500", icon: Zap },
                    { label: "全局任务", value: sched?.global_active ?? 0, sub: sched ? `/ ${sched.global_max}` : "", color: "text-blue-500", icon: Activity },
                    { label: "活跃用户", value: sched?.active_users ?? 0, color: "text-violet-500", icon: Users },
                  ].map(m => (
                    <div key={m.label} className="text-right">
                      <p className={`${mono.className} text-base sm:text-lg font-bold tabular-nums ${m.color}`}>
                        {m.value}<span className="text-[9px] sm:text-[10px] text-muted-foreground font-normal ml-0.5">{m.sub || ""}</span>
                      </p>
                      <p className="text-[9px] sm:text-[10px] text-muted-foreground inline-flex items-center gap-1"><m.icon className="size-2 sm:size-2.5" />{m.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="h-[180px] p-4 pt-5">
                {chartData.length < 2 ? (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    <RefreshCw className="size-3.5 animate-spin mr-2" /> 采集中…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gSlots" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gTasks" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                      <XAxis dataKey="t" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))" }}
                        labelStyle={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}
                        formatter={(v: any, name: any) => [v, name === "slots" ? "号池占用" : "全局任务"]} />
                      <Area type="monotone" dataKey="tasks" stroke="#3b82f6" strokeWidth={1.5} fill="url(#gTasks)" name="tasks" isAnimationActive={false} />
                      <Area type="monotone" dataKey="slots" stroke="#10b981" strokeWidth={2} fill="url(#gSlots)" name="slots" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </motion.div>
            <motion.div variants={fadeUp} className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="搜索邮箱或 Token..." className="pl-9 pr-8 text-xs" />
                {search && (
                  <button onClick={() => { setSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 overflow-x-auto flex-nowrap">
                <button onClick={() => { setStatusFilter("all"); setPage(1); }}
                  className={`px-2 sm:px-2.5 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${statusFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                  全部 {stats?.total ?? 0}
                </button>
                {STATUS_OPTS.map(s => {
                  const meta = STATUS_META[s];
                  return (
                    <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                      className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                        statusFilter === s ? `${meta.bg} font-semibold` : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`} style={statusFilter === s ? { color: meta.color } : undefined}>
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                      {s} {statusCounts[s]}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1" />

              <AnimatePresence>
                {selected.size > 0 && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-2">
                    <Badge variant="secondary">{selected.size} 已选</Badge>
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={refreshSelected}>
                      <RotateCw className="size-3" /> 刷新
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-1 text-xs" onClick={() => setShowDelete(true)}>
                      <Trash2 className="size-3" /> 删除
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* ═══ 表格 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="w-10 pl-4 py-3"><Checkbox checked={accounts.length > 0 && selected.size === accounts.length} onCheckedChange={toggleAll} /></th>
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">邮箱 · Token</th>
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">类型</th>
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">状态</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">占用</th>
                      <th className="text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3 pr-4">配额</th>
                      <th className="text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3 pr-4">成功率</th>
                      <th className="text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3 pr-4">重置时间</th>
                      <th className="w-10 pr-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? [...Array(5)].map((_, i) => (
                      <tr key={i}><td className="pl-4 py-3"><Skeleton className="h-4 w-4 rounded" /></td><td className="py-3"><Skeleton className="h-8 w-48" /></td><td className="py-3"><Skeleton className="h-5 w-14 rounded-md" /></td><td className="py-3"><Skeleton className="h-5 w-12 rounded-full" /></td><td className="py-3"><Skeleton className="h-4 w-6 mx-auto" /></td><td className="py-3 pr-4"><Skeleton className="h-4 w-8 ml-auto" /></td><td className="py-3 pr-4"><Skeleton className="h-4 w-16 ml-auto" /></td><td className="py-3 pr-4"><Skeleton className="h-4 w-16 ml-auto" /></td><td className="pr-4 py-3" /></tr>
                    )) : accounts.length === 0 ? (
                      <tr><td colSpan={9} className="h-40 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="size-12 rounded-2xl bg-muted flex items-center justify-center"><Sparkles className="size-5 text-muted-foreground/50" /></div>
                          <p className="text-sm text-muted-foreground">{search || statusFilter !== "all" ? "没有匹配的账号" : "暂无账号，点击「添加账号」导入"}</p>
                        </div>
                      </td></tr>
                    ) : accounts.map((a, i) => {
                      const meta = STATUS_META[a.status] || STATUS_META["禁用"];
                      const successRate = a.success + a.fail > 0 ? Math.round((a.success / (a.success + a.fail)) * 100) : 0;
                      return (
                        <motion.tr key={a.id} variants={rowFade} custom={i}
                          onClick={() => toggle(a.id)}
                          className={`group cursor-pointer transition-colors ${
                            a.status === "限流" ? "animate-limited-pulse" : selected.has(a.id) ? "bg-primary/5" : "hover:bg-muted/40"
                          }`}>
                          <td className="pl-4 py-3" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`size-8 rounded-lg ${meta.bg} flex items-center justify-center shrink-0`}>
                                {a.email ? <span className="text-[10px] font-bold uppercase" style={{ color: meta.color }}>{a.email[0]}</span> : <Key className="size-3.5" style={{ color: meta.color }} />}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate max-w-[180px]">{a.email || <span className="text-muted-foreground">未绑定邮箱</span>}</p>
                                <button onClick={e => { e.stopPropagation(); copyToken(e, a.access_token, a.id); }}
                                  className={`${mono.className} inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mt-0.5 transition-colors`}>
                                  <span>{a.access_token.slice(0, 8)}...{a.access_token.slice(-6)}</span>
                                  {copiedId === a.id ? <Check className="size-2.5 text-emerald-500" /> : <Copy className="size-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium ${PLAN_STYLE[a.plan_type.toLowerCase()] || PLAN_STYLE.free}`}>
                              {a.plan_type || "free"}
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.bg}`} style={{ color: meta.color }}>
                              <span className="size-1.5 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
                              {a.status}
                            </span>
                          </td>
                          <td className="text-center py-3">
                            {(a.active_slots ?? 0) > 0 ? (
                              <span className={`${mono.className} inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`}>
                                <span className="relative flex size-1.5">
                                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                                </span>
                                {a.active_slots}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/30 text-xs">—</span>
                            )}
                          </td>
                          <td className="text-right py-3 pr-4">
                            <span className={`${mono.className} text-sm font-medium tabular-nums`}>{a.quota.toLocaleString()}</span>
                          </td>
                          <td className="text-right py-3 pr-4">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${successRate}%`, backgroundColor: successRate >= 80 ? "#10b981" : successRate >= 50 ? "#f59e0b" : "#ef4444" }} />
                              </div>
                              <span className={`${mono.className} text-[11px] tabular-nums text-muted-foreground w-8 text-right`}>{successRate}%</span>
                            </div>
                          </td>
                          <td className="text-right py-3 pr-4"><RestoreTimer value={a.restore_at} /></td>
                          <td className="pr-4 py-3">
                            <button onClick={e => refreshSingle(e, a.id)}
                              className="size-7 rounded-lg flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all">
                              <RotateCw className="size-3.5" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>

            {/* ═══ 分页 ═══ */}
            {totalPages > 1 && (
              <motion.div variants={fadeUp} className="flex items-center justify-between px-1">
                <span className={`${mono.className} text-[11px] text-muted-foreground tabular-nums`}>共 {total} 个 · {page}/{totalPages} 页</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft /></Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let num: number;
                    if (totalPages <= 5) num = i + 1;
                    else if (page <= 3) num = i + 1;
                    else if (page >= totalPages - 2) num = totalPages - 4 + i;
                    else num = page - 2 + i;
                    return (
                      <button key={num} onClick={() => setPage(num)}
                        className={`size-7 rounded-lg text-xs font-medium tabular-nums transition-all ${
                          page === num ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}>{num}</button>
                    );
                  })}
                  <Button variant="ghost" size="icon-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight /></Button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>

      {/* ═══ 添加弹窗 ═══ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加账号</DialogTitle>
            <DialogDescription>粘贴 access_token，每行一个或用逗号分隔</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea value={newTokens} onChange={e => setNewTokens(e.target.value)}
              placeholder="eyJhbGciOiJSUzI1NiIs..." rows={6}
              className={`${mono.className} w-full min-h-[120px] rounded-xl border bg-muted/30 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none`} autoFocus />
            {parsedTokens.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">
                  识别到 <span className="text-primary font-bold">{parsedTokens.length}</span> 个 Token
                </p>
                <div className="max-h-[100px] overflow-y-auto space-y-1">
                  {parsedTokens.slice(0, 10).map((t, i) => (
                    <div key={i} className={`${mono.className} flex items-center gap-2 text-[10px] text-muted-foreground`}>
                      <span className="tabular-nums w-5">{i + 1}.</span>
                      <span className="truncate">{t.slice(0, 24)}...</span>
                    </div>
                  ))}
                  {parsedTokens.length > 10 && <p className="text-[10px] text-muted-foreground/60 pl-7">...还有 {parsedTokens.length - 10} 个</p>}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setNewTokens(""); }}>取消</Button>
            <Button onClick={addAccounts} disabled={!newTokens.trim() || adding}>
              {adding && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              导入{parsedTokens.length > 0 ? ` ${parsedTokens.length} 个` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={showDelete} onOpenChange={setShowDelete}
        title="确认删除" description={`即将删除 ${selected.size} 个账号，此操作不可撤销。`}
        confirmLabel="确认删除" variant="destructive" onConfirm={deleteSelected} />
    </div>
  );
}
