"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Key, Plus, Copy, Check, Power, Trash2, ArrowUpRight, Ticket, Gift, Coins, Loader2,
  RefreshCw, BarChart3, CalendarDays, Activity, TrendingUp, Battery, Webhook, AlertTriangle, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel } from "@/components/ui/tabs";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip } from "recharts";
import { fadeUp, couponDesc, pointsTypeLabel, formatLogTime } from "../lib/helpers";
import { StreakBar } from "./StatCard";
import { InviteCard } from "@/components/invite-card";

const CARD = "rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl";
const SUBCARD = "rounded-xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/40 dark:bg-white/[0.03]";

type Props = {
  user: any;
  keys: any[]; copied: string | null; newKeyName: string; setNewKeyName: (v: string) => void;
  onCreateKey: () => void; copyKey: (k: string) => void; toggleKey: (k: any) => void; setDeleteId: (id: number) => void;
  claimCode: string; setClaimCode: (v: string) => void; claiming: boolean; onClaimCoupon: () => void; userCoupons: any[];
  redeemCode: string; setRedeemCode: (v: string) => void; redeeming: boolean; onRedeem: () => void;
  pointsLogs: any[]; pointsLogsLoaded: boolean; fetchPointsLogs: () => void;
  checkin: any; doCheckin: () => void;
  userStats: any;
  webhook: any; webhookLoaded: boolean; fetchWebhook: () => void;
  onSaveWebhook: (url: string, secret: string, enabled: boolean) => void; onDeleteWebhook: () => void; savingWebhook: boolean;
  oldPwd: string; setOldPwd: (v: string) => void; newPwd: string; setNewPwd: (v: string) => void; changingPwd: boolean; onChangePwd: () => void;
};

