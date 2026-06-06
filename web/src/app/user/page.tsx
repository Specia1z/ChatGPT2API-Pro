"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Navbar } from "@/components/navbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { InviteCard } from "@/components/invite-card";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Copy, Check, Key, Plus, Trash2, Zap, Gift, Ticket,
  RefreshCw, Coins, Battery, Layers, Timer, Crown, ArrowUpRight, LogOut,
  BarChart3, TrendingUp, CalendarDays, Activity, Loader2,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip as RechartsTooltip } from "recharts";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const monoFont = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画配置 ─────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const scaleIn = { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── 缓动数字（两位小数） ─────────────────── */
function useAnimatedNumber(value: number) {
  const [display, setDisplay] = useState(0);
  const cur = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const from = cur.current;
    if (Math.abs(value - from) < 0.5) { cur.current = value; setDisplay(value); return; }
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min((now - start) / 900, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * e;
      cur.current = v; setDisplay(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return display;
}

/* ── 倒计时 ─────────────────────────────────── */
function formatHMS(s: number) {
  if (s <= 0) return "00:00";
  const t = Math.ceil(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function useCountdown(tokens: number, cap: number, refill: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(0); if (refill <= 0) return; const id = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(id); }, [tokens, cap, refill]);
  if (tokens >= cap || refill <= 0) return null;
  const est = Math.min(tokens + (tick * refill) / 3600, cap);
  if (est >= cap) return { est, nextHMS: null };
  return { est, nextHMS: formatHMS(((Math.floor(est) + 1 - est) / refill) * 3600) };
}

/* ── 主页面 ─────────────────────────────────── */

export default function UserPage() {
  const { user, token, loading: authLoading, logout, login } = useAuth();
  const router = useRouter();
  const [keys, setKeys] = useState<any[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [tokens, setTokens] = useState<number | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [checkin, setCheckin] = useState<any>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [userCoupons, setUserCoupons] = useState<any[]>([]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeTokens, setExchangeTokens] = useState(10);
  const [exchanging, setExchanging] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);
  const doChangePwd = async () => {
    if (!oldPwd || newPwd.length < 6) return;
    setChangingPwd(true);
    try {
      const r = await api("/api/user/change-password", { method: "POST", body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }) });
      toast.success(r.message || "密码已修改");
      setOldPwd(""); setNewPwd("");
    } catch (e: any) { toast.error(e.message || "修改失败"); }
    setChangingPwd(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { router.push("/login"); return; }
    refreshProfile(); fetchKeys(); fetchTokens(); fetchCheckin(); fetchCoupons(); fetchUserStats();
    const iv = setInterval(fetchTokens, 15000);
    return () => clearInterval(iv);
  }, [user, token, authLoading]);

  const fetchUserStats = async () => { try { const r = await api("/api/user/stats"); if (r.data) { setUserStats(r.data); } } catch {} };
  const refreshProfile = async () => { try { const r = await api("/api/user/profile"); if (r.data && token) { login(r.data, token); } } catch {} };
  const fetchKeys = async () => { try { const r = await api("/api/user/keys"); setKeys(r.data || []); } catch {} };
  const fetchTokens = async () => { try { const r = await api("/api/user/tokens"); if (r.data?.tokens !== undefined) setTokens(r.data.tokens); } catch {} };
  const fetchCheckin = async () => { try { const r = await api("/api/user/checkin/status"); setCheckin(r.data); } catch {} };
  const fetchCoupons = async () => { try { const r = await api("/api/user/coupons"); setUserCoupons(r.data || []); } catch {} };

  const doExchange = async () => {
    if (exchangeTokens <= 0) return;
    setExchanging(true);
    try {
      const r = await api("/api/user/points/exchange", { method: "POST", body: JSON.stringify({ tokens: exchangeTokens }) });
      toast.success(`兑换成功！+${r.data.tokens_added} 突发令牌`);
      setExchangeOpen(false);
      fetchUserStats(); fetchTokens();
    } catch (e: any) {
      toast.error(e.message || "兑换失败");
    } finally {
      setExchanging(false);
    }
  };

  const doCheckin = async () => { try { const r = await api("/api/user/checkin", { method: "POST" }); toast.success(r.message || "签到成功"); fetchCheckin(); fetchTokens(); } catch (e: any) { toast.error(e.message); } };
  const claimCoupon = async () => { if (!claimCode.trim()) return; setClaiming(true); try { await api("/api/user/coupons/claim", { method: "POST", body: JSON.stringify({ code: claimCode.trim() }) }); toast.success("优惠券领取成功"); setClaimCode(""); fetchCoupons(); } catch (e: any) { toast.error(e.message); } finally { setClaiming(false); } };
  const doRedeem = async () => { if (!redeemCode.trim()) return; setRedeeming(true); try { const r = await api("/api/user/redeem", { method: "POST", body: JSON.stringify({ code: redeemCode.trim() }) }); toast.success(`兑换成功: ${r.data?.value ?? ""}`); setRedeemCode(""); fetchTokens(); } catch (e: any) { toast.error(e.message); } finally { setRedeeming(false); } };
  const createKey = async () => { try { await api("/api/user/keys", { method: "POST", body: JSON.stringify({ name: newKeyName || "API Key" }) }); setNewKeyName(""); toast.success("密钥已创建"); fetchKeys(); } catch (e: any) { toast.error(e.message); } };
  const deleteKey = async () => { if (deleteId == null) return; try { await api("/api/user/keys", { method: "DELETE", body: JSON.stringify({ id: deleteId }) }); toast.success("密钥已删除"); fetchKeys(); } catch (e: any) { toast.error(e.message); } finally { setDeleteId(null); } };
  const copyKey = async (k: string) => { await navigator.clipboard.writeText(k); setCopied(k); toast.success("已复制"); setTimeout(() => setCopied(null), 1500); };

  const capacity = user?.token_capacity || 50;
  const refill = user?.token_refill_per_hour || 3;
  const concurrency = user?.plan_concurrency || 1;
  const tokenVal = tokens ?? capacity;
  const isPro = user?.plan_name ? user.plan_name !== "免费版" : false;
  const cd = useCountdown(tokenVal, capacity, refill);
  const burst = userStats?.burst ?? 0;
  const exchangeRate = userStats?.exchange_rate ?? 10;
  const exchangeBonus = userStats?.exchange_bonus ?? 0;
  const displayTokens = Math.min(cd?.est ?? tokenVal, capacity);
  const pct = Math.min(Math.max(capacity > 0 ? displayTokens / capacity : 0, 0), 1);
  const animatedTokens = useAnimatedNumber(displayTokens);

  if (!user) return null;

  return (
    <div className={`${heading.variable} ${monoFont.variable} min-h-screen bg-background pb-16 md:pb-0`}>
      <Navbar />

      <motion.div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"
        variants={stagger} initial="hidden" animate="visible">

        {/* ═══ 欢迎头部 ═══ */}
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="flex items-center gap-5">
              {/* 头像 */}
              <div className="relative size-16 sm:size-20 rounded-full bg-muted flex items-center justify-center ring-1 ring-border">
                <span className={`${heading.className} text-2xl sm:text-3xl font-bold text-foreground`}>
                  {(user.name || user.email)[0].toUpperCase()}
                </span>
              </div>
              <div className="space-y-2">
                <h1 className={`${heading.className} text-2xl sm:text-3xl font-bold tracking-tight`}>
                  欢迎回来，{user.name || "用户"}
                </h1>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  <Badge variant={isPro ? "default" : "secondary"} className="gap-1">
                    {isPro && <Crown className="size-3" />} {user.plan_name || "免费版"}
                  </Badge>
                  {user?.subscription_expires_at ? (
                    <Badge variant="secondary" className="text-[11px] gap-1">
                      {(user.created_at || "").slice(0, 10)} ~ {user.subscription_expires_at.slice(0, 10)}
                    </Badge>
                  ) : user?.plan_name && user.plan_name !== "免费版" ? (
                    <Badge variant="secondary" className="text-[11px]">永久</Badge>
                  ) : null}
                  <Badge variant="default" className="text-[11px] gap-1">
                    <Coins className="size-3" /> {user.points || 0} 积分
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              <Button onClick={() => setUpgradeOpen(true)} className="gap-1.5">
                {isPro ? "管理订阅" : "升级套餐"} <ArrowUpRight className="size-3.5" />
              </Button>
              <Button variant="outline" onClick={() => setLogoutOpen(true)} className="gap-1.5" aria-label="退出登录">
                <LogOut className="size-3.5" /> <span className="hidden sm:inline">退出</span>
              </Button>
            </div>
          </div>
        </motion.div>

        {/* ═══ 令牌仪表盘 ═══ */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 令牌主卡 — 跨两列 */}
          <div className="sm:col-span-2 rounded-2xl border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Battery className="size-5 text-primary" />
                </div>
                <div>
                  <p className={`${heading.className} text-sm font-semibold`}>令牌余额</p>
                  <p className="text-xs text-muted-foreground">每小时恢复 {refill} 个</p>
                </div>
              </div>
              <span className={`${monoFont.className} text-2xl font-medium tabular-nums ${pct < 0.15 ? "text-destructive animate-pulse" : "text-foreground"}`}>
                {animatedTokens.toFixed(2)}
              </span>
            </div>
            <div className="space-y-1.5">
              <Progress value={pct * 100} className="h-2.5 rounded-full" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>已用 {(capacity - displayTokens).toFixed(2)}</span>
                <span className={`${monoFont.className} tabular-nums`}>{displayTokens.toFixed(2)} / {capacity}</span>
              </div>
              {/* 突发令牌条 */}
              {burst > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(burst / capacity * 100, 100)}%` }} />
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">突发 +{burst.toFixed(1)}</TooltipTrigger>
                      <TooltipContent side="top">优先消耗突发令牌，用完后再消耗额度</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
              {burst > 0 && <p className="text-[10px] text-muted-foreground/60 -mt-0.5">优先使用突发令牌，额度不受影响</p>}
              {exchangeRate > 0 && (
                <div className="pt-2 flex items-center justify-between border-t border-border mt-3">
                  <span className="text-xs text-muted-foreground">
                    <Coins className="size-3 inline -mt-px mr-1" />
                    {user?.points ?? 0} 积分
                  </span>
                  <button onClick={() => setExchangeOpen(true)}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                    兑换突发 <Zap className="size-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 指标卡 */}
          <StatCard icon={<Zap className="size-4" />} label="恢复速率" value={`${refill}`} unit="/小时" />
          <StatCard icon={<Layers className="size-4" />} label="并发任务" value={`${concurrency}`} unit="并发" />
        </motion.div>

        {/* 下个令牌倒计时 */}
        {cd?.nextHMS && (
          <motion.div variants={fadeUp} className="flex items-center gap-2 px-1">
            <Timer className="size-3.5 text-muted-foreground" />
            <span className={`${monoFont.className} text-xs text-muted-foreground`}>
              下个令牌恢复: <span className="text-foreground font-medium">{cd.nextHMS}</span>
            </span>
          </motion.div>
        )}

        {/* ═══ 功能区 Tabs ═══ */}
        <motion.div variants={fadeUp}>
          <Tabs defaultValue="keys" className="gap-5">
            <TabsList className="max-w-full overflow-x-auto scrollbar-hide flex-nowrap">
              <TabsTab value="keys">API 密钥</TabsTab>
              <TabsTab value="rewards">优惠与兑换</TabsTab>
              <TabsTab value="invite">邀请好友</TabsTab>
              <TabsTab value="checkin">每日签到</TabsTab>
              <TabsTab value="stats">用量统计</TabsTab>
              <TabsTab value="account">账号设置</TabsTab>
            </TabsList>

            {/* ── API 密钥 ── */}
            <TabsPanel value="keys">
              <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <div className="flex items-center gap-2">
                    <Key className="size-4 text-muted-foreground" />
                    <span className={`${heading.className} text-sm font-semibold`}>API 密钥</span>
                    <Badge variant="outline" className="ml-1">{keys.length}</Badge>
                  </div>
                  <a href="/docs" target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowUpRight className="size-3.5" /> 接口文档
                  </a>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                      placeholder="密钥名称（可选）" className="flex-1"
                      onKeyDown={e => e.key === "Enter" && createKey()} />
                    <Button onClick={createKey} className="gap-1 shrink-0"><Plus /> 创建</Button>
                  </div>
                  {keys.length === 0 ? (
                    <div className="py-12 text-center">
                      <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                        <Key className="size-6 text-muted-foreground/50" />
                      </div>
                      <p className="text-sm text-muted-foreground">暂无 API 密钥</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">创建密钥后可在外部应用中调用生图接口</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {keys.map((k: any) => (
                        <div key={k.id} className="group relative flex items-center justify-between gap-3 p-4 rounded-xl border bg-background hover:bg-muted/30 transition-all duration-200 hover:shadow-sm">
                          {/* hover 微光 */}
                          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/[0.03] to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                          </div>
                          <div className="relative min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{k.name}</p>
                              {k.enabled === false && <Badge variant="destructive" className="h-4 text-[10px]">已禁用</Badge>}
                            </div>
                            <code className={`${monoFont.className} text-xs text-muted-foreground block truncate`}>{k.api_key}</code>
                            {k.last_used_at && <p className="text-[11px] text-muted-foreground/60">最近使用 {k.last_used_at.slice(0, 16).replace("T", " ")}</p>}
                          </div>
                          <div className="relative flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon-sm" onClick={() => copyKey(k.api_key)} title="复制">
                              {copied === k.api_key ? <Check className="text-foreground" /> : <Copy />}
                            </Button>
                            <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => setDeleteId(k.id)} title="删除">
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsPanel>

            {/* ── 优惠与兑换 ── */}
            <TabsPanel value="rewards">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border bg-card p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                      <Ticket className="size-4 text-muted-foreground" />
                    </div>
                    <span className={`${heading.className} text-sm font-semibold`}>领取优惠券</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input value={claimCode} onChange={e => setClaimCode(e.target.value)} placeholder="输入优惠券码" className="flex-1" onKeyDown={e => e.key === "Enter" && claimCoupon()} />
                    <Button onClick={claimCoupon} disabled={claiming} className="shrink-0">{claiming ? "…" : "领取"}</Button>
                  </div>
                  {userCoupons.length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                      {userCoupons.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border bg-background">
                          <div className="min-w-0">
                            <p className={`${monoFont.className} text-sm font-medium truncate`}>{c.code}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{couponDesc(c)}</p>
                          </div>
                          <Badge variant={c.status === "used" ? "secondary" : c.status === "expired" ? "destructive" : "outline"}>
                            {c.status === "used" ? "已使用" : c.status === "expired" ? "已过期" : "可用"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground text-center py-4">暂无优惠券</p>}
                </div>

                <div className="rounded-2xl border bg-card p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                      <Gift className="size-4 text-muted-foreground" />
                    </div>
                    <span className={`${heading.className} text-sm font-semibold`}>兑换码</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input value={redeemCode} onChange={e => setRedeemCode(e.target.value)} placeholder="输入兑换码" className="flex-1" onKeyDown={e => e.key === "Enter" && doRedeem()} />
                    <Button onClick={doRedeem} disabled={redeeming} className="shrink-0">{redeeming ? "…" : "兑换"}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">兑换套餐时长或积分，成功后即时到账。</p>
                </div>
              </div>
            </TabsPanel>

            {/* ── 邀请好友 ── */}
            <TabsPanel value="invite">
              <InviteCard />
            </TabsPanel>

            {/* ── 每日签到 ── */}
            <TabsPanel value="checkin">
              <div className="rounded-2xl border bg-card p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-muted flex items-center justify-center">
                      <RefreshCw className={`size-5 text-muted-foreground ${checkin?.done ? "" : "animate-spin"}`} style={{ animationDuration: "3s" }} />
                    </div>
                    <div>
                      <p className={`${heading.className} text-sm font-semibold`}>每日签到</p>
                      <p className="text-xs text-muted-foreground">
                        {checkin?.enabled === false ? "签到功能暂未开放" : `已连续签到 ${checkin?.streak || 0} 天`}
                      </p>
                    </div>
                  </div>
                  <Button disabled={!checkin || checkin.done || checkin.enabled === false} onClick={doCheckin}>
                    {checkin?.done ? "今日已签到 ✓" : "立即签到"}
                  </Button>
                </div>

                <StreakBar streak={checkin?.streak || 0} done={!!checkin?.done} />

                {checkin && (checkin.base > 0 || checkin.bonus > 0) && (
                  <p className="text-xs text-muted-foreground">基础 +{checkin.base || 0} 积分 · 连续奖励 +{checkin.bonus || 0} 积分/天</p>
                )}
              </div>
            </TabsPanel>

            {/* ── 用量统计 ── */}
            <TabsPanel value="stats">
              {userStats ? (
                <div className="space-y-4">
                  {/* 概览指标 */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border bg-card p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <BarChart3 className="size-3.5" />
                        <span className="text-[11px]">累计生成</span>
                      </div>
                      <p className={`${monoFont.className} text-xl font-semibold tabular-nums`}>{userStats.stats?.total_generations ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">成功 {userStats.stats?.total_success ?? 0} · 失败 {userStats.stats?.total_failed ?? 0}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <CalendarDays className="size-3.5" />
                        <span className="text-[11px]">今日</span>
                      </div>
                      <p className={`${monoFont.className} text-xl font-semibold tabular-nums`}>{userStats.stats?.today_generations ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">张图片</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Activity className="size-3.5" />
                        <span className="text-[11px]">本周</span>
                      </div>
                      <p className={`${monoFont.className} text-xl font-semibold tabular-nums`}>{userStats.stats?.week_generations ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">张图片</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <TrendingUp className="size-3.5" />
                        <span className="text-[11px]">今日成功率</span>
                      </div>
                      <p className={`${monoFont.className} text-xl font-semibold tabular-nums`}>
                        {userStats.success_rate?.toFixed?.(1) ?? 100}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {userStats.stats?.today_generations > 0 ? "今日可用" : "今日暂无生成"}
                      </p>
                    </div>
                  </div>

                  {/* 趋势图 */}
                  <div className="rounded-xl border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-lg bg-muted flex items-center justify-center">
                          <TrendingUp className="size-3.5 text-muted-foreground" />
                        </div>
                        <span className={`${heading.className} text-sm font-semibold`}>近 7 天趋势</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{userStats.trends?.length ?? 0} 天</span>
                    </div>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={userStats.trends || []} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                          <defs>
                            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(263 70% 60%)" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="hsl(263 70% 60%)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                          <RechartsTooltip
                            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(240 5% 84%)", background: "hsl(0 0% 100%)" }}
                            labelStyle={{ fontWeight: 600 }}
                            formatter={(val: any) => [`${val} 张`, "生成数"]} />
                          <Area type="monotone" dataKey="value" stroke="hsl(263 70% 60%)" strokeWidth={2}
                            fill="url(#trendGrad)" animationDuration={800} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 令牌状态 */}
                  <div className="rounded-xl border bg-card p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-lg bg-muted flex items-center justify-center">
                        <Battery className="size-3.5 text-muted-foreground" />
                      </div>
                      <span className={`${heading.className} text-sm font-semibold`}>配额状态</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>当前令牌</span>
                          <span className={`${monoFont.className} tabular-nums`}>{userStats.tokens?.toFixed?.(2) ?? 0} / {userStats.capacity ?? 50}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${Math.min((userStats.tokens ?? 0) / (userStats.capacity ?? 50) * 100, 100)}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-4 shrink-0">
                        <div className="text-left sm:text-right">
                          <p className={`${monoFont.className} text-lg font-semibold tabular-nums`}>{userStats.refill ?? 3}</p>
                          <p className="text-[10px] text-muted-foreground">/小时恢复</p>
                        </div>
                        <div className="text-right">
                          <p className={`${monoFont.className} text-lg font-semibold tabular-nums truncate max-w-[120px]`}>{userStats.plan_name || "免费版"}</p>
                          <p className="text-[10px] text-muted-foreground">{userStats.plan_name && userStats.plan_name !== "免费版" ? "当前套餐" : ""}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-16 text-muted-foreground">
                  <BarChart3 className="size-10 mb-3 opacity-30" />
                  <p className="text-sm">加载中…</p>
                </div>
              )}
            </TabsPanel>

            {/* ── 账号设置 ── */}
            <TabsPanel value="account">
              <div className="rounded-2xl border bg-card p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-muted flex items-center justify-center">
                    <Key className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className={`${heading.className} text-sm font-semibold`}>修改密码</p>
                    <p className="text-xs text-muted-foreground">设置新的登录密码</p>
                  </div>
                </div>
                <div className="space-y-4 max-w-sm">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">当前密码</label>
                    <Input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="输入当前密码" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">新密码</label>
                    <Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少 6 位" />
                  </div>
                  <Button onClick={doChangePwd} disabled={changingPwd || !oldPwd || !newPwd || newPwd.length < 6}>
                    {changingPwd ? "修改中..." : "修改密码"}
                  </Button>
                </div>
              </div>
            </TabsPanel>
          </Tabs>
        </motion.div>
      </motion.div>

      <ConfirmDialog open={deleteId != null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="删除 API 密钥" description="删除后使用该密钥的应用将立即失效，此操作不可撤销。"
        confirmLabel="删除" variant="destructive" onConfirm={deleteKey} />
      <ConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen}
        title="退出登录" description="确定要退出当前账号吗？"
        confirmLabel="退出登录" onConfirm={() => { logout(); router.push("/"); }} />
      <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)}
        currentPlanName={user.plan_name || ""} currentPlanId={(user as any).plan_id || 0} />

      {/* ═══ 积分兑换突发令牌 ═══ */}
      <Dialog open={exchangeOpen} onOpenChange={setExchangeOpen}>
        <DialogContent className="sm:max-w-sm">
          <div className="p-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                <Zap className="size-5 text-amber-500" />
              </div>
              <div>
                <h3 className={`${heading.className} text-sm font-semibold`}>兑换突发令牌</h3>
                <p className="text-xs text-muted-foreground">积分 → 突发令牌（不受上限限制）</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1.5">兑换数量</label>
                <div className="flex items-center gap-1">
                  {[10, 20, 50, 100].map(n => (
                    <button key={n} onClick={() => setExchangeTokens(n)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                        exchangeTokens === n
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}>
                      {n}
                    </button>
                  ))}
                </div>
                <Input type="number" min={1} value={exchangeTokens} onChange={e => setExchangeTokens(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-2 text-center" />
              </div>
            </div>

            <div className="rounded-xl bg-muted/50 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">需消耗积分</span>
                <span className="font-medium tabular-nums">{exchangeTokens * exchangeRate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">获得突发令牌</span>
                <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">
                  {exchangeTokens}{exchangeBonus > 0 && exchangeTokens >= 50 ? ` + ${exchangeBonus * Math.floor(exchangeTokens / 50)} 奖励` : ""}
                </span>
              </div>
              {exchangeBonus > 0 && (
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>兑换 ≥50 额外赠送</span>
                  <span>每 50 个 +{exchangeBonus}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-border">
                <span className="text-muted-foreground">当前积分</span>
                <span className="font-medium tabular-nums">{user?.points ?? 0}</span>
              </div>
            </div>

            <Button onClick={doExchange} disabled={exchanging || exchangeTokens <= 0 || (user?.points ?? 0) < exchangeTokens * exchangeRate}
              className="w-full gap-1.5">
              {exchanging ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              {exchanging ? "兑换中..." : "确认兑换"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── 指标卡 ─────────────────────────────────── */

function StatCard({ icon, label, value, unit }: {
  icon: React.ReactNode; label: string; value: string; unit: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3 hover:shadow-sm transition-shadow">
      <div className="size-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`${monoFont.className} text-2xl font-medium tabular-nums mt-0.5`}>
          {value}<span className="text-sm text-muted-foreground ml-1">{unit}</span>
        </p>
      </div>
    </div>
  );
}

/* ── 优惠券描述 ─────────────────────────────── */

function couponDesc(c: any): string {
  if (c.discount_type === "percent") return `${c.discount_value} 折优惠`;
  if (c.discount_type === "fixed") return `立减 ¥${c.discount_value}`;
  return c.code;
}

function StreakBar({ streak, done }: { streak: number; done: boolean }) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  return (
    <div className="flex items-center gap-2">
      {days.map((d, i) => {
        const isToday = i === todayIdx;
        const filled = i < todayIdx
          ? done && i >= todayIdx - (done ? streak - 1 : streak)
          : isToday && done;
        return (
          <motion.div key={i}
            initial={filled ? { scale: 0.8 } : false}
            animate={filled ? { scale: 1 } : {}}
            transition={{ type: "spring", stiffness: 400, damping: 15, delay: i * 0.05 }}
            className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              filled ? "bg-primary text-primary-foreground shadow-sm"
              : isToday ? "bg-muted text-foreground ring-1 ring-primary/30"
              : "bg-muted/50 text-muted-foreground"
            }`}>
            {filled ? <Check className="size-4" /> : <span className="size-4 flex items-center justify-center">{isToday && !done ? "●" : "○"}</span>}
            <span className="text-[10px]">{d}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
