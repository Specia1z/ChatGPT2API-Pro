"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  ShieldAlert, AlertTriangle, Users, Eye,
  Zap, Coins, Image, UserX, ChevronLeft, ChevronRight, Unlock,
  RefreshCw, Ban, CheckCircle2, Clock, Activity, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

// 列宽拖拽 hook
function useColumnResize(initial: Record<string, number>) {
  const [widths, setWidths] = useState(initial);
  const dragging = useRef<string | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      setWidths(prev => ({ ...prev, [dragging.current!]: Math.max(40, startW.current + delta) }));
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleProps = (key: string) => ({
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = key;
      startX.current = e.clientX;
      startW.current = widths[key] || 60;
    },
    style: { minWidth: widths[key], width: widths[key] },
  });

  return { widths, handleProps };
}

const CARD = "rounded-2xl border bg-card";
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface RiskEntry {
  user_id: number;
  email?: string;
  score_api: number;
  score_points: number;
  score_content: number;
  score_account: number;
  total_score: number;
  reasons?: string;
  updated_at: string;
  banned?: boolean;
  ban_until?: string;
  ban_reason?: string;
}

interface RiskDetail {
  user_id: number;
  email: string;
  scores: RiskEntry;
  snapshots: Record<string, number>;
  banned?: boolean;
  ban_until?: string;
  ban_reason?: string;
  created_at?: string;
}

// 后台可调风险阈值（与 settings.risk_config 对应；缺失时回退内置默认）
interface RiskThresholds {
  flag: number;
  limit: number;
  ban: number;
  interval: number;
  window: number;
}
const DEFAULT_THRESHOLDS: RiskThresholds = { flag: 40, limit: 65, ban: 85, interval: 5, window: 5 };

const PAGE_SIZE = 20;

