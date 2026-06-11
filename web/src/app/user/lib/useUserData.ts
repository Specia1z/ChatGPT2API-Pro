// 用户中心数据 hook：封装密钥/令牌/签到/优惠券/统计/积分流水的拉取与各类操作。
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function useUserData(user: any, token: string | null, authLoading: boolean, login: (u: any, t: string) => void) {
  const router = useRouter();
  const [keys, setKeys] = useState<any[]>([]);
  const [tokens, setTokens] = useState<number | null>(null);
  const [checkin, setCheckin] = useState<any>(null);
  const [userCoupons, setUserCoupons] = useState<any[]>([]);
  const [userStats, setUserStats] = useState<any>(null);
  const [pointsLogs, setPointsLogs] = useState<any[]>([]);
  const [pointsLogsLoaded, setPointsLogsLoaded] = useState(false);
  const [webhook, setWebhook] = useState<any>(null);
  const [webhookLoaded, setWebhookLoaded] = useState(false);

  const fetchUserStats = async () => { try { const r = await api("/api/user/stats"); if (r.data) setUserStats(r.data); } catch {} };
  const refreshProfile = async () => { try { const r = await api("/api/user/profile"); if (r.data && token) login(r.data, token); } catch {} };
  const fetchKeys = async () => { try { const r = await api("/api/user/keys"); setKeys(r.data || []); } catch {} };
  const fetchTokens = async () => { try { const r = await api("/api/user/tokens"); if (r.data?.tokens !== undefined) setTokens(r.data.tokens); } catch {} };
  const fetchCheckin = async () => { try { const r = await api("/api/user/checkin/status"); setCheckin(r.data); } catch {} };
  const fetchCoupons = async () => { try { const r = await api("/api/user/coupons"); setUserCoupons(r.data || []); } catch {} };
  const fetchPointsLogs = async () => { try { const r = await api("/api/user/points/logs?page=1&page_size=50"); setPointsLogs(r.data?.items || []); } catch {} finally { setPointsLogsLoaded(true); } };
  const fetchWebhook = async () => { try { const r = await api("/api/user/webhook"); setWebhook(r.data || null); } catch {} finally { setWebhookLoaded(true); } };

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { router.push("/login"); return; }
    refreshProfile(); fetchKeys(); fetchTokens(); fetchCheckin(); fetchCoupons(); fetchUserStats();
    const iv = setInterval(fetchTokens, 15000);
    return () => clearInterval(iv);
    // 依赖只用稳定标识 user?.id（refreshProfile 内部 login 写回 user，依赖整个对象会无限重触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, token, authLoading]);

  // ── 操作 ──
  const doCheckin = async () => { try { const r = await api("/api/user/checkin", { method: "POST" }); toast.success(r.message || "签到成功"); fetchCheckin(); fetchTokens(); } catch (e: any) { toast.error(e.message); } };
  const createKey = async (name: string) => { try { await api("/api/user/keys", { method: "POST", body: JSON.stringify({ name: name || "API Key" }) }); toast.success("密钥已创建"); fetchKeys(); } catch (e: any) { toast.error(e.message); } };
  const deleteKey = async (id: number) => { try { await api("/api/user/keys", { method: "DELETE", body: JSON.stringify({ id }) }); toast.success("密钥已删除"); fetchKeys(); } catch (e: any) { toast.error(e.message); } };
  const toggleKey = async (k: any) => { try { const next = !(k.enabled !== false); await api("/api/user/keys/toggle", { method: "POST", body: JSON.stringify({ id: k.id, enabled: next }) }); toast.success(next ? "已启用" : "已禁用"); fetchKeys(); } catch (e: any) { toast.error(e.message); } };
  const claimCoupon = async (code: string) => { if (!code.trim()) return; try { await api("/api/user/coupons/claim", { method: "POST", body: JSON.stringify({ code: code.trim() }) }); toast.success("优惠券领取成功"); fetchCoupons(); } catch (e: any) { toast.error(e.message); throw e; } };
  const doRedeem = async (code: string) => { if (!code.trim()) return; try { const r = await api("/api/user/redeem", { method: "POST", body: JSON.stringify({ code: code.trim() }) }); toast.success(`兑换成功: ${r.data?.value ?? ""}`); fetchTokens(); } catch (e: any) { toast.error(e.message); throw e; } };
  const doExchange = async (count: number) => {
    const r = await api("/api/user/points/exchange", { method: "POST", body: JSON.stringify({ tokens: count }) });
    toast.success(`兑换成功！+${r.data.tokens_added} 突发令牌`);
    fetchUserStats(); fetchTokens();
  };
  const doChangePwd = async (oldPassword: string, newPassword: string) => {
    const r = await api("/api/user/change-password", { method: "POST", body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }) });
    toast.success(r.message || "密码已修改");
  };
  const saveWebhook = async (url: string, secret: string, enabled: boolean) => {
    await api("/api/user/webhook", { method: "POST", body: JSON.stringify({ url: url.trim(), secret, enabled }) });
    toast.success("Webhook 已保存");
    fetchWebhook();
  };
  const deleteWebhook = async () => {
    await api("/api/user/webhook", { method: "DELETE" });
    toast.success("Webhook 已删除");
    fetchWebhook();
  };

  return {
    keys, tokens, checkin, userCoupons, userStats, pointsLogs, pointsLogsLoaded,
    webhook, webhookLoaded, fetchWebhook, saveWebhook, deleteWebhook,
    fetchTokens, fetchPointsLogs,
    doCheckin, createKey, deleteKey, toggleKey, claimCoupon, doRedeem, doExchange, doChangePwd,
  };
}
