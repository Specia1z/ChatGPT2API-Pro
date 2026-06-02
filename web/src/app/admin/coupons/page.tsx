"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Plus, Trash2, Tag, Copy, Check, Percent, DollarSign, Calendar, Search, Clock, TicketCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const cardPop = { hidden: { opacity: 0, y: 14, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

const STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  active:   { color: "#10b981", bg: "bg-emerald-500/10", label: "有效" },
  expired:  { color: "#ef4444", bg: "bg-red-500/10", label: "已过期" },
  used_up:  { color: "#f59e0b", bg: "bg-amber-500/10", label: "已用完" },
  disabled: { color: "#71717a", bg: "bg-muted", label: "已禁用" },
};

/* ── 券票卡 ─────────────────────────────────── */
function CouponCard({ c, onCopy, onDisable, copied }: any) {
  const now = Date.now();
  const expired = c.expires_at && new Date(c.expires_at).getTime() < now;
  const usedUp = c.max_uses > 0 && c.use_count >= c.max_uses;
  const valid = c.status && !expired && !usedUp;
  const isPercent = c.discount_type === "percent";
  const Icon = isPercent ? Percent : DollarSign;
  const accent = isPercent ? { color: "text-violet-500", bg: "bg-violet-500/10" } : { color: "text-emerald-500", bg: "bg-emerald-500/10" };
  const statusKey = !c.status ? "disabled" : expired ? "expired" : usedUp ? "used_up" : "active";
  const st = STATUS_META[statusKey];

  return (
    <motion.div variants={cardPop}
      className={`group relative rounded-2xl border bg-card overflow-hidden transition-all duration-300 ${
        valid ? "hover:shadow-lg hover:-translate-y-0.5" : "opacity-50 grayscale-[40%]"
      }`}>
      {/* 券票打孔装饰条 */}
      <div className="flex gap-1 px-3 pt-3">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full bg-muted" />
        ))}
      </div>

      <div className="p-5 pt-3">
        {/* 类型 + 状态 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`size-8 rounded-xl ${accent.bg} flex items-center justify-center`}>
              <Icon className={`size-4 ${accent.color}`} />
            </div>
            <span className="text-xs font-medium text-muted-foreground">{isPercent ? "百分比折扣" : "固定折扣"}</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${st.bg}`} style={{ color: st.color }}>
            <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} /> {st.label}
          </span>
        </div>

        {/* 优惠码 */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`${mono.className} text-lg font-medium tracking-[0.12em]`}>{c.code}</span>
          <button onClick={() => onCopy(c.code)}
            className="size-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all opacity-0 group-hover:opacity-100">
            {copied === c.code ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </button>
        </div>

        {/* 折扣值 */}
        <div className="flex items-baseline gap-0.5 mb-4">
          {!isPercent && <span className="text-base font-medium text-muted-foreground">¥</span>}
          <span className={`${heading.className} text-3xl font-extrabold tabular-nums tracking-tight`}>{c.discount_value}</span>
          {isPercent && <span className="text-base font-medium text-muted-foreground">%</span>}
        </div>

        {/* 元信息 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <TicketCheck className="size-3" />
            <span>已用 <strong className="text-foreground font-medium">{c.use_count}</strong>/{c.max_uses}</span>
          </div>
          {c.min_amount > 0 && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="size-3" /><span>满 <strong className="text-foreground font-medium">¥{c.min_amount}</strong></span>
            </div>
          )}
          {c.expires_at && (
            <div className="flex items-center gap-1.5">
              <Calendar className="size-3" /><span>到期 <strong className="text-foreground font-medium">{c.expires_at.slice(0, 10)}</strong></span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Clock className="size-3" /><span>创建 {c.created_at?.slice(0, 10) || "—"}</span>
          </div>
        </div>

        {/* 底部 */}
        <div className="mt-5 pt-3 border-t flex items-center justify-between">
          <span className={`${mono.className} text-[10px] text-muted-foreground/50`}>ID {c.id}</span>
          {valid && (
            <button onClick={() => onDisable(c)}
              className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-destructive/10">
              <Trash2 className="size-3" /> 禁用
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function CouponsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [form, setForm] = useState({
    code: "", discount_type: "percent" as string, discount_value: 10,
    min_amount: 0, max_uses: 1, expires_in_hours: 0,
  });

  useEffect(() => { fetchList(); }, []);
  const fetchList = async () => { try { const r = await api("/api/admin/coupons"); setList(r.data || []); } catch {} finally { setLoading(false); } };

  const generateCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 12; i++) { code += chars[Math.floor(Math.random() * chars.length)]; if (i % 4 === 3 && i < 11) code += "-"; }
    setForm({ ...form, code });
  };

  const create = async () => {
    if (!form.code || form.discount_value <= 0) { toast.error("请完善信息"); return; }
    if (form.discount_type === "percent" && form.discount_value > 100) { toast.error("百分比不能超过 100"); return; }
    if (form.discount_type === "fixed" && form.discount_value > 99999) { toast.error("金额不能超过 99999"); return; }
    try {
      const body: any = { ...form };
      if (body.expires_in_hours > 0) {
        const expiresAt = new Date(Date.now() + body.expires_in_hours * 3600000);
        body.expires_at = expiresAt.toISOString().slice(0, 19).replace("T", " ");
      }
      delete body.expires_in_hours;
      await api("/api/admin/coupons", { method: "POST", body: JSON.stringify(body) });
      toast.success("优惠码已创建"); setCreateOpen(false); fetchList();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try { await api("/api/admin/coupons", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) }); toast.success("已禁用"); setDeleteTarget(null); fetchList(); }
    catch (e: any) { toast.error(e.message); }
  };

  const copyCode = (code: string) => { navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); };

  const now = Date.now();
  const withStatus = list.map((c: any) => {
    const expired = c.expires_at && new Date(c.expires_at).getTime() < now;
    const usedUp = c.max_uses > 0 && c.use_count >= c.max_uses;
    return { ...c, _status: !c.status ? "disabled" : expired ? "expired" : usedUp ? "used_up" : "active" };
  });

  const filtered = withStatus.filter((c: any) => {
    if (search && !c.code.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && c._status !== statusFilter) return false;
    return true;
  });

  const stats = {
    total: list.length,
    active: withStatus.filter((c: any) => c._status === "active").length,
    used: withStatus.reduce((s: number, c: any) => s + c.use_count, 0),
  };

  const STATUS_TABS = [
    { key: "all", label: "全部", count: list.length },
    { key: "active", label: "有效", count: stats.active },
    { key: "expired", label: "已过期", count: withStatus.filter((c: any) => c._status === "expired").length },
    { key: "disabled", label: "已禁用", count: withStatus.filter((c: any) => c._status === "disabled").length },
  ];

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-base font-semibold tracking-tight`}>优惠码</h1>
            <p className="text-xs text-muted-foreground mt-0.5">共 {stats.total} 个 · {stats.active} 个有效 · 累计使用 {stats.used} 次</p>
          </div>
          <Button size="sm" onClick={() => { generateCode(); setCreateOpen(true); }} className="gap-1.5 text-xs">
            <Plus className="size-3.5" /> 新建优惠码
          </Button>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-6 lg:p-8 space-y-6">

            {/* ═══ 概览卡 ═══ */}
            <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "优惠码总数", value: stats.total, icon: Tag, color: "text-primary", bg: "bg-primary/10" },
                { label: "有效优惠码", value: stats.active, icon: TicketCheck, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "累计使用", value: stats.used, icon: Check, color: "text-blue-500", bg: "bg-blue-500/10" },
              ].map(item => (
                <div key={item.label} className="rounded-2xl border bg-card p-5 flex items-center gap-4 hover:shadow-sm transition-shadow">
                  <div className={`size-11 rounded-xl ${item.bg} flex items-center justify-center shrink-0`}>
                    <item.icon className={`size-5 ${item.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className={`${mono.className} text-xl font-medium tabular-nums mt-0.5`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* ═══ 筛选 + 搜索 ═══ */}
            <motion.div variants={fadeUp} className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-1">
                {STATUS_TABS.map(tab => (
                  <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      statusFilter === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}>
                    {tab.label}
                    <span className={`ml-1.5 tabular-nums ${statusFilter === tab.key ? "opacity-80" : "text-muted-foreground/60"}`}>{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="relative w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索优惠码..." className="pl-9 text-xs" />
              </div>
            </motion.div>

            {/* ═══ 券票网格 ═══ */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28">
                <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Tag className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium">{search || statusFilter !== "all" ? "无匹配优惠码" : "暂无优惠码"}</p>
                <p className="text-xs text-muted-foreground mt-1">{search || statusFilter !== "all" ? "尝试修改搜索条件" : "点击右上角创建第一个优惠码"}</p>
              </div>
            ) : (
              <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((c: any) => (
                  <CouponCard key={c.id} c={c} onCopy={copyCode} onDisable={setDeleteTarget} copied={copied} />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>

      {/* ═══ 创建弹窗 ═══ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-base font-semibold flex items-center gap-2`}>
              <Tag className="size-4" /> 新建优惠码
            </DialogTitle>
            <DialogDescription className="sr-only">创建一个新的优惠码</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">优惠码</label>
              <div className="flex gap-1.5">
                <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className={`${mono.className} text-sm flex-1 tracking-[0.12em]`} placeholder="XXXX-XXXX-XXXX" />
                <Button variant="outline" size="sm" onClick={generateCode} className="shrink-0 text-xs">随机</Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">折扣类型</label>
              <div className="flex gap-1.5">
                {[{ v: "percent", l: "百分比", color: "text-violet-500", bg: "bg-violet-500/10 border-violet-500/30" },
                  { v: "fixed", l: "固定金额", color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/30" }].map(t => (
                  <button key={t.v} onClick={() => setForm({ ...form, discount_type: t.v })}
                    className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-all ${
                      form.discount_type === t.v ? `${t.bg} ${t.color}` : "border-border text-muted-foreground hover:bg-muted"
                    }`}>{t.l}</button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{form.discount_type === "percent" ? "折扣百分比" : "折扣金额"}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">{form.discount_type === "percent" ? "%" : "¥"}</span>
                <Input type="number" step="0.01" min={0.01} max={form.discount_type === "percent" ? 100 : 99999}
                  value={form.discount_value} onChange={e => setForm({ ...form, discount_value: +e.target.value })} className={`${mono.className} text-sm pl-8`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">最低订单金额</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">¥</span>
                  <Input type="number" min={0} step="0.01" value={form.min_amount} onChange={e => setForm({ ...form, min_amount: +e.target.value })} className={`${mono.className} text-sm pl-7`} placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">最大使用次数</label>
                <Input type="number" min={1} value={form.max_uses} onChange={e => setForm({ ...form, max_uses: +e.target.value })} className={`${mono.className} text-sm`} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">有效期 <span className="text-muted-foreground/60">（小时，0 = 不限）</span></label>
              <div className="flex gap-2 items-center">
                <Input type="number" min={0} max={87600} value={form.expires_in_hours} onChange={e => setForm({ ...form, expires_in_hours: +e.target.value })} className={`${mono.className} text-sm`} />
                {form.expires_in_hours > 0 && (
                  <span className={`${mono.className} text-[11px] text-muted-foreground shrink-0 tabular-nums`}>→ {new Date(Date.now() + form.expires_in_hours * 3600000).toLocaleDateString()}</span>
                )}
              </div>
            </div>

            <Button onClick={create} className="w-full">创建优惠码</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ 禁用确认 ═══ */}
      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="禁用优惠码" description={`确定要禁用「${deleteTarget?.code}」？禁用后无法重新启用，已领取的用户不受影响。`}
        confirmLabel="禁用" variant="destructive" onConfirm={doDelete} />
    </div>
  );
}
