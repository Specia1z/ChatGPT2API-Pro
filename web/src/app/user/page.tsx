"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { Navbar } from "@/components/navbar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { toast } from "sonner";
import { stagger } from "./lib/helpers";
import { useAnimatedNumber, useCountdown } from "./lib/hooks";
import { useUserData } from "./lib/useUserData";
import { ExchangeDialog } from "./components/ExchangeDialog";
import { RechargeDialog } from "./components/RechargeDialog";
import { ProfileHeader } from "./components/ProfileHeader";
import { AccountTabs } from "./components/AccountTabs";

/* ── 主页面 ─────────────────────────────────── */

export default function UserPage() {
  const { user, token, loading: authLoading, logout, login } = useAuth();
  const router = useRouter();
  const {
    keys, tokens, checkin, userCoupons, userStats, pointsLogs, pointsLogsLoaded,
    fetchPointsLogs,
    webhook, webhookLoaded, fetchWebhook, saveWebhook, deleteWebhook,
    doCheckin, createKey, deleteKey, toggleKey, claimCoupon, doRedeem, doExchange, doChangePwd,
  } = useUserData(user, token, authLoading, login);

  // UI 局部状态
  const [copied, setCopied] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeTokens, setExchangeTokens] = useState(10);
  const [exchanging, setExchanging] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);

  // 包装 hook 操作 + UI 反馈
  const onChangePwd = async () => {
    if (!oldPwd || newPwd.length < 6) return;
    setChangingPwd(true);
    try { await doChangePwd(oldPwd, newPwd); setOldPwd(""); setNewPwd(""); }
    catch (e: any) { toast.error(e.message || "修改失败"); }
    finally { setChangingPwd(false); }
  };
  const onExchange = async () => {
    if (exchangeTokens <= 0) return;
    setExchanging(true);
    try { await doExchange(exchangeTokens); setExchangeOpen(false); }
    catch (e: any) { toast.error(e.message || "兑换失败"); }
    finally { setExchanging(false); }
  };
  const onClaimCoupon = async () => {
    if (!claimCode.trim()) return;
    setClaiming(true);
    try { await claimCoupon(claimCode); setClaimCode(""); } catch {}
    finally { setClaiming(false); }
  };
  const onRedeem = async () => {
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    try { await doRedeem(redeemCode); setRedeemCode(""); } catch {}
    finally { setRedeeming(false); }
  };
  const onCreateKey = async () => { await createKey(newKeyName); setNewKeyName(""); };
  const onDeleteKey = async () => { if (deleteId == null) return; await deleteKey(deleteId); setDeleteId(null); };
  const onSaveWebhook = async (url: string, secret: string, enabled: boolean) => {
    setSavingWebhook(true);
    try { await saveWebhook(url, secret, enabled); }
    catch (e: any) { toast.error(e.message || "保存失败"); }
    finally { setSavingWebhook(false); }
  };
  const onDeleteWebhook = async () => {
    setSavingWebhook(true);
    try { await deleteWebhook(); }
    catch (e: any) { toast.error(e.message || "删除失败"); }
    finally { setSavingWebhook(false); }
  };
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
    <div className="min-h-screen bg-[#fbfbfd] dark:bg-[#06070d] pb-16 md:pb-0">
      <Navbar />

      {/* ════ 流体头部：与全站统一（顶部浓、向下淡出） ════ */}
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[36rem] overflow-hidden pointer-events-none">
          <div className="absolute top-[-12%] left-[-6%] w-[40vw] h-[40vw] rounded-full blur-[110px] opacity-40 dark:opacity-45 mix-blend-multiply dark:mix-blend-screen bg-[#22d3ee] [will-change:transform]" style={{ animation: "fluidA 18s ease-in-out infinite" }} />
          <div className="absolute top-[-8%] right-[-4%] w-[36vw] h-[36vw] rounded-full blur-[110px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidB 20s ease-in-out infinite" }} />
          <div className="absolute top-[6%] left-1/3 w-[34vw] h-[34vw] rounded-full blur-[110px] opacity-30 dark:opacity-35 mix-blend-multiply dark:mix-blend-screen bg-[#e879f9] [will-change:transform]" style={{ animation: "fluidC 22s ease-in-out infinite" }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#fbfbfd] dark:to-[#06070d]" />
        </div>
        <div className="absolute inset-x-0 top-0 h-[36rem] opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

        <motion.div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"
          variants={stagger} initial="hidden" animate="visible">

        {/* ═══ 头部 + 令牌仪表盘 + 倒计时 ═══ */}
        <ProfileHeader
          user={user}
          isPro={isPro}
          refill={refill}
          concurrency={concurrency}
          capacity={capacity}
          displayTokens={displayTokens}
          animatedTokens={animatedTokens}
          pct={pct}
          burst={burst}
          exchangeRate={exchangeRate}
          cdNextHMS={cd?.nextHMS ?? null}
          onUpgrade={() => setUpgradeOpen(true)}
          onLogout={() => setLogoutOpen(true)}
          onExchange={() => setExchangeOpen(true)}
          onRecharge={() => setRechargeOpen(true)}
        />

        {/* ═══ 功能区 Tabs ═══ */}
        <AccountTabs
          user={user}
          keys={keys} copied={copied} newKeyName={newKeyName} setNewKeyName={setNewKeyName}
          onCreateKey={onCreateKey} copyKey={copyKey} toggleKey={toggleKey} setDeleteId={setDeleteId}
          claimCode={claimCode} setClaimCode={setClaimCode} claiming={claiming} onClaimCoupon={onClaimCoupon} userCoupons={userCoupons}
          redeemCode={redeemCode} setRedeemCode={setRedeemCode} redeeming={redeeming} onRedeem={onRedeem}
          pointsLogs={pointsLogs} pointsLogsLoaded={pointsLogsLoaded} fetchPointsLogs={fetchPointsLogs}
          checkin={checkin} doCheckin={doCheckin} userStats={userStats}
          webhook={webhook} webhookLoaded={webhookLoaded} fetchWebhook={fetchWebhook} onSaveWebhook={onSaveWebhook} onDeleteWebhook={onDeleteWebhook} savingWebhook={savingWebhook}
          oldPwd={oldPwd} setOldPwd={setOldPwd} newPwd={newPwd} setNewPwd={setNewPwd} changingPwd={changingPwd} onChangePwd={onChangePwd}
        />
      </motion.div>
      </div>

      <ConfirmDialog open={deleteId != null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="删除 API 密钥" description="删除后使用该密钥的应用将立即失效，此操作不可撤销。"
        confirmLabel="删除" variant="destructive" onConfirm={onDeleteKey} />
      <ConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen}
        title="退出登录" description="确定要退出当前账号吗？"
        confirmLabel="退出登录" onConfirm={() => { logout(); router.push("/"); }} />
      <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)}
        currentPlanName={user.plan_name || ""} currentPlanId={(user as any).plan_id || 0} />

      {/* ═══ 积分兑换突发令牌 ═══ */}
      <ExchangeDialog
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        exchangeTokens={exchangeTokens}
        setExchangeTokens={setExchangeTokens}
        exchangeRate={exchangeRate}
        exchangeBonus={exchangeBonus}
        userPoints={user?.points ?? 0}
        exchanging={exchanging}
        onExchange={onExchange}
      />
      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </div>
  );
}