export function AccountTabs(p: Props) {
  const {
    user, keys, copied, newKeyName, setNewKeyName, onCreateKey, copyKey, toggleKey, setDeleteId,
    claimCode, setClaimCode, claiming, onClaimCoupon, userCoupons,
    redeemCode, setRedeemCode, redeeming, onRedeem,
    pointsLogs, pointsLogsLoaded, fetchPointsLogs, checkin, doCheckin, userStats,
    webhook, webhookLoaded, fetchWebhook, onSaveWebhook, onDeleteWebhook, savingWebhook,
    oldPwd, setOldPwd, newPwd, setNewPwd, changingPwd, onChangePwd,
  } = p;

  // Webhook 表单本地态：从拉取到的配置初始化（secret 不回显，留空=不修改）
  const [whUrl, setWhUrl] = useState("");
  const [whSecret, setWhSecret] = useState("");
  const [whEnabled, setWhEnabled] = useState(true);
  const [whSecretShown, setWhSecretShown] = useState(false); // 刚生成时明文展示，便于复制保存
  useEffect(() => {
    if (webhook) {
      setWhUrl(webhook.url || "");
      setWhEnabled(webhook.enabled !== false);
    }
  }, [webhook]);

  // 生成一个高强度随机密钥（32 字节 → 64 位 hex），用浏览器 crypto，避免可预测
  const genWebhookSecret = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    setWhSecret(hex);
    setWhSecretShown(true); // 生成后明文显示，提醒用户复制（保存后将无法再查看）
  };

  return (
    <motion.div variants={fadeUp}>
      <Tabs defaultValue="keys" className="gap-5" onValueChange={(v) => { if (v === "points" && !pointsLogsLoaded) fetchPointsLogs(); if (v === "webhook" && !webhookLoaded) fetchWebhook(); }}>
        <TabsList className="max-w-full overflow-x-auto scrollbar-hide flex-nowrap">
          <TabsIndicator />
          <TabsTab value="keys">API 密钥</TabsTab>
          <TabsTab value="webhook">Webhook</TabsTab>
          <TabsTab value="rewards">优惠与兑换</TabsTab>
          <TabsTab value="points">积分明细</TabsTab>
          <TabsTab value="invite">邀请好友</TabsTab>
          <TabsTab value="checkin">每日签到</TabsTab>
          <TabsTab value="stats">用量统计</TabsTab>
          <TabsTab value="account">账号设置</TabsTab>
        </TabsList>

        {/* ── API 密钥 ── */}
        <TabsPanel value="keys">
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900/[0.06] dark:border-white/10">
              <div className="flex items-center gap-2">
                <Key className="size-4 text-zinc-500 dark:text-white/55" />
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">API 密钥</span>
                <Badge variant="outline" className="ml-1">{keys.length}</Badge>
              </div>
              <a href="/docs" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white transition-colors">
                <ArrowUpRight className="size-3.5" /> 接口文档
              </a>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  placeholder="密钥名称（可选）" className="flex-1"
                  onKeyDown={e => e.key === "Enter" && onCreateKey()} />
                <Button onClick={onCreateKey} className="gap-1 shrink-0"><Plus /> 创建</Button>
              </div>
              {keys.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="size-14 rounded-2xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center mx-auto mb-3">
                    <Key className="size-6 text-zinc-400 dark:text-white/40" />
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-white/55">暂无 API 密钥</p>
                  <p className="text-xs text-zinc-400 dark:text-white/40 mt-1">创建密钥后可在外部应用中调用生图接口</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {keys.map((k: any) => (
                    <div key={k.id} className={`group relative flex items-center justify-between gap-3 p-4 ${SUBCARD} hover:bg-white/70 dark:hover:bg-white/[0.06] transition-all duration-200`}>
                      <div className="relative min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate text-zinc-900 dark:text-white">{k.name}</p>
                          {k.enabled === false && <Badge variant="destructive" className="h-4 text-[10px]">已禁用</Badge>}
                        </div>
                        <code className="text-xs text-zinc-500 dark:text-white/50 block truncate">{k.api_key}</code>
                        {k.last_used_at && <p className="text-[11px] text-zinc-400 dark:text-white/40">最近使用 {formatLogTime(k.last_used_at)}</p>}
                      </div>
                      <div className="relative flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon-sm" onClick={() => copyKey(k.api_key)} title="复制">
                          {copied === k.api_key ? <Check className="text-zinc-900 dark:text-white" /> : <Copy />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => toggleKey(k)} title={k.enabled === false ? "启用" : "禁用"}
                          className={k.enabled === false ? "text-emerald-500 hover:text-emerald-600" : "hover:text-amber-500"}>
                          <Power />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="hover:text-red-500" onClick={() => setDeleteId(k.id)} title="删除">
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

        {/* ── Webhook ── */}
        <TabsPanel value="webhook">
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900/[0.06] dark:border-white/10">
              <div className="flex items-center gap-2">
                <Webhook className="size-4 text-zinc-500 dark:text-white/55" />
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">Webhook 回调</span>
                {webhook?.url && (whEnabled
                  ? <Badge variant="outline" className="ml-1 text-emerald-600 dark:text-emerald-400">已启用</Badge>
                  : <Badge variant="outline" className="ml-1">已停用</Badge>)}
              </div>
              <a href="/docs#webhook" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white transition-colors">
                <ArrowUpRight className="size-3.5" /> 接口文档
              </a>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-xs text-zinc-500 dark:text-white/55 leading-relaxed">
                用 API Key 提交的<strong className="text-zinc-700 dark:text-white/75">异步生图</strong>任务完成或失败时，我们会向你的地址发送一条 POST 通知，省去轮询。仅对 <code className="font-mono px-1 py-0.5 rounded bg-zinc-900/[0.05] dark:bg-white/[0.08]">/api/v1/images/generations</code> 生效。
              </p>

              {/* 回调地址 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-white/60">回调地址</label>
                <Input value={whUrl} onChange={e => setWhUrl(e.target.value)}
                  placeholder="https://your-server.com/webhook" type="url" />
                <p className="text-[11px] text-zinc-400 dark:text-white/40">必须是公网 https/http 地址，不支持内网/localhost。</p>
              </div>

              {/* 签名密钥 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-600 dark:text-white/60">签名密钥（可选）</label>
                  <button type="button" onClick={genWebhookSecret}
                    className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white transition-colors">
                    <RefreshCw className="size-3" /> 随机生成
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input value={whSecret} onChange={e => setWhSecret(e.target.value)}
                    placeholder={webhook?.has_secret ? "已设置（留空保持不变）" : "用于验证回调来源真伪"}
                    type={whSecretShown ? "text" : "password"} className="flex-1 font-mono" />
                  {whSecret && (
                    <Button variant="ghost" size="icon-sm" type="button" title={whSecretShown ? "隐藏" : "显示"}
                      onClick={() => setWhSecretShown(v => !v)}>
                      {whSecretShown ? <EyeOff /> : <Eye />}
                    </Button>
                  )}
                  {whSecret && (
                    <Button variant="ghost" size="icon-sm" type="button" title="复制"
                      onClick={() => copyKey(whSecret)}>
                      {copied === whSecret ? <Check className="text-emerald-500" /> : <Copy />}
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-white/40">设置后，回调请求头 <code className="font-mono">X-Webhook-Signature</code> 会带 HMAC-SHA256 签名（sha256=...），你可用此密钥校验请求体。{whSecretShown && whSecret && <span className="text-amber-500 dark:text-amber-400"> 请复制保存，保存后将无法再查看。</span>}</p>
              </div>

              {/* 启用开关 */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={whEnabled} onChange={e => setWhEnabled(e.target.checked)}
                  className="size-4 rounded border-zinc-300 dark:border-white/20 accent-zinc-900 dark:accent-white" />
                <span className="text-sm text-zinc-700 dark:text-white/75">启用回调通知</span>
              </label>

              {/* 最近投递结果 */}
              {webhook?.last_deliver_at && (
                <div className={`${SUBCARD} p-3.5 flex items-start gap-2.5`}>
                  {webhook.last_error
                    ? <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                    : <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" />}
                  <div className="min-w-0 text-xs space-y-0.5">
                    <p className="text-zinc-700 dark:text-white/75 font-medium">
                      最近投递：{webhook.last_error ? `失败` : `成功`}
                      {webhook.last_status ? ` (HTTP ${webhook.last_status})` : ""}
                    </p>
                    {webhook.last_error && <p className="text-zinc-500 dark:text-white/50 break-all">{webhook.last_error}</p>}
                    <p className="text-zinc-400 dark:text-white/40">{formatLogTime(webhook.last_deliver_at)}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={() => onSaveWebhook(whUrl, whSecret, whEnabled)} disabled={savingWebhook || !whUrl.trim()} className="gap-1">
                  {savingWebhook ? <Loader2 className="animate-spin" /> : <Check />} 保存
                </Button>
                {webhook?.url && (
                  <Button variant="ghost" onClick={onDeleteWebhook} disabled={savingWebhook} className="gap-1 hover:text-red-500">
                    <Trash2 /> 删除
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabsPanel>

        {/* ── 优惠与兑换 ── */}
        <TabsPanel value="rewards">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${CARD} p-6 space-y-4`}>
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <Ticket className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">领取优惠券</span>
              </div>
              <div className="flex items-center gap-2">
                <Input value={claimCode} onChange={e => setClaimCode(e.target.value)} placeholder="输入优惠券码" className="flex-1" onKeyDown={e => e.key === "Enter" && onClaimCoupon()} />
                <Button onClick={onClaimCoupon} disabled={claiming} className="shrink-0">{claiming ? "…" : "领取"}</Button>
              </div>
              {userCoupons.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                  {userCoupons.map((c: any) => (
                    <div key={c.id} className={`flex items-center justify-between gap-2 p-3 ${SUBCARD}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate text-zinc-900 dark:text-white">{c.code}</p>
                        <p className="text-xs text-zinc-500 dark:text-white/50 mt-0.5">{couponDesc(c)}</p>
                      </div>
                      <Badge variant={c.status === "used" ? "secondary" : c.status === "expired" ? "destructive" : "outline"}>
                        {c.status === "used" ? "已使用" : c.status === "expired" ? "已过期" : "可用"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-zinc-400 dark:text-white/40 text-center py-4">暂无优惠券</p>}
            </div>

            <div className={`${CARD} p-6 space-y-4`}>
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <Gift className="size-4 text-zinc-500 dark:text-white/55" />
                </div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">兑换码</span>
              </div>
              <div className="flex items-center gap-2">
                <Input value={redeemCode} onChange={e => setRedeemCode(e.target.value)} placeholder="输入兑换码" className="flex-1" onKeyDown={e => e.key === "Enter" && onRedeem()} />
                <Button onClick={onRedeem} disabled={redeeming} className="shrink-0">{redeeming ? "…" : "兑换"}</Button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-white/50 leading-relaxed">兑换套餐时长或积分，成功后即时到账。</p>
            </div>
          </div>
        </TabsPanel>

        {/* ── 积分明细 ── */}
        <TabsPanel value="points">
          <div className={`${CARD} p-6 space-y-4`}>
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                <Coins className="size-4 text-zinc-500 dark:text-white/55" />
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">积分流水</span>
              <Badge variant="outline" className="ml-auto gap-1">
                <Coins className="size-3" /> {user?.points ?? 0}
              </Badge>
            </div>
            {!pointsLogsLoaded ? (
              <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-zinc-400 dark:text-white/40" /></div>
            ) : pointsLogs.length > 0 ? (
              <div className="space-y-1.5 max-h-96 overflow-y-auto scrollbar-thin">
                {pointsLogs.map((l: any) => (
                  <div key={l.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${SUBCARD}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate text-zinc-900 dark:text-white">{l.remark || pointsTypeLabel(l.type)}</p>
                      <p className="text-xs text-zinc-500 dark:text-white/50 mt-0.5">{pointsTypeLabel(l.type)} · {formatLogTime(l.created_at)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold tabular-nums ${l.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {l.change >= 0 ? "+" : ""}{l.change}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-white/40 tabular-nums">余额 {l.balance}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-zinc-400 dark:text-white/40 text-center py-8">暂无积分记录</p>}
          </div>
        </TabsPanel>

        {/* ── 邀请好友 ── */}
        <TabsPanel value="invite">
          <InviteCard />
        </TabsPanel>

        {/* ── 每日签到 ── */}
        <TabsPanel value="checkin">
          <div className={`${CARD} p-6 space-y-5`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                  <RefreshCw className={`size-5 text-zinc-500 dark:text-white/55 ${checkin?.done ? "" : "animate-spin"}`} style={{ animationDuration: "3s" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">每日签到</p>
                  <p className="text-xs text-zinc-500 dark:text-white/50">
                    {checkin?.enabled === false ? "签到功能暂未开放" : `已连续签到 ${checkin?.streak || 0} 天`}
                  </p>
                </div>
              </div>
              <Button disabled={!checkin || checkin.done || checkin.enabled === false} onClick={doCheckin}>
                {checkin?.done ? "今日已签到 ✓" : "立即签到"}
              </Button>
            </div>
            <StreakBar streak={checkin?.streak || 0} done={!!checkin?.done} />
            {/* 图例：颜色含义说明 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500 dark:text-white/50">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-emerald-500" /> 今日已签</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-emerald-500/15 ring-1 ring-emerald-500/40" /> 今日待签</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-zinc-900 dark:bg-white" /> 往日已签</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-zinc-900/[0.06] dark:bg-white/10" /> 未签到</span>
            </div>
            {checkin && (checkin.base > 0 || checkin.bonus > 0) && (
              <p className="text-xs text-zinc-500 dark:text-white/50">基础 +{checkin.base || 0} 积分 · 连续奖励 +{checkin.bonus || 0} 积分/天</p>
            )}
          </div>
        </TabsPanel>

        {/* ── 用量统计 ── */}
        <TabsPanel value="stats">
          {userStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { icon: BarChart3, label: "累计生成", value: userStats.stats?.total_generations ?? 0, sub: `成功 ${userStats.stats?.total_success ?? 0} · 失败 ${userStats.stats?.total_failed ?? 0}` },
                  { icon: CalendarDays, label: "今日", value: userStats.stats?.today_generations ?? 0, sub: "张图片" },
                  { icon: Activity, label: "本周", value: userStats.stats?.week_generations ?? 0, sub: "张图片" },
                  { icon: TrendingUp, label: "今日成功率", value: `${userStats.success_rate?.toFixed?.(1) ?? 100}%`, sub: userStats.stats?.today_generations > 0 ? "今日可用" : "今日暂无生成" },
                ].map((m, i) => {
                  const Icon = m.icon;
                  return (
                    <div key={i} className={`${SUBCARD} p-4 space-y-1.5`}>
                      <div className="flex items-center gap-1.5 text-zinc-500 dark:text-white/50">
                        <Icon className="size-3.5" />
                        <span className="text-[11px]">{m.label}</span>
                      </div>
                      <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">{m.value}</p>
                      <p className="text-[10px] text-zinc-400 dark:text-white/40">{m.sub}</p>
                    </div>
                  );
                })}
              </div>

              {/* 趋势图 */}
              <div className={`${SUBCARD} p-5 space-y-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                      <TrendingUp className="size-3.5 text-zinc-500 dark:text-white/55" />
                    </div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-white">近 7 天趋势</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 dark:text-white/40">{userStats.trends?.length ?? 0} 天</span>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={userStats.trends || []} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(240 5% 64.9%)" }} axisLine={false} tickLine={false} />
                      <RechartsTooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                        itemStyle={{ color: "var(--popover-foreground)" }}
                        labelStyle={{ fontWeight: 600, color: "var(--popover-foreground)" }}
                        formatter={(val: any) => [`${val} 张`, "生成数"]} />
                      <Area type="monotone" dataKey="value" className="text-zinc-900 dark:text-white" stroke="currentColor" strokeWidth={2}
                        fill="url(#trendGrad)" animationDuration={800} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 配额状态 */}
              <div className={`${SUBCARD} p-5 space-y-3`}>
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                    <Battery className="size-3.5 text-zinc-500 dark:text-white/55" />
                  </div>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white">配额状态</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-white/50">
                      <span>当前令牌</span>
                      <span className="tabular-nums">{userStats.tokens?.toFixed?.(2) ?? 0} / {userStats.capacity ?? 50}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-zinc-900 dark:bg-white transition-all duration-500"
                        style={{ width: `${Math.min((userStats.tokens ?? 0) / (userStats.capacity ?? 50) * 100, 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-4 shrink-0">
                    <div className="text-left sm:text-right">
                      <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-white">{userStats.refill ?? 3}</p>
                      <p className="text-[10px] text-zinc-400 dark:text-white/40">/小时恢复</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums truncate max-w-[120px] text-zinc-900 dark:text-white">{userStats.plan_name || "免费版"}</p>
                      <p className="text-[10px] text-zinc-400 dark:text-white/40">{userStats.plan_name && userStats.plan_name !== "免费版" ? "当前套餐" : ""}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-16 text-zinc-400 dark:text-white/40">
              <BarChart3 className="size-10 mb-3 opacity-30" />
              <p className="text-sm">加载中…</p>
            </div>
          )}
        </TabsPanel>

        {/* ── 账号设置 ── */}
        <TabsPanel value="account">
          <div className={`${CARD} p-6 space-y-5`}>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-zinc-900/[0.05] dark:bg-white/[0.08] flex items-center justify-center">
                <Key className="size-5 text-zinc-500 dark:text-white/55" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">修改密码</p>
                <p className="text-xs text-zinc-500 dark:text-white/50">设置新的登录密码</p>
              </div>
            </div>
            <div className="space-y-4 max-w-sm">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-white/50">当前密码</label>
                <Input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="输入当前密码" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-white/50">新密码</label>
                <Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少 6 位" />
              </div>
              <Button onClick={onChangePwd} disabled={changingPwd || !oldPwd || !newPwd || newPwd.length < 6}>
                {changingPwd ? "修改中..." : "修改密码"}
              </Button>
            </div>
          </div>
        </TabsPanel>

        {/* PLACEHOLDER_REST */}
      </Tabs>
    </motion.div>
  );
}
