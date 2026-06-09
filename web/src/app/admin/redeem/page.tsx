"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Plus, Copy, Check, Gift, Package, Ban, Eye, Ticket,
  CheckCircle, XCircle, AlertCircle, RefreshCw,
  Calendar, Clock, TicketCheck, Search,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { formatTime } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const cardPop = { hidden: { opacity: 0, y: 14, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── 状态判断 ─────────────────────────────── */
function getStatus(rc: any) {
  if (!rc.status) return { color: "#71717a", bg: "bg-muted", label: "已禁用", icon: Ban };
  if (rc.use_count >= rc.max_uses) return { color: "#f59e0b", bg: "bg-amber-500/10", label: "已用完", icon: XCircle };
  if (rc.expires_at && new Date(rc.expires_at) < new Date()) return { color: "#ef4444", bg: "bg-red-500/10", label: "已过期", icon: AlertCircle };
  return { color: "#10b981", bg: "bg-emerald-500/10", label: "可用", icon: CheckCircle };
}

/* ── 兑换码券票卡 ─────────────────────────── */
function RedeemCard({ rc, onCopy, onDisable, onLogs, copied }: any) {
  const st = getStatus(rc);
  const valid = st.label === "可用";
  const isPlan = rc.type === "plan";
  const Icon = isPlan ? Package : Gift;
  // 套餐=紫色系，积分=琥珀系，作为彩票主题色
  const theme = isPlan
    ? { grad: "linear-gradient(135deg,#7c3aed,#a855f7)", chip: "text-violet-50", glow: "rgba(168,85,247,0.25)" }
    : { grad: "linear-gradient(135deg,#d97706,#f59e0b)", chip: "text-amber-50", glow: "rgba(245,158,11,0.25)" };

  return (
    <motion.div variants={cardPop}
      className={`group relative transition-all duration-300 ${valid ? "hover:-translate-y-1" : "opacity-50 grayscale-[50%]"}`}>
      {/* 彩票外壳：上彩头 + 下票根，中间虚线撕裂缝 + 两侧半圆缺口 */}
      <div className="relative rounded-2xl overflow-hidden shadow-sm group-hover:shadow-xl transition-shadow"
        style={valid ? { boxShadow: `0 8px 30px -12px ${theme.glow}` } : undefined}>

        {/* ── 顶部彩头区 ── */}
        <div className="relative px-4 pt-3.5 pb-4 text-white" style={{ background: theme.grad }}>
          {/* 斜纹光泽 */}
          <div className="pointer-events-none absolute inset-0 opacity-20"
            style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 9px)" }} />
          <div className="relative flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Icon className="size-3.5" />
              <span className="text-[11px] font-semibold tracking-wide">{isPlan ? "套餐兑换券" : "积分兑换券"}</span>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} /> {st.label}
            </span>
          </div>
          {/* 中奖内容（大字突出，像彩票面额） */}
          <div className="relative flex items-baseline gap-1">
            {isPlan ? (
              <>
                <span className={`${heading.className} text-xl font-extrabold tracking-tight truncate`}>{rc.plan_name || `套餐 #${rc.plan_id}`}</span>
                {rc.plan_duration_days > 0 && <span className={`${mono.className} text-sm font-semibold text-white/80 shrink-0`}>{rc.plan_duration_days}天</span>}
              </>
            ) : (
              <>
                <span className={`${heading.className} text-3xl font-extrabold tabular-nums tracking-tight`}>{rc.points}</span>
                <span className="text-sm font-semibold text-white/80">积分</span>
              </>
            )}
          </div>
        </div>

        {/* ── 撕裂缝：两侧半圆缺口 + 虚线 ── */}
        <div className="relative h-0">
          <div className="absolute -left-2 -top-2 size-4 rounded-full bg-background" />
          <div className="absolute -right-2 -top-2 size-4 rounded-full bg-background" />
          <div className="absolute inset-x-3 -top-px border-t-2 border-dashed border-border" />
        </div>

        {/* ── 票根区（刮开窗：兑换码 + 元信息） ── */}
        <div className="bg-card border border-t-0 border-border rounded-b-2xl px-4 pt-4 pb-3.5">
          {/* 刮刮码窗口 */}
          <div className="relative rounded-lg px-3 py-2.5 mb-3 overflow-hidden flex items-center justify-between gap-2"
            style={{ background: "linear-gradient(135deg,#3f3f46,#52525b 50%,#3f3f46)" }}>
            <div className="pointer-events-none absolute inset-0 opacity-30"
              style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 4px)" }} />
            <span className={`${mono.className} relative text-sm font-semibold tracking-[0.12em] text-zinc-100 break-all`}>{rc.code}</span>
            <button onClick={() => onCopy(rc.code)}
              className="relative size-6 shrink-0 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-all">
              {copied === rc.code ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </button>
          </div>

          {/* 元信息 */}
          <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground mb-3">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1"><TicketCheck className="size-3" /> 已用</span>
              <span className={`${mono.className} text-foreground font-medium`}>{rc.use_count}/{rc.max_uses}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1"><Calendar className="size-3" /> 有效期</span>
              <span className={`${mono.className} text-foreground font-medium`}>{rc.expires_at ? rc.expires_at.slice(5, 10) : "永久"}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1"><Clock className="size-3" /> 创建</span>
              <span className={`${mono.className} text-foreground font-medium`}>{rc.created_at?.slice(5, 10) || "—"}</span>
            </div>
          </div>

          {/* 底部操作 */}
          <div className="flex items-center justify-between pt-2.5 border-t border-dashed border-border">
            <span className={`${mono.className} text-[10px] text-muted-foreground/50`}>NO.{String(rc.id).padStart(4, "0")}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onLogs(rc)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-muted">
                <Eye className="size-3" /> 记录
              </button>
              {valid && (
                <button onClick={() => onDisable(rc)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-destructive/10">
                  <Ban className="size-3" /> 禁用
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function RedeemPage() {
  const [codes, setCodes] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [showGen, setShowGen] = useState(false);
  const [genType, setGenType] = useState<"plan" | "points">("plan");
  const [genPlanID, setGenPlanID] = useState(0);
  const [genPlanDays, setGenPlanDays] = useState(0);
  const [genPoints, setGenPoints] = useState(100);
  const [genCount, setGenCount] = useState(1);
  const [genMaxUses, setGenMaxUses] = useState(1);
  const [genExpiry, setGenExpiry] = useState(0);
  const [genResult, setGenResult] = useState<any>(null);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [disableTarget, setDisableTarget] = useState<any>(null);
  const [disabling, setDisabling] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "used" | "expired" | "disabled">("all");

  useEffect(() => {
    Promise.all([api("/api/admin/redeem"), api("/api/admin/plans")]).then(([r1, r2]) => {
      setCodes(r1.data?.items || []);
      setPlans((r2.data || []).filter((p: any) => p.enabled));
      setLoading(false);
    });
  }, []);

  const refresh = async () => { const r = await api("/api/admin/redeem"); setCodes(r.data?.items || []); };

  const generate = async () => {
    if (genType === "plan" && genPlanID <= 0) { toast.error("请选择套餐"); return; }
    if (genType === "points" && genPoints <= 0) { toast.error("积分必须大于 0"); return; }
    setGenerating(true);
    try {
      const body: any = { count: genCount, type: genType, max_uses: genMaxUses, expires_in_hours: genExpiry };
      if (genType === "plan") { body.plan_id = genPlanID; body.plan_duration_days = genPlanDays; } else { body.points = genPoints; }
      const r = await api("/api/admin/redeem/generate", { method: "POST", body: JSON.stringify(body) });
      setGenResult(r.data); refresh(); toast.success(`成功生成 ${r.data?.count} 个兑换码`);
    } catch (e: any) { toast.error(e.message); }
    setGenerating(false);
  };
  const disableCode = async () => {
    if (!disableTarget) return; setDisabling(true);
    try { await api("/api/admin/redeem", { method: "DELETE", body: JSON.stringify({ id: disableTarget.id }) }); toast.success("已禁用"); setDisableTarget(null); refresh(); }
    catch (e: any) { toast.error(e.message); } setDisabling(false);
  };
  const viewLogs = async (code: any) => {
    setLogsTarget(code); setLogsOpen(true); setLogsLoading(true);
    try { const r = await api(`/api/admin/redeem/logs?code_id=${code.id}`); setLogs(r.data?.items || []); } catch {}
    setLogsLoading(false);
  };
  const copyCode = (code: string) => { navigator.clipboard.writeText(code); setCopiedCode(code); setTimeout(() => setCopiedCode(null), 1500); };

  const stats = useMemo(() => {
    let active = 0, used = 0, expired = 0, disabled = 0;
    for (const c of codes) {
      const s = getStatus(c);
      if (s.label === "可用") active++;
      else if (s.label === "已用完") used++;
      else if (s.label === "已过期") expired++;
      else disabled++;
    }
    return { total: codes.length, active, used, expired, disabled };
  }, [codes]);

  // 状态筛选 + 搜索（按兑换码文本）
  const filtered = useMemo(() => {
    return codes.filter(c => {
      const label = getStatus(c).label;
      const matchStatus = statusFilter === "all"
        || (statusFilter === "active" && label === "可用")
        || (statusFilter === "used" && label === "已用完")
        || (statusFilter === "expired" && label === "已过期")
        || (statusFilter === "disabled" && label === "已禁用");
      const matchSearch = !search || (c.code || "").toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [codes, statusFilter, search]);

  const STATUS_TABS = [
    { key: "all" as const, label: "全部", count: stats.total },
    { key: "active" as const, label: "可用", count: stats.active },
    { key: "used" as const, label: "已用完", count: stats.used },
    { key: "expired" as const, label: "已过期", count: stats.expired },
    { key: "disabled" as const, label: "已禁用", count: stats.disabled },
  ];

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>兑换码管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{codes.length} 个兑换码</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={refresh} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-muted-foreground px-1.5 sm:px-2">
              <RefreshCw className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={() => { setGenResult(null); setShowGen(true); }} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <Plus className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">生成兑换码</span><span className="sm:hidden">生成</span>
            </Button>
          </div>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">

            {/* ═══ 统计卡 ═══ */}
            <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
              {[
                { label: "总计", value: stats.total, icon: Ticket, color: "text-foreground", bg: "bg-muted" },
                { label: "可用", value: stats.active, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "已用完", value: stats.used, icon: XCircle, color: "text-amber-500", bg: "bg-amber-500/10" },
                { label: "已过期", value: stats.expired, icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10" },
                { label: "已禁用", value: stats.disabled, icon: Ban, color: "text-muted-foreground", bg: "bg-muted" },
              ].map(item => (
                <div key={item.label} className="rounded-xl border bg-card p-3 sm:p-3.5 hover:shadow-sm transition-shadow">
                  <div className={`size-7 sm:size-8 rounded-lg ${item.bg} flex items-center justify-center mb-1.5 sm:mb-2`}>
                    <item.icon className={`size-3.5 sm:size-4 ${item.color}`} />
                  </div>
                  <p className={`${mono.className} text-base sm:text-lg font-medium tabular-nums`}>{item.value}</p>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                </div>
              ))}
            </motion.div>

            {/* ═══ 筛选 + 搜索 ═══ */}
            {codes.length > 0 && (
              <motion.div variants={fadeUp} className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                  {STATUS_TABS.map(tab => (
                    <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                        statusFilter === tab.key ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}>
                      {tab.label}<span className={`${mono.className} text-[10px] tabular-nums ${statusFilter === tab.key ? "opacity-70" : "opacity-50"}`}>{tab.count}</span>
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索兑换码…" className="w-44 sm:w-56 pl-8 h-9 text-xs" />
                </div>
              </motion.div>
            )}

            {/* ═══ 卡片网格 ═══ */}
            {codes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28">
                <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <Ticket className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">暂无兑换码</p>
                <p className="text-xs text-muted-foreground/70 mt-1">点击右上角「生成兑换码」创建</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28">
                <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <Search className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">无匹配兑换码</p>
                <p className="text-xs text-muted-foreground/70 mt-1">尝试修改搜索或筛选条件</p>
              </div>
            ) : (
              <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map(rc => (
                  <RedeemCard key={rc.id} rc={rc} copied={copiedCode}
                    onCopy={copyCode} onDisable={setDisableTarget} onLogs={viewLogs} />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>

      {/* ═══ 生成弹窗 ═══ */}
      <Dialog open={showGen} onOpenChange={setShowGen}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-sm sm:text-base font-semibold`}>{genResult ? "生成完成" : "生成兑换码"}</DialogTitle>
            <DialogDescription className="sr-only">批量生成套餐或积分兑换码</DialogDescription>
          </DialogHeader>

          {genResult ? (
            <div className="space-y-3 mt-1">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center text-sm text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center gap-1.5 w-full">
                <CheckCircle className="size-4" /> 成功生成 {genResult.count} 个兑换码
              </div>
              <div className="space-y-1.5 max-h-52 overflow-auto scrollbar-thin">
                {genResult.codes.map((c: string, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <code className={`${mono.className} text-sm font-medium tracking-wider`}>{c}</code>
                    <button onClick={() => copyCode(c)} className="p-1 rounded hover:bg-muted transition-colors">
                      {copiedCode === c ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setShowGen(false); setGenResult(null); }}>关闭</Button>
            </div>
          ) : (
            <div className="space-y-4 mt-1">
              {/* 类型切换 */}
              <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg">
                {([{ v: "plan" as const, l: "套餐" }, { v: "points" as const, l: "积分" }]).map(t => (
                  <button key={t.v} type="button" onClick={() => setGenType(t.v)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${genType === t.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                    {t.l}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {genType === "plan" ? (
                  <motion.div key="plan" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
                    className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">选择套餐</label>
                      <select value={genPlanID} onChange={e => setGenPlanID(+e.target.value)}
                        className="w-full h-8 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                        <option value={0}>请选择</option>
                        {plans.map(p => <option key={p.id} value={p.id}>{p.name} — ¥{p.price_monthly}/月</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">有效期天数</label>
                      <Input type="number" min={0} value={genPlanDays} onChange={e => setGenPlanDays(+e.target.value)} className={`${mono.className} text-sm`} />
                      <p className="text-[10px] text-muted-foreground">0 = 跟随套餐默认</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">可用次数</label>
                      <Input type="number" min={1} value={genMaxUses} onChange={e => setGenMaxUses(+e.target.value)} className={`${mono.className} text-sm`} />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="points" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
                    className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">积分数额</label>
                      <Input type="number" min={1} value={genPoints} onChange={e => setGenPoints(+e.target.value)} className={`${mono.className} text-sm`} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">可用次数</label>
                      <Input type="number" min={1} value={genMaxUses} onChange={e => setGenMaxUses(+e.target.value)} className={`${mono.className} text-sm`} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">生成数量</label>
                  <Input type="number" min={1} max={100} value={genCount} onChange={e => setGenCount(+e.target.value)} className={`${mono.className} text-sm`} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">过期（小时，0=永不）</label>
                  <Input type="number" min={0} value={genExpiry} onChange={e => setGenExpiry(+e.target.value)} className={`${mono.className} text-sm`} />
                </div>
              </div>

              <Button onClick={generate} disabled={generating} className="w-full gap-1.5">
                {generating ? <div className="size-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <Plus className="size-3.5" />}
                生成
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ 使用记录弹窗 ═══ */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-sm sm:text-base font-semibold`}>使用记录</DialogTitle>
            <DialogDescription className="sr-only">查看该兑换码的使用历史</DialogDescription>
          </DialogHeader>
          {logsTarget && <code className={`${mono.className} block text-sm font-medium bg-muted/50 rounded-lg px-3 py-2 mb-3 tracking-wider`}>{logsTarget.code}</code>}
          {logsLoading ? (
            <div className="flex items-center justify-center py-8"><RefreshCw className="size-4 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">暂无使用记录</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-auto scrollbar-thin">
              {logs.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <div className="text-sm font-medium">{l.user_email || `用户 #${l.user_id}`}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{l.value}</div>
                  </div>
                  <span className={`${mono.className} text-[11px] text-muted-foreground shrink-0 tabular-nums`}>{formatTime(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ 禁用确认 ═══ */}
      <ConfirmDialog open={!!disableTarget} onOpenChange={() => setDisableTarget(null)}
        title="禁用兑换码" description={`确定要禁用「${disableTarget?.code}」？禁用后用户将无法使用此兑换码。`}
        confirmLabel="禁用" variant="destructive" loading={disabling} onConfirm={disableCode} />
    </div>
  );
}
