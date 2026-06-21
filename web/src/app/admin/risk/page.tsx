"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  ShieldAlert, AlertTriangle, Users, Eye,
  Zap, Coins, Image, UserX, ChevronLeft, ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const CARD = "rounded-2xl border bg-card";
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface RiskEntry {
  user_id: number;
  score_api: number;
  score_points: number;
  score_content: number;
  score_account: number;
  total_score: number;
  email?: string;
  updated_at: string;
}

const PAGE_SIZE = 20;

function scoreColor(s: number): string {
  if (s >= 80) return "text-red-500";
  if (s >= 50) return "text-amber-500";
  if (s >= 30) return "text-yellow-500";
  return "text-emerald-500";
}
function scoreBg(s: number): string {
  if (s >= 80) return "bg-red-500/10";
  if (s >= 50) return "bg-amber-500/10";
  if (s >= 30) return "bg-yellow-500/10";
  return "bg-emerald-500/10";
}
function levelLabel(s: number): string {
  if (s >= 80) return "高危";
  if (s >= 50) return "可疑";
  if (s >= 30) return "观察";
  return "正常";
}

export default function RiskPage() {
  const [scores, setScores] = useState<RiskEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchScores = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await api(`/api/admin/risk/scores?page=${p}&page_size=${PAGE_SIZE}`);
      setScores(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchScores(page); }, [page, fetchScores]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const highRisk = scores.filter(s => s.total_score >= 80).length;
  const suspicious = scores.filter(s => s.total_score >= 50 && s.total_score < 80).length;
  const watching = scores.filter(s => s.total_score >= 30 && s.total_score < 50).length;

  const BarGauge = ({ value, label, max }: { value: number; label: string; max: number }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${value >= 80 ? "bg-red-500" : value >= 50 ? "bg-amber-500" : "bg-primary/60"}`}
          style={{ width: `${Math.min((value / max) * 100, 100)}%` }} />
      </div>
    </div>
  );

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
              评分 {total} 用户 · 每 5 分钟自动更新 · ≥30 观察 · ≥50 可疑 · ≥80 自动封禁
            </p>
          </div>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-4 max-w-[1400px]">
            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {[
                { icon: ShieldAlert, label: "高危用户", v: highRisk, color: "text-red-500", bg: "bg-red-500/10" },
                { icon: AlertTriangle, label: "可疑用户", v: suspicious, color: "text-amber-500", bg: "bg-amber-500/10" },
                { icon: Eye, label: "观察中", v: watching, color: "text-yellow-500", bg: "bg-yellow-500/10" },
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

            {/* Table */}
            <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="font-medium px-4 py-3">用户</th>
                      <th className="font-medium px-3 py-3 text-center w-16">总分</th>
                      <th className="font-medium px-3 py-3 text-center w-16">等级</th>
                      <th className="hidden sm:table-cell font-medium px-3 py-3 text-center w-16"><Zap className="size-3 inline" /> API</th>
                      <th className="hidden sm:table-cell font-medium px-3 py-3 text-center w-16"><Coins className="size-3 inline" /> 积分</th>
                      <th className="hidden sm:table-cell font-medium px-3 py-3 text-center w-16"><Image className="size-3 inline" /> 内容</th>
                      <th className="hidden sm:table-cell font-medium px-3 py-3 text-center w-16"><UserX className="size-3 inline" /> 账号</th>
                      <th className="font-medium px-4 py-3 text-right w-20">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-16 text-muted-foreground">暂无风险评分数据</td></tr>
                    ) : scores.map(s => (
                      <tr key={s.user_id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground truncate max-w-[160px] block">{s.email || `#${s.user_id}`}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center justify-center w-9 h-6 rounded-md text-[11px] font-bold tabular-nums ${scoreColor(s.total_score)} ${scoreBg(s.total_score)}`}>{s.total_score}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge variant="outline" className={`text-[10px] ${scoreColor(s.total_score)}`}>{levelLabel(s.total_score)}</Badge>
                        </td>
                        <td className="hidden sm:table-cell px-3 py-3"><BarGauge value={s.score_api} label="" max={100} /></td>
                        <td className="hidden sm:table-cell px-3 py-3"><BarGauge value={s.score_points} label="" max={100} /></td>
                        <td className="hidden sm:table-cell px-3 py-3"><BarGauge value={s.score_content} label="" max={100} /></td>
                        <td className="hidden sm:table-cell px-3 py-3"><BarGauge value={s.score_account} label="" max={100} /></td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-[10px]">{s.updated_at?.slice(5, 16) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-[11px] text-muted-foreground">第 {page} / {totalPages} 页</span>
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
    </div>
  );
}
