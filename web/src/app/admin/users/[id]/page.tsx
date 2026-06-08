"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  ArrowLeft, Crown, Coins, Zap, Image as ImageIcon,
  Wallet, Users as UsersIcon, Key, Ticket, Receipt, Sparkles, CheckCircle2, XCircle, Activity,
} from "lucide-react";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { imageProxyUrl } from "@/lib/utils";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTip } from "@/components/ui/icon-tip";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const GRADS = ["from-cyan-500 to-blue-500", "from-violet-500 to-purple-500", "from-amber-500 to-orange-500", "from-emerald-500 to-teal-500", "from-pink-500 to-rose-500"];
function grad(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return GRADS[Math.abs(h) % GRADS.length]; }
const fmtDate = (s?: string) => s ? s.slice(0, 19).replace("T", " ") : "—";
const fmtDay = (s?: string) => s ? s.slice(0, 10) : "—";

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api(`/api/admin/users/${id}/profile`)
      .then((r: any) => setData(r.data))
      .catch((e: any) => toast.error(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );
  if (!data?.user) return (
    <div className="h-screen bg-background flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">用户不存在</p>
      <Button variant="outline" onClick={() => router.push("/admin/users")}>返回用户列表</Button>
    </div>
  );
  const u = data.user;
  const stats = data.stats || {};
  const trends = (data.trends || []).map((t: any) => ({ date: t.date, value: t.value }));
  const expired = u.subscription_expires_at && new Date(u.subscription_expires_at) < new Date();

  const metric = (icon: any, label: string, value: any, color: string) => {
    const Icon = icon;
    return (
      <div className="rounded-xl border bg-card p-3.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5"><Icon className={`size-3.5 ${color}`} /> {label}</div>
        <div className={`${mono.className} text-xl font-bold tabular-nums`}>{value}</div>
      </div>
    );
  };

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center gap-3 shrink-0">
          <IconTip label="返回"><Button variant="ghost" size="icon-sm" onClick={() => router.push("/admin/users")}><ArrowLeft className="size-4" /></Button></IconTip>
          <div className={`size-10 rounded-xl bg-gradient-to-br ${grad(u.email || "")} flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0`}>
            {(u.name || u.email || "?")[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight flex items-center gap-2`}>
              {u.name || "未命名"}
              {u.is_super_admin ? <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-0.5 px-1.5"><Crown className="size-2.5" />超管</Badge>
                : u.role >= 1 ? <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5">管理员</Badge> : null}
              <span className={`text-[11px] font-medium ${u.status ? "text-emerald-500" : "text-red-500"}`}>{u.status ? "● 正常" : "● 禁用"}</span>
            </h1>
            <p className={`${mono.className} text-[11px] text-muted-foreground truncate`}>{u.email} · ID {u.id}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-5">
          {/* 核心指标 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metric(Coins, "积分余额", u.points ?? 0, "text-amber-500")}
            {metric(Sparkles, "令牌余额", Math.floor(data.token_normal ?? 0), "text-cyan-500")}
            {metric(Zap, "突发令牌", Math.floor(data.token_burst ?? 0), "text-violet-500")}
            {metric(ImageIcon, "累计生图", stats.total_generations ?? 0, "text-blue-500")}
            {metric(Wallet, "累计消费", `¥${(data.spend_amount ?? 0).toFixed(2)}`, "text-emerald-500")}
            {metric(UsersIcon, "邀请人数", data.invite_count ?? 0, "text-pink-500")}
          </div>

          {/* 账号信息 + 订阅 */}
          <section className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b"><h2 className={`${heading.className} text-sm font-semibold`}>账号信息</h2></div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {[
                ["套餐", u.plan_name || "无套餐"],
                ["订阅到期", u.subscription_expires_at ? <span className={expired ? "text-red-500" : ""}>{fmtDay(u.subscription_expires_at)}{expired ? "（已过期）" : ""}</span> : "永久 / 无"],
                ["令牌容量", `${u.token_capacity} / 每小时恢复 ${u.token_refill_per_hour}`],
                ["并发上限", u.plan_concurrency ?? "—"],
                ["注册时间", fmtDay(u.created_at)],
                ["邀请奖励累计", `${data.invite_reward ?? 0} 积分`],
              ].map(([k, v]: any, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-dashed border-border/60 pb-2">
                  <span className="text-muted-foreground text-xs">{k}</span>
                  <span className="font-medium text-right">{v}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 生图趋势 */}
          <section className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h2 className={`${heading.className} text-sm font-semibold`}>近 14 天生图趋势</h2>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="size-3 text-emerald-500" />成功 {stats.total_success ?? 0}</span>
                <span className="flex items-center gap-1"><XCircle className="size-3 text-red-500" />失败 {stats.total_failed ?? 0}</span>
                <span className="flex items-center gap-1"><Activity className="size-3 text-primary" />今日成功率 {Math.round(data.today_rate ?? 0)}%</span>
              </div>
            </div>
            <div className="p-5 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} /><stop offset="100%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2} fill="url(#g)" name="生图数" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* 最近作品 */}
          {data.generations?.length > 0 && (
            <section className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center justify-between">
                <h2 className={`${heading.className} text-sm font-semibold`}>最近作品</h2>
                <span className="text-[11px] text-muted-foreground">共 {data.generation_total} 张</span>
              </div>
              <div className="p-5 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {data.generations.map((g: any) => (
                  <div key={g.id} className="aspect-square rounded-lg overflow-hidden bg-muted relative group" title={g.prompt}>
                    {g.status === "completed" ? (
                      <img src={imageProxyUrl(g)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><XCircle className="size-5 text-muted-foreground/40" /></div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 订单 + API Key 两栏 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center gap-2"><Receipt className="size-4 text-emerald-500" /><h2 className={`${heading.className} text-sm font-semibold`}>最近订单</h2><span className="text-[11px] text-muted-foreground ml-auto">共 {data.order_total} 笔 · 已付 {data.spend_count}</span></div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {data.orders?.length ? data.orders.map((o: any) => (
                  <div key={o.id} className="px-5 py-2.5 flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{o.plan_name || "—"}</p>
                      <p className={`${mono.className} text-[10px] text-muted-foreground truncate`}>{o.order_no} · {fmtDay(o.created_at)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className={`${mono.className} font-medium tabular-nums`}>¥{o.amount}</p>
                      <p className={`text-[10px] ${o.status === "paid" ? "text-emerald-500" : o.status === "pending" ? "text-amber-500" : "text-muted-foreground"}`}>{o.status}</p>
                    </div>
                  </div>
                )) : <p className="px-5 py-6 text-center text-xs text-muted-foreground">暂无订单</p>}
              </div>
            </section>

            <section className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center gap-2"><Key className="size-4 text-primary" /><h2 className={`${heading.className} text-sm font-semibold`}>API Key</h2><span className="text-[11px] text-muted-foreground ml-auto">{data.api_keys?.length || 0} 个</span></div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {data.api_keys?.length ? data.api_keys.map((k: any) => (
                  <div key={k.id} className="px-5 py-2.5 flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{k.name}</p>
                      <p className={`${mono.className} text-[10px] text-muted-foreground truncate`}>{k.api_key}</p>
                    </div>
                    <span className={`text-[10px] shrink-0 ${k.enabled ? "text-emerald-500" : "text-muted-foreground"}`}>{k.enabled ? "启用" : "禁用"}</span>
                  </div>
                )) : <p className="px-5 py-6 text-center text-xs text-muted-foreground">暂无 Key</p>}
              </div>
            </section>
          </div>

          {/* 邀请 + 兑换/优惠券 两栏 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center gap-2"><UsersIcon className="size-4 text-pink-500" /><h2 className={`${heading.className} text-sm font-semibold`}>邀请的用户</h2><span className="text-[11px] text-muted-foreground ml-auto">{data.invite_count} 人 · 奖励 {data.invite_reward} 积分</span></div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {data.invitees?.length ? data.invitees.map((it: any, i: number) => (
                  <div key={i} className="px-5 py-2.5 flex items-center justify-between text-xs">
                    <span className={`${mono.className} truncate`}>{it.masked_email}</span>
                    <span className="shrink-0 ml-2 flex items-center gap-2">
                      <span className="text-muted-foreground">+{it.reward_register + it.reward_recharge}</span>
                      {it.recharged && <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 px-1.5 text-[10px]">已充值</Badge>}
                    </span>
                  </div>
                )) : <p className="px-5 py-6 text-center text-xs text-muted-foreground">暂无邀请</p>}
              </div>
            </section>

            <section className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center gap-2"><Ticket className="size-4 text-violet-500" /><h2 className={`${heading.className} text-sm font-semibold`}>优惠券 / 兑换记录</h2></div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {data.coupons?.map((c: any) => (
                  <div key={`c${c.id}`} className="px-5 py-2.5 flex items-center justify-between text-xs">
                    <span className={`${mono.className} truncate`}>🎟 {c.code}</span>
                    <span className={`text-[10px] shrink-0 ml-2 ${c.status === "active" ? "text-emerald-500" : "text-muted-foreground"}`}>{c.status}</span>
                  </div>
                ))}
                {data.redeems?.map((rd: any) => (
                  <div key={`r${rd.id}`} className="px-5 py-2.5 flex items-center justify-between text-xs">
                    <span className={`${mono.className} truncate`}>🎫 {rd.code}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{rd.value || rd.type}</span>
                  </div>
                ))}
                {!data.coupons?.length && !data.redeems?.length && <p className="px-5 py-6 text-center text-xs text-muted-foreground">暂无记录</p>}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

