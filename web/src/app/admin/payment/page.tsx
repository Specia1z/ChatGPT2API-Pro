"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { CreditCard, Check, Loader2, ShieldCheck, KeyRound, Globe, Wallet, Clock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const inputCls = "text-sm";
const taCls = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20 font-mono";

function Field({ icon: Icon, label, hint, children }: { icon: any; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3" /> {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export default function PaymentPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api("/api/settings")
      .then((r: any) => setCfg(r.data || {}))
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const update = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));

  // Linux Do Credit 积分支付配置是 JSON 字符串字段（credit_config）：解析为对象编辑，改后序列化回
  const creditCfg = (() => { try { return JSON.parse(cfg?.credit_config || "{}"); } catch { return {}; } })();
  const updateCredit = (k: string, v: any) => {
    const next = { ...creditCfg, [k]: v };
    setCfg((p: any) => ({ ...p, credit_config: JSON.stringify(next) }));
  };

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      // 提交完整 settings（密钥字段留空时后端保留旧值），仅本页编辑支付相关字段
      await api("/api/settings", { method: "POST", body: JSON.stringify(cfg) });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      toast.success("支付配置已保存");
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  const enabled = !!cfg?.alipay_enabled;

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="size-8 sm:size-9 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
              <Wallet className="size-4 sm:size-5 text-cyan-500" />
            </div>
            <div>
              <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>支付网关</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">配置第三方支付渠道 · 当前支持支付宝</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {saved && <span className="hidden sm:flex items-center gap-1 text-xs text-emerald-500"><Check className="size-3.5" /> 已保存</span>}
            <Button onClick={save} disabled={saving} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 h-7 sm:h-9">
              {saving ? <Loader2 className="size-3 sm:size-4 animate-spin" /> : <ShieldCheck className="size-3 sm:size-4" />}
              {saving ? "..." : "保存"}
            </Button>
          </div>
        </div>

        {/* ═══ 内容 ═══ */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-3xl mx-auto space-y-5">
            {/* ── 支付宝 ── */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 sm:size-9 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <CreditCard className="size-4 sm:size-[18px] text-cyan-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>支付宝</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">当面付（扫码支付），在定价页显示购买入口</p>
                </div>
                <Switch checked={enabled} onCheckedChange={v => update("alipay_enabled", v)} />
              </div>
              <div className="p-4 sm:p-6">
                {enabled ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field icon={KeyRound} label="支付宝 APP ID">
                        <Input value={cfg?.alipay_app_id || ""} onChange={e => update("alipay_app_id", e.target.value)} placeholder="202100..." className={inputCls} />
                      </Field>
                      <Field icon={Globe} label="异步通知 URL" hint="留空则使用前端轮询查询订单状态">
                        <Input value={cfg?.alipay_notify_url || ""} onChange={e => update("alipay_notify_url", e.target.value)} placeholder="https://你的域名/api/orders/alipay/notify" className={inputCls} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field icon={KeyRound} label="应用私钥（RSA2）" hint="已配置时留空可保留原密钥，填写则覆盖">
                        <textarea value={cfg?.alipay_app_private_key || ""} onChange={e => update("alipay_app_private_key", e.target.value)} rows={4} placeholder="-----BEGIN RSA PRIVATE KEY-----" className={taCls} />
                      </Field>
                      <Field icon={KeyRound} label="支付宝公钥" hint="已配置时留空可保留原密钥，填写则覆盖">
                        <textarea value={cfg?.alipay_alipay_public_key || ""} onChange={e => update("alipay_alipay_public_key", e.target.value)} rows={4} placeholder="-----BEGIN PUBLIC KEY-----" className={taCls} />
                      </Field>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-3.5 text-[11px] text-muted-foreground leading-relaxed">
                      回调地址固定为 <code className="text-foreground">/api/orders/alipay/notify</code>（异步通知）。出于安全，私钥/公钥保存后不再回显，重新保存时留空即保留原值。
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">未启用支付宝支付。开启后用户可在定价页通过支付宝扫码购买套餐。</p>
                )}
              </div>
            </motion.section>

            {/* ── Linux Do 积分支付（EasyPay 协议）── */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
              className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 sm:size-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                  <CreditCard className="size-4 sm:size-[18px] text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>Linux Do 积分支付</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">基于 credit.linux.do（EasyPay 协议），用户用 Linux Do 积分购买套餐</p>
                </div>
                <Switch checked={!!creditCfg.enabled} onCheckedChange={v => updateCredit("enabled", v)} />
              </div>
              <div className="p-4 sm:p-6">
                {creditCfg.enabled ? (
                  <div className="space-y-4">
                    <Field icon={Globe} label="网关地址（API Base）">
                      <Input value={creditCfg.api_base || ""} onChange={e => updateCredit("api_base", e.target.value)} placeholder="https://credit.linux.do" className={inputCls} />
                    </Field>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field icon={KeyRound} label="商户 PID">
                        <Input value={creditCfg.pid || ""} onChange={e => updateCredit("pid", e.target.value)} placeholder="credit.linux.do 商户 ID" className={inputCls} />
                      </Field>
                      <Field icon={KeyRound} label="商户密钥（Key）" hint="已配置时留空可保留原密钥，填写则覆盖">
                        <Input type="password" value={creditCfg.key || ""} onChange={e => updateCredit("key", e.target.value)} placeholder="留空保留原值" className={inputCls} />
                      </Field>
                    </div>
                    <Field icon={Clock} label="积分 / 元 汇率" hint="1 元 = X 积分。0 视为 1（即套餐价格直接作为积分数）">
                      <Input type="number" min={0} value={creditCfg.rate ?? 0} onChange={e => updateCredit("rate", Math.max(0, +e.target.value || 0))} className={inputCls} />
                    </Field>
                    <div className="border-t pt-4 mt-4 space-y-4">
                      <p className="text-xs font-medium text-foreground">LDC Pay（Ed25519，推荐）</p>
                      <p className="text-[10px] text-muted-foreground -mt-2">配置后优先使用 Ed25519 签名协议，未配置或签名失败时自动降级 MD5 EasyPay</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field icon={KeyRound} label="LDC Client ID">
                          <Input value={creditCfg.ldc_client_id || ""} onChange={e => updateCredit("ldc_client_id", e.target.value)} placeholder="控制台应用 Client ID" className={inputCls} />
                        </Field>
                        <Field icon={KeyRound} label="LDC Client Secret">
                          <Input type="password" value={creditCfg.ldc_client_secret || ""} onChange={e => updateCredit("ldc_client_secret", e.target.value)} placeholder="留空保留原值" className={inputCls} />
                        </Field>
                      </div>
                      <Field icon={KeyRound} label="Ed25519 私钥" hint="Base64 (32字节 seed) 或 Hex (64字符)，上传公钥到 credit.linux.do 控制台">
                        <Input type="password" value={creditCfg.ldc_private_key || ""} onChange={e => updateCredit("ldc_private_key", e.target.value)} placeholder="留空保留原值" className={inputCls} />
                      </Field>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-3.5 text-[11px] text-muted-foreground leading-relaxed">
                      回调地址固定为 <code className="text-foreground">/api/orders/credit/notify</code>（异步通知）。出于安全，密钥保存后不再回显，重新保存时留空即保留原值。
                      <br />注：异步回调需由 credit.linux.do 服务器访问，请确保本站部署在公网可达地址。
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">未启用 Linux Do 积分支付。开启后用户可在定价页选择用 Linux Do 积分购买套餐（跳转支付页完成）。</p>
                )}
              </div>
            </motion.section>

            {/* ── 订单设置 ── */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
              className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 sm:size-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Clock className="size-4 sm:size-[18px] text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>订单设置</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">待支付订单的超时处理</p>
                </div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <Field icon={Clock} label="待支付超时（分钟）">
                    <Input type="number" min={0} value={cfg?.order_timeout_minutes ?? 0} onChange={e => update("order_timeout_minutes", +e.target.value)} placeholder="0" className={inputCls} />
                  </Field>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-[11px] text-muted-foreground leading-relaxed">
                    待支付订单超过此分钟数后自动置为「已过期」（订单记录保留，不再可支付）。0 = 不自动处理。系统每分钟检查一次。
                  </div>
                </div>
              </div>
            </motion.section>

            {/* 后续渠道（微信 / Stripe 等）接入后在此追加卡片 */}
          </div>

        </div>
      </main>
    </div>
  );
}

