"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  Clock, CheckCircle2, XCircle, Ban, Wallet, Receipt, ShoppingCart,
} from "lucide-react";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const rowFade = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.3 } } };

/* ── 状态映射 ─────────────────────────────── */
const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending:   { label: "待支付", color: "#f59e0b", bg: "bg-amber-500/10", icon: Clock },
  paid:      { label: "已支付", color: "#10b981", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  expired:   { label: "已过期", color: "#71717a", bg: "bg-muted", icon: XCircle },
  cancelled: { label: "已取消", color: "#ef4444", bg: "bg-red-500/10", icon: Ban },
};

const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "pending", label: "待支付" },
  { value: "paid", label: "已支付" },
  { value: "expired", label: "已过期" },
  { value: "cancelled", label: "已取消" },
];

/* ── 主页面 ─────────────────────────────────── */
export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const pageSize = 20;

  const fetchOrders = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const q = `page=${p}&page_size=${pageSize}${status ? `&status=${status}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
      const r = await api(`/api/admin/orders?${q}`);
      setOrders(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch {}
    setLoading(false);
  }, [status, search]);

  useEffect(() => { setPage(1); }, [status, search]);
  useEffect(() => { fetchOrders(page); }, [page, fetchOrders]);
  // 输入防抖：停止输入 400ms 后触发搜索
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fmtDate = (s: string) => s ? s.slice(0, 19).replace("T", " ") : "";

  // 当前页营收概览
  const overview = useMemo(() => {
    const paidOrders = orders.filter(o => o.status === "paid");
    const paidAmount = paidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
    const pendingCount = orders.filter(o => o.status === "pending").length;
    return { paidCount: paidOrders.length, paidAmount, pendingCount };
  }, [orders]);

  if (loading && orders.length === 0) return (
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
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>订单管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">共 <span className="font-semibold text-foreground tabular-nums">{total}</span> 笔订单</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="订单号 / 邮箱 / 昵称 / 交易号"
                className="h-8 w-40 sm:w-60 rounded-lg border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => fetchOrders(page)} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-muted-foreground px-1.5 sm:px-2 shrink-0">
              <RefreshCw className={`size-3 sm:size-3.5 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>

        {/* ═══ 状态标签 ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 shrink-0 overflow-x-auto">
          <div className="flex gap-4 sm:gap-6 min-w-max">
            {STATUS_TABS.map(tab => (
              <button key={tab.value} onClick={() => setStatus(tab.value)}
                className={`py-3 text-sm font-medium border-b-2 transition-all ${
                  status === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-6 max-w-[1400px]">

            {/* ═══ 营收概览（当前页） ═══ */}
            <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {[
                { label: "本页已付金额", value: `¥${overview.paidAmount.toFixed(2)}`, icon: Wallet, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "本页已付订单", value: String(overview.paidCount), icon: Receipt, color: "text-primary", bg: "bg-primary/10" },
                { label: "本页待支付", value: String(overview.pendingCount), icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
              ].map(item => (
                <div key={item.label} className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:shadow-sm transition-shadow">
                  <div className={`size-10 sm:size-11 rounded-xl ${item.bg} flex items-center justify-center shrink-0`}>
                    <item.icon className={`size-4 sm:size-5 ${item.color}`} />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{item.label}</p>
                    <p className={`${mono.className} text-lg sm:text-xl font-medium tabular-nums mt-0.5`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* ═══ 表格 ═══ */}
            {orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <ShoppingCart className="size-5 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">暂无订单</p>
              </div>
            ) : (
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider w-14">ID</th>
                        <th className="text-left px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">订单号</th>
                        <th className="text-left px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">用户</th>
                        <th className="text-left px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">套餐</th>
                        <th className="text-right px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">金额</th>
                        <th className="text-center px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">状态</th>
                        <th className="text-right px-4 py-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orders.map(o => {
                        const st = STATUS_MAP[o.status] || { label: o.status, color: "#71717a", bg: "bg-muted", icon: Clock };
                        return (
                          <motion.tr key={o.id} variants={rowFade} className="hover:bg-muted/40 transition-colors">
                            <td className={`${mono.className} px-4 py-3 text-muted-foreground`}>{o.id}</td>
                            <td className="px-4 py-3"><code className={`${mono.className} text-[11px] select-all`}>{o.order_no}</code></td>
                            <td className="px-4 py-3">
                              <div className="font-medium">{o.user_name || o.user_email || `#${o.user_id}`}</div>
                              {o.user_email && o.user_name && <div className="text-[11px] text-muted-foreground">{o.user_email}</div>}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{o.plan_name || `#${o.plan_id}`}</td>
                            <td className={`${mono.className} px-4 py-3 text-right tabular-nums font-medium`}>¥{o.amount?.toFixed(2)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${st.bg}`} style={{ color: st.color }}>
                                <st.icon className="size-3" /> {st.label}
                              </span>
                            </td>
                            <td className={`${mono.className} px-4 py-3 text-right text-[11px] text-muted-foreground`}>{fmtDate(o.created_at)}</td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* ═══ 分页 ═══ */}
            {totalPages > 1 && (
              <motion.div variants={fadeUp} className="flex items-center justify-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft /></Button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let num: number;
                  if (totalPages <= 7) num = i + 1;
                  else if (page <= 4) num = i + 1;
                  else if (page >= totalPages - 3) num = totalPages - 6 + i;
                  else num = page - 3 + i;
                  return (
                    <button key={num} onClick={() => setPage(num)}
                      className={`size-7 rounded-lg text-xs font-medium tabular-nums transition-all ${
                        num === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}>{num}</button>
                  );
                })}
                <Button variant="ghost" size="icon-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight /></Button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
