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
import { toast } from "sonner";
import {
  Copy, Check, Key, Plus, Trash2, Zap, Gift, Ticket,
  RefreshCw, Coins, Battery, Layers, Timer, Crown, ArrowUpRight, LogOut,
} from "lucide-react";

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
  const { user, token, loading: authLoading, logout } = useAuth();
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

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { router.push("/login"); return; }
    fetchKeys(); fetchTokens(); fetchCheckin(); fetchCoupons();
    const iv = setInterval(fetchTokens, 15000);
    return () => clearInterval(iv);
  }, [user, token, authLoading]);

  const fetchKeys = async () => { try { const r = await api("/api/user/keys"); setKeys(r.data || []); } catch {} };
  const fetchTokens = async () => { try { const r = await api("/api/user/tokens"); if (r.data?.tokens !== undefined) setTokens(r.data.tokens); } catch {} };
  const fetchCheckin = async () => { try { const r = await api("/api/user/checkin/status"); setCheckin(r.data); } catch {} };
  const fetchCoupons = async () => { try { const r = await api("/api/user/coupons"); setUserCoupons(r.data || []); } catch {} };

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
  const displayTokens = cd?.est ?? tokenVal;
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
                <div className="flex items-center gap-2.5 pt-0.5">
                  <Badge variant={isPro ? "default" : "secondary"} className="gap-1">
                    {isPro && <Crown className="size-3" />} {user.plan_name || "免费版"}
                  </Badge>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Coins className="size-3" /> {user.points || 0} 积分
                  </span>
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
            <div className="space-y-2">
              <Progress value={pct * 100} className="h-2.5 rounded-full" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>已用 {(capacity - displayTokens).toFixed(2)}</span>
                <span className={`${monoFont.className} tabular-nums`}>{displayTokens.toFixed(2)} / {capacity}</span>
              </div>
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
            <TabsList>
              <TabsTab value="keys">API 密钥</TabsTab>
              <TabsTab value="rewards">优惠与兑换</TabsTab>
              <TabsTab value="checkin">每日签到</TabsTab>
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

/* ── 签到进度条 ─────────────────────────────── */

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
