"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Coins, Globe, RefreshCw, AlertTriangle, Code2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const CARD = "rounded-2xl border bg-card";
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface QuotaHit {
  user_id: number;
  email: string;
  plan_name: string;
  quota: number;
  used: number;
  pct: number;
}
interface IPAlert {
  key_id: number;
  user_id: number;
  key_name: string;
  email: string;
  ip_count: number;
}

export default function AdminQuotaPage() {
  const [hits, setHits] = useState<QuotaHit[]>([]);
  const [ipAlerts, setIPAlerts] = useState<IPAlert[]>([]);
  const [ipThreshold, setIPThreshold] = useState(50);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api("/api/admin/quota/alerts");
      setHits(r.data?.quota_hits || []);
      setIPAlerts(r.data?.ip_alerts || []);
      setIPThreshold(r.data?.ip_threshold || 50);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && hits.length === 0 && ipAlerts.length === 0) return (
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
              配额告警
              <span className="text-[10px] font-medium text-muted-foreground ml-1">防二次分发 · 仅观测</span>
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              撞月配额用户 + 单 API Key 多 IP 调用（疑似中转站转卖）。此页仅展示，不自动处置。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="h-7 text-[10px] text-muted-foreground hover:text-foreground">
            <RefreshCw className={`size-3 mr-1 ${loading ? "animate-spin" : ""}`} />刷新
          </Button>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-4 max-w-[1200px]">
            {/* KPI */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {[
                { icon: Coins, label: "撞额用户", v: hits.length, color: "text-amber-500", bg: "bg-amber-500/10" },
                { icon: Globe, label: `多IP告警 (≥${ipThreshold})`, v: ipAlerts.length, color: "text-red-500", bg: "bg-red-500/10" },
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

            {/* 撞额名单 */}
            <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><Coins className="size-4 text-amber-500" /></div>
                <span className="text-sm font-semibold">撞额名单</span>
                <Badge variant="outline" className="tabular-nums">{hits.length}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">本月令牌消耗 ≥ 套餐月配额</span>
              </div>
              {hits.length === 0 ? (
                <div className="py-14 flex flex-col items-center gap-2 text-muted-foreground">
                  <Coins className="size-7 opacity-30" />
                  <p className="text-xs">本月暂无用户撞额</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="font-medium px-4 py-2.5">用户</th>
                      <th className="font-medium px-3 py-2.5">套餐</th>
                      <th className="font-medium px-3 py-2.5 text-right">已用 / 配额</th>
                      <th className="font-medium px-3 py-2.5 text-right">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map(h => (
                      <tr key={h.user_id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5"><span className="truncate block max-w-[200px]">{h.email || `#${h.user_id}`}</span></td>
                        <td className="px-3 py-2.5"><Badge variant="outline" className="text-[10px]">{h.plan_name || "—"}</Badge></td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${mono.className}`}>{h.used.toLocaleString()} / {h.quota.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-semibold tabular-nums ${h.pct >= 150 ? "text-red-500" : "text-amber-500"}`}>{h.pct}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </motion.div>

            {/* 多 IP 告警 */}
            <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <div className="size-8 rounded-lg bg-red-500/10 flex items-center justify-center"><Globe className="size-4 text-red-500" /></div>
                <span className="text-sm font-semibold">单 Key 多 IP 告警</span>
                <Badge variant="outline" className="tabular-nums">{ipAlerts.length}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">单 API Key 近 24h 去重 IP ≥ {ipThreshold}</span>
              </div>
              {ipAlerts.length === 0 ? (
                <div className="py-14 flex flex-col items-center gap-2 text-muted-foreground">
                  <Globe className="size-7 opacity-30" />
                  <p className="text-xs">暂无多 IP 告警</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="font-medium px-4 py-2.5">用户</th>
                      <th className="font-medium px-3 py-2.5">API Key</th>
                      <th className="font-medium px-3 py-2.5 text-right">24h 去重 IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ipAlerts.map(a => (
                      <tr key={a.key_id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5"><span className="truncate block max-w-[200px]">{a.email || `#${a.user_id}`}</span></td>
                        <td className={`px-3 py-2.5 ${mono.className} text-muted-foreground`}>
                          <span className="inline-flex items-center gap-1"><Code2 className="size-3" />{a.key_name || "未命名"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-red-500">
                            <AlertTriangle className="size-3" />{a.ip_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </motion.div>

            <div className="rounded-xl bg-muted/40 p-3.5 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
              <Users className="size-3.5 shrink-0 mt-0.5" />
              <span>
                此页为观测工具：撞额名单按「套餐月配额」与本月实际令牌消耗比对；多 IP 告警统计单 API Key 近 24h 的去重来源 IP。
                两者结合（撞额 + 多 IP）通常即中转站转卖的特征。阈值与撞额降速开关在「系统设置 → 风险评分」中配置。处置请到「用户管理」手动操作。
              </span>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
