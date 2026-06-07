"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Plus, Trash2, Star, Package, Zap, Coins, Timer, Edit2, Check, Gauge } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const cardPop = { hidden: { opacity: 0, y: 14, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── Helpers ──────────────────────────────── */
const DURATION_PRESETS = [
  { v: 0, l: "永久" }, { v: 30, l: "1个月" }, { v: 90, l: "3个月" },
  { v: 180, l: "6个月" }, { v: 365, l: "1年" },
];

const fmtDuration = (d: number) => {
  if (!d) return "永久";
  const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30), days = d % 30;
  let s = "";
  if (y) s += `${y}年`;
  if (m) s += `${m}个月`;
  if (days || !s) s += `${days}天`;
  return s;
};

const parseFeatures = (raw: string): string[] => {
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : []; }
};

/* ── 主页面 ─────────────────────────────────── */
export default function PlansPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => { api("/api/admin/plans").then(r => { setPlans(r.data || []); setLoading(false); }); }, []);
  const refresh = async () => { const r = await api("/api/admin/plans"); setPlans(r.data || []); };

  const save = async (p: any) => {
    try { await api("/api/admin/plans", { method: p.id === 0 ? "POST" : "PUT", body: JSON.stringify(p) }); toast.success("已保存"); refresh(); setEditing(null); }
    catch (e: any) { toast.error(e.message); }
  };
  const toggleHighlighted = async (p: any) => { await api("/api/admin/plans", { method: "PUT", body: JSON.stringify({ ...p, highlighted: !p.highlighted }) }); refresh(); };
  const toggleEnabled = async (p: any) => { await api("/api/admin/plans", { method: "PUT", body: JSON.stringify({ ...p, enabled: !p.enabled }) }); refresh(); };
  const del = async () => {
    if (!deleteTarget) return;
    try { await api("/api/admin/plans", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) }); refresh(); toast.success("已删除"); setDeleteTarget(null); }
    catch (e: any) { toast.error(e.message); }
  };

  const newPlan = () => setEditing({
    id: 0, name: "新套餐", price_monthly: 0, price_yearly: 0, duration_days: 0,
    duration_days_yearly: 0, concurrency: 1, token_capacity: 50, token_refill_per_hour: 3,
    rate_limit_per_min: 0,
    features: "[]", sort_order: plans.length, highlighted: false, enabled: true,
  });

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
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>套餐管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{plans.length} 个套餐 · 点击星标设置推荐</p>
          </div>
          <Button size="sm" onClick={newPlan} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 shrink-0">
            <Plus className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">新建套餐</span><span className="sm:hidden">新建</span>
          </Button>
        </div>

        {/* ═══ 卡片网格 ═══ */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin">
          {plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                <Package className="size-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">暂无套餐，点击「新建套餐」创建</p>
            </div>
          ) : (
            <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
              variants={stagger} initial="hidden" animate="visible">
              {plans.sort((a, b) => a.sort_order - b.sort_order).map(p => {
                const features = parseFeatures(p.features || "[]");
                const isFree = p.price_monthly === 0;
                return (
                  <motion.div key={p.id} variants={cardPop}
                    className={`group relative rounded-2xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
                      p.highlighted ? "border-primary/40 ring-1 ring-primary/20" : ""
                    } ${!p.enabled ? "opacity-50 grayscale-[30%]" : ""}`}>
                    {/* 推荐标识 */}
                    {p.highlighted && (
                      <div className="absolute top-0 right-0 px-2.5 py-0.5 rounded-bl-lg bg-primary text-primary-foreground text-[10px] font-semibold inline-flex items-center gap-1">
                        <Star className="size-2.5 fill-current" /> 推荐
                      </div>
                    )}

                    <div className="p-4 sm:p-5">
                      {/* 名称行 */}
                      <div className="flex items-center justify-between mb-2 sm:mb-3">
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                          <button onClick={() => toggleHighlighted(p)}
                            className={`shrink-0 transition-colors ${p.highlighted ? "text-primary" : "text-muted-foreground/40 hover:text-primary"}`}>
                            <Star className={`size-4 ${p.highlighted ? "fill-current" : ""}`} />
                          </button>
                          <h3 className={`${heading.className} text-base font-bold truncate`}>{p.name}</h3>
                        </div>
                        <button onClick={() => toggleEnabled(p)}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                            p.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                          }`}>
                          {p.enabled ? "启用" : "禁用"}
                        </button>
                      </div>

                      {/* 价格 */}
                      <div className="flex items-baseline gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                        {isFree ? (
                          <span className={`${heading.className} text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400`}>免费</span>
                        ) : (
                          <>
                            <div className="flex items-baseline flex-wrap">
                              <span className="text-[10px] sm:text-xs text-muted-foreground mr-0.5">¥</span>
                              <span className={`${mono.className} text-2xl sm:text-3xl font-medium tabular-nums tracking-tight`}>{p.price_monthly}</span>
                              <span className="text-[10px] sm:text-xs text-muted-foreground ml-0.5 sm:ml-1">/月</span>
                            </div>
                            {p.price_yearly > 0 && (
                              <span className={`${mono.className} text-[10px] sm:text-xs text-muted-foreground tabular-nums`}>¥{p.price_yearly}/月<span className="text-[9px] sm:text-[10px]">(年付)</span></span>
                            )}
                          </>
                        )}
                      </div>

                      {/* 指标条 */}
                      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                        {[
                          { icon: Zap, value: p.concurrency || 1, label: "并发", color: "text-primary", bg: "bg-primary/10" },
                          { icon: Coins, value: p.token_capacity || 50, label: "令牌", color: "text-emerald-500", bg: "bg-emerald-500/10" },
                          { icon: Timer, value: p.token_refill_per_hour || 3, label: "/小时", color: "text-blue-500", bg: "bg-blue-500/10" },
                          { icon: Gauge, value: p.rate_limit_per_min || 30, label: "API/分", color: "text-violet-500", bg: "bg-violet-500/10" },
                        ].map(m => (
                          <div key={m.label} className="rounded-xl bg-muted/40 p-2 sm:p-2.5 text-center">
                            <div className={`size-6 sm:size-7 rounded-lg ${m.bg} flex items-center justify-center mx-auto mb-1 sm:mb-1.5`}>
                              <m.icon className={`size-3 sm:size-3.5 ${m.color}`} />
                            </div>
                            <p className={`${mono.className} text-sm sm:text-base font-medium tabular-nums leading-none`}>{m.value}</p>
                            <p className="text-[8px] sm:text-[9px] text-muted-foreground mt-0.5 sm:mt-1">{m.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* 有效期 */}
                      <div className="space-y-1 mb-3 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">月付有效期</span>
                          <span className="font-medium">{fmtDuration(p.duration_days || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">年付有效期</span>
                          <span className="font-medium">{fmtDuration(p.duration_days_yearly || 0)}</span>
                        </div>
                      </div>

                      {features.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3 sm:mb-4">
                          {features.map((f, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                              <Check className="size-2.5 text-emerald-500" /> {f}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 操作 */}
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing({ ...p })} className="flex-1 gap-1.5 text-xs">
                          <Edit2 className="size-3.5" /> 编辑
                        </Button>
                        <Button variant="outline" size="icon-sm" onClick={() => setDeleteTarget(p)} className="hover:text-destructive hover:border-destructive/30">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {/* 新建卡 */}
              <motion.button variants={cardPop} onClick={newPlan}
                className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center py-8 sm:py-12 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all group min-h-[220px] sm:min-h-[300px]">
                <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mb-2 group-hover:bg-primary/10 group-hover:scale-105 transition-all">
                  <Plus className="size-6 group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium">新建套餐</span>
              </motion.button>
            </motion.div>
          )}
        </div>
      </main>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="删除套餐" description={`确定要删除「${deleteTarget?.name}」？此操作不可撤销。`}
        confirmLabel="删除" variant="destructive" onConfirm={del} />

      {/* ═══ 编辑弹窗 ═══ */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm sm:max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto scrollbar-thin`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-base font-semibold`}>{editing?.id ? "编辑套餐" : "新建套餐"}</DialogTitle>
            <DialogDescription className="sr-only">配置套餐的价格、配额与功能</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 mt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">套餐名称</label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">月付单价 ¥/月</label>
                  <Input type="number" step="0.01" min={0} value={editing.price_monthly}
                    onChange={e => setEditing({ ...editing, price_monthly: +e.target.value })} className={`${mono.className} text-sm`} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">年付价格 ¥/月</label>
                  <Input type="number" step="0.01" min={0} value={editing.price_yearly}
                    onChange={e => setEditing({ ...editing, price_yearly: +e.target.value })} className={`${mono.className} text-sm`} />
                </div>
              </div>

              {editing.price_monthly > 0 && (
                <>
                  {([
                    { key: "duration_days", label: "月付有效期" },
                    { key: "duration_days_yearly", label: "年付有效期" },
                  ] as const).map(field => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {DURATION_PRESETS.map(o => (
                          <button key={o.v} type="button" onClick={() => setEditing({ ...editing, [field.key]: o.v })}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              editing[field.key] === o.v ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"
                            }`}>{o.l}</button>
                        ))}
                        <div className="flex items-center gap-1 ml-1">
                          <Input type="number" min={0} value={editing[field.key] || 0}
                            onChange={e => setEditing({ ...editing, [field.key]: +e.target.value })}
                            className={`${mono.className} h-7 w-16 text-xs text-center`} />
                          <span className="text-xs text-muted-foreground">天</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "concurrency", label: "并发", icon: Zap },
                  { key: "token_capacity", label: "令牌容量", icon: Coins },
                  { key: "token_refill_per_hour", label: "速率/h", icon: Timer },
                ].map(f => (
                  <div key={f.key} className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><f.icon className="size-3" /> {f.label}</label>
                    <Input type="number" min={f.key === "token_refill_per_hour" ? 0 : 1}
                      value={editing[f.key]} onChange={e => setEditing({ ...editing, [f.key]: +e.target.value })} className={`${mono.className} text-sm`} />
                  </div>
                ))}
              </div>

              {/* API 限流速率 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Gauge className="size-3" /> API 限流速率（每分钟请求数）</label>
                <Input type="number" min={0} value={editing.rate_limit_per_min ?? 0}
                  onChange={e => setEditing({ ...editing, rate_limit_per_min: +e.target.value })} className={`${mono.className} text-sm`} />
                <p className="text-[10px] text-muted-foreground">通过 API Key 调用 /v1 接口的每分钟请求上限。0 = 使用默认 600/分钟。需求量大的套餐可调高。</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">功能特性（JSON 数组）</label>
                <Input value={editing.features} onChange={e => setEditing({ ...editing, features: e.target.value })}
                  placeholder='["高清画质", "API接入"]' className={`${mono.className} text-sm`} />
                {(() => {
                  const preview = parseFeatures(editing.features || "[]");
                  return preview.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {preview.map((f: string, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                          <Check className="size-2.5 text-emerald-500" /> {f}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="border-t pt-3 flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={editing.enabled} onCheckedChange={v => setEditing({ ...editing, enabled: v })} />
                  <span className="text-xs font-medium">启用</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={editing.highlighted} onCheckedChange={v => setEditing({ ...editing, highlighted: v })} />
                  <span className="text-xs font-medium">推荐</span>
                </label>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-muted-foreground">排序</label>
                  <Input type="number" min={0} value={editing.sort_order}
                    onChange={e => setEditing({ ...editing, sort_order: +e.target.value })} className={`${mono.className} h-7 w-16 text-xs text-center`} />
                </div>
              </div>

              <Button onClick={() => save(editing)} className="w-full">保存套餐</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