export default function RiskPage() {
  const [scores, setScores] = useState<RiskEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [th, setTh] = useState<RiskThresholds>(DEFAULT_THRESHOLDS);
  const [minScore, setMinScore] = useState(0);
  const [detail, setDetail] = useState<RiskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const col = useColumnResize({ user: 180, score: 64, level: 70, api: 70, points: 70, content: 70, account: 70, status: 110, reasons: 130, time: 110, action: 60 });

  // 分级函数：基于后台阈值动态判定
  const scoreColor = useCallback((s: number) => {
    if (s >= th.ban) return "text-red-500";
    if (s >= th.limit) return "text-amber-500";
    if (s >= th.flag) return "text-yellow-500";
    return "text-emerald-500";
  }, [th]);
  const scoreBg = useCallback((s: number) => {
    if (s >= th.ban) return "bg-red-500/10";
    if (s >= th.limit) return "bg-amber-500/10";
    if (s >= th.flag) return "bg-yellow-500/10";
    return "bg-emerald-500/10";
  }, [th]);
  const levelLabel = useCallback((s: number) => {
    if (s >= th.ban) return "高危";
    if (s >= th.limit) return "可疑";
    if (s >= th.flag) return "观察";
    return "正常";
  }, [th]);

  // 拉取后台风险阈值配置
  const fetchThresholds = useCallback(async () => {
    try {
      const r = await api("/api/settings");
      const rc = JSON.parse(r.data?.risk_config || "{}");
      setTh({
        flag: rc.flag_threshold || DEFAULT_THRESHOLDS.flag,
        limit: rc.limit_threshold || DEFAULT_THRESHOLDS.limit,
        ban: rc.ban_threshold || DEFAULT_THRESHOLDS.ban,
        interval: rc.score_interval_min || DEFAULT_THRESHOLDS.interval,
        window: rc.window_minutes || DEFAULT_THRESHOLDS.window,
      });
    } catch {}
  }, []);

  const fetchScores = useCallback(async (p: number, min: number) => {
    setLoading(true);
    try {
      const r = await api(`/api/admin/risk/scores?page=${p}&page_size=${PAGE_SIZE}&min_score=${min}`);
      setScores(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchThresholds(); }, [fetchThresholds]);
  useEffect(() => { fetchScores(page, minScore); }, [page, minScore, fetchScores]);

  const openDetail = async (uid: number) => {
    setDetailLoading(true);
    setDetail({ user_id: uid } as RiskDetail);
    try {
      const r = await api(`/api/admin/risk/detail?id=${uid}`);
      setDetail(r.data);
    } catch {
      toast.error("加载详情失败");
      setDetail(null);
    }
    setDetailLoading(false);
  };

  const unbanUser = async (uid: number) => {
    try {
      const r = await api("/api/admin/risk/unban", { method: "POST", body: JSON.stringify({ user_id: uid }) });
      toast.success(r.message || "已解封");
      fetchScores(page, minScore);
      if (detail?.user_id === uid) setDetail(d => d ? { ...d, banned: false } : d);
    } catch { toast.error("解封失败"); }
  };

  const batchUnban = async () => {
    try {
      const r = await api("/api/admin/risk/batch-unban", { method: "POST", body: JSON.stringify({ max_score: th.limit }) });
      toast.success(r.message || `已解封 ${r.data?.count || 0} 位`);
      fetchScores(page, minScore);
    } catch { toast.error("批量解封失败"); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const highRisk = scores.filter(s => s.total_score >= th.ban).length;
  const suspicious = scores.filter(s => s.total_score >= th.limit && s.total_score < th.ban).length;
  const watching = scores.filter(s => s.total_score >= th.flag && s.total_score < th.limit).length;
  const bannedCount = scores.filter(s => s.banned).length;

  const BarGauge = ({ value }: { value: number }) => (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${value >= th.ban ? "bg-red-500" : value >= th.limit ? "bg-amber-500" : value >= th.flag ? "bg-yellow-500" : "bg-primary/60"}`}
        style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );

  // 筛选档位
  const filters = [
    { label: "全部", v: 0 },
    { label: `观察 ≥${th.flag}`, v: th.flag },
    { label: `可疑 ≥${th.limit}`, v: th.limit },
    { label: `高危 ≥${th.ban}`, v: th.ban },
  ];

  if (loading && scores.length === 0) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight flex items-center gap-2`}>
              风险评分
              <span className="text-[10px] font-medium text-muted-foreground ml-1">用户风险 4 维度评估</span>
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              评分 {total} 用户 · 每 {th.interval} 分钟自动更新 · ≥{th.flag} 观察 · ≥{th.limit} 限流降级 · ≥{th.ban} 自动封禁
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => { fetchThresholds(); fetchScores(page, minScore); }}
              className="h-7 text-[10px] text-muted-foreground hover:text-foreground">
              <RefreshCw className="size-3 mr-1" />刷新
            </Button>
            <Button variant="outline" size="sm" onClick={batchUnban}
              className="h-7 text-[10px] text-muted-foreground hover:text-foreground">
              <Unlock className="size-3 mr-1" />批量解封 ≤{th.limit}
            </Button>
          </div>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-4 max-w-[1400px]">
            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
              {[
                { icon: ShieldAlert, label: "高危用户", v: highRisk, color: "text-red-500", bg: "bg-red-500/10" },
                { icon: AlertTriangle, label: "可疑用户", v: suspicious, color: "text-amber-500", bg: "bg-amber-500/10" },
                { icon: Eye, label: "观察中", v: watching, color: "text-yellow-500", bg: "bg-yellow-500/10" },
                { icon: Ban, label: "当前封禁", v: bannedCount, color: "text-rose-500", bg: "bg-rose-500/10" },
                { icon: Users, label: "已评分", v: total, color: "text-primary", bg: "bg-primary/10" },
              ].map(k => (
                <motion.div key={k.label} variants={fadeUp} className={`${CARD} p-3 sm:p-4`}>
                  <div className={`size-7 sm:size-8 rounded-lg ${k.bg} flex items-center justify-center mb-1.5`}>
                    <k.icon className={`size-3.5 sm:size-4 ${k.color}`} />
                  </div>
                  <p className={`text-lg sm:text-xl font-semibold tabular-nums ${k.color}`}>{k.v}</p>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">{k.label}</p>
                </motion.div>
              ))}
            </div>

            {/* 筛选档位 */}
            <motion.div variants={fadeUp} className="flex items-center gap-1.5 flex-wrap">
              {filters.map(f => (
                <button key={f.label} onClick={() => { setMinScore(f.v); setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                    minScore === f.v ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground border-border"
                  }`}>
                  {f.label}
                </button>
              ))}
            </motion.div>

            {/* Table */}
            <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      {[
                        { key: "user", label: "用户", cls: "", icon: undefined },
                        { key: "score", label: "总分", cls: "text-center", icon: undefined },
                        { key: "level", label: "等级", cls: "text-center", icon: undefined },
                        { key: "api", label: "API", cls: "hidden md:table-cell text-center", icon: Zap },
                        { key: "points", label: "积分", cls: "hidden md:table-cell text-center", icon: Coins },
                        { key: "content", label: "内容", cls: "hidden md:table-cell text-center", icon: Image },
                        { key: "account", label: "账号", cls: "hidden md:table-cell text-center", icon: UserX },
                        { key: "status", label: "封禁状态", cls: "hidden sm:table-cell text-center", icon: undefined },
                        { key: "reasons", label: "评分理由", cls: "hidden lg:table-cell", icon: undefined },
                        { key: "time", label: "更新时间", cls: "hidden sm:table-cell text-right", icon: undefined },
                        { key: "action", label: "", cls: "text-right", icon: undefined },
                      ].map(h => (
                        <th key={h.key} className={`font-medium px-3 py-3 relative select-none ${h.cls}`} {...col.handleProps(h.key)}>
                          <span className="inline-flex items-center gap-1">
                            {h.icon && <h.icon className="size-3" />}
                            {h.label}
                          </span>
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30"
                            onMouseDown={col.handleProps(h.key).onMouseDown}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scores.length === 0 ? (
                      <tr><td colSpan={11} className="text-center py-16 text-muted-foreground">暂无风险评分数据</td></tr>
                    ) : scores.map(s => (
                      <tr key={s.user_id} onClick={() => openDetail(s.user_id)}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground truncate max-w-[160px] block">{s.email ? `${s.email} (#${s.user_id})` : `#${s.user_id}`}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center justify-center w-9 h-6 rounded-md text-[11px] font-bold tabular-nums ${scoreColor(s.total_score)} ${scoreBg(s.total_score)}`}>{s.total_score}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge variant="outline" className={`text-[10px] ${scoreColor(s.total_score)}`}>{levelLabel(s.total_score)}</Badge>
                        </td>
                        <td className="hidden md:table-cell px-3 py-3"><BarGauge value={s.score_api} /></td>
                        <td className="hidden md:table-cell px-3 py-3"><BarGauge value={s.score_points} /></td>
                        <td className="hidden md:table-cell px-3 py-3"><BarGauge value={s.score_content} /></td>
                        <td className="hidden md:table-cell px-3 py-3"><BarGauge value={s.score_account} /></td>
                        <td className="hidden sm:table-cell px-3 py-3 text-center">
                          {s.banned ? (
                            <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-500/30">
                              {s.ban_until ? `封至 ${s.ban_until.slice(5, 16)}` : "永久封禁"}
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500"><CheckCircle2 className="size-3" />正常</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell px-3 py-3 text-[10px] text-muted-foreground truncate max-w-[140px]" title={s.reasons}>{s.reasons || "—"}</td>
                        <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums text-muted-foreground text-[10px]">{s.updated_at?.slice(5, 16) || "—"}</td>
                        <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                          {s.banned && (
                            <Button variant="ghost" size="sm" onClick={() => unbanUser(s.user_id)} className="h-6 text-[10px] text-muted-foreground hover:text-green-500" title="解封">
                              <Unlock className="size-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-[11px] text-muted-foreground">第 {page} / {totalPages} 页 · 共 {total} 条</span>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="h-7 text-[10px]">
                      <ChevronLeft className="size-3 mr-1" />上一页</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="h-7 text-[10px]">
                      下一页<ChevronRight className="size-3 ml-1" /></Button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      </main>

      {/* 用户详情 Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-red-500" />
              风险详情
            </DialogTitle>
          </DialogHeader>
          {detailLoading && !detail?.email ? (
            <div className="py-12 flex justify-center"><div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>
          ) : detail ? (
            <div className="space-y-4">
              {/* 用户头 + 总分 */}
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{detail.email || `#${detail.user_id}`}</p>
                  <p className="text-[10px] text-muted-foreground">
                    #{detail.user_id}{detail.created_at ? ` · 注册于 ${detail.created_at.slice(0, 10)}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-flex items-center justify-center px-2.5 h-7 rounded-md text-sm font-bold tabular-nums ${scoreColor(detail.scores?.total_score ?? 0)} ${scoreBg(detail.scores?.total_score ?? 0)}`}>
                    {detail.scores?.total_score ?? 0}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{levelLabel(detail.scores?.total_score ?? 0)}</p>
                </div>
              </div>

              {/* 封禁状态 */}
              <div className={`rounded-xl p-3 text-xs ${detail.banned ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                {detail.banned ? (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1.5 font-medium"><Ban className="size-3.5" />
                      {detail.ban_until ? `临时封禁，到期 ${detail.ban_until}` : "永久封禁"}
                    </p>
                    {detail.ban_reason && <p className="text-[11px] leading-relaxed opacity-90">{detail.ban_reason}</p>}
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5" />账号正常，未被封禁</p>
                )}
              </div>

              {/* 维度分解 */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-2">维度分解（各 0-100）</p>
                <div className="space-y-2">
                  {[
                    { label: "API 滥用", icon: Zap, v: detail.scores?.score_api ?? 0 },
                    { label: "积分滥用", icon: Coins, v: detail.scores?.score_points ?? 0 },
                    { label: "内容滥用", icon: Image, v: detail.scores?.score_content ?? 0 },
                    { label: "账号异常", icon: UserX, v: detail.scores?.score_account ?? 0 },
                  ].map(d => (
                    <div key={d.label} className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground w-20 shrink-0"><d.icon className="size-3" />{d.label}</span>
                      <div className="flex-1"><BarGauge value={d.v} /></div>
                      <span className={`text-[11px] font-medium tabular-nums w-7 text-right ${scoreColor(d.v)}`}>{d.v}</span>
                    </div>
                  ))}
                </div>
                {detail.scores?.reasons && (
                  <p className="text-[10px] text-muted-foreground mt-2">理由：{detail.scores.reasons}</p>
                )}
              </div>

              {/* Redis 实时信号 */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Activity className="size-3" />实时信号（原始计数）</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: `请求数·${th.window}min`, icon: Activity, v: detail.snapshots?.qps ?? 0 },
                    { label: `错误数·${th.window}min`, icon: AlertTriangle, v: detail.snapshots?.errors ?? 0 },
                    { label: "IP 数·1h", icon: Globe, v: detail.snapshots?.ips ?? 0 },
                    { label: `令牌耗·${th.window}min`, icon: Coins, v: detail.snapshots?.tokens ?? 0 },
                  ].map(m => (
                    <div key={m.label} className="rounded-lg bg-muted/50 p-2 text-center">
                      <m.icon className="size-3 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-sm font-semibold tabular-nums">{m.v}</p>
                      <p className="text-[9px] text-muted-foreground">{m.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1"><Clock className="size-2.5" />
                  采集窗口 {th.window} 分钟（IP 去重固定 1 小时）· 评分更新于 {detail.scores?.updated_at || "—"}
                </p>
              </div>

              {/* 操作 */}
              {detail.banned && (
                <Button variant="outline" size="sm" onClick={() => unbanUser(detail.user_id)} className="w-full h-8 text-xs text-emerald-600 hover:text-emerald-700">
                  <Unlock className="size-3.5 mr-1.5" />解除封禁
                </Button>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
