"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Zap, Coins, Clock, Check, ArrowRight, Hash, Gauge } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BASE } from "@/lib/api";
import { getCurrencyInfo } from "@/lib/currency";
import QRCode from "qrcode";
import { toast } from "sonner";

function QRCanvas({ text, size = 192 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, text, { width: size, margin: 2, color: { dark: "#18181b", light: "#ffffff" } });
  }, [text, size]);
  return <canvas ref={ref} width={size} height={size} className="w-44 h-44" />;
}

interface UpgradeDialogProps {
  open: boolean;
  onClose: () => void;
  currentPlanName?: string;
  currentPlanId?: number;
  onSuccess?: () => void;
}

type Screen = "select" | "loading" | "qr" | "paid";

export function UpgradeDialog({ open, onClose, currentPlanName, currentPlanId, onSuccess }: UpgradeDialogProps) {
  const [plans, setPlans] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [screen, setScreen] = useState<Screen>("select");
  const [upgradeData, setUpgradeData] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [settings, setSettings] = useState<any>(null);
  const currency = useMemo(() => getCurrencyInfo(settings), [settings]);
  const [gateway, setGateway] = useState<string>(""); // alipay | credit
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    fetch(`${BASE}/api/plans`).then(r => r.json()).then(d => setPlans(d.data || [])).catch(() => {});
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => setSettings(d.data || null)).catch(() => {});
    setSelected(null); setScreen("select"); setUpgradeData(null); setOrder(null); setQrCode(null); setPayUrl(null); setGateway("");
  }, [open]);

  useEffect(() => {
    if (screen !== "paid" || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [screen, countdown]);

  useEffect(() => {
    if (screen === "paid" && countdown <= 0) onClose();
  }, [screen, countdown, onClose]);

  // 可用支付渠道（按后台开关动态显示，与定价/订阅页一致）
  const gateways: { id: string; label: string }[] = [];
  if (settings?.alipay_enabled) gateways.push({ id: "alipay", label: "支付宝" });
  try {
    const cc = JSON.parse(settings?.credit_config || "{}");
    if (cc?.enabled) gateways.push({ id: "credit", label: "Linux Do 积分" });
  } catch {}

  // 升级过滤口径对齐后端：用「裸月/年单价」比较，而非乘时长后的总价。
  // 后端 UpgradeOrder 即按 price_monthly / price_yearly 判定"只能升到更高价位"。
  const currentPlan = plans.find(p => p.id === currentPlanId);
  const currentUnit = currentPlan ? (billing === "yearly" ? currentPlan.price_yearly : currentPlan.price_monthly) : 0;
  const showPlans = (currentPlanId && currentPlanId > 0 && currentUnit > 0)
    ? plans.filter(p => p.id !== currentPlanId && (billing === "yearly" ? p.price_yearly : p.price_monthly) > currentUnit)
    : plans;

  const handleConfirm = async (plan: any) => {
    if (!plan) return;
    setScreen("loading");
    try {
      const token = localStorage.getItem("auth-token");
      const res = await fetch(`${BASE}/api/orders/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: plan.id, billing, gateway: gateway || undefined }),
      });
      const data = await res.json();
      if (data.code !== 200) { toast.error(data.message || "请求失败"); setScreen("select"); return; }
      if (data.data?.free) {
        toast.success(`已升级至 ${data.data.plan}`);
        setScreen("paid"); setCountdown(3); onSuccess?.(); return;
      }
      setUpgradeData(data.data);
      if (data.data?.redirect_url) {
        // Linux Do 积分支付：新标签打开支付页，本地轮询等待完成
        setOrder(data.data.order); setPayUrl(data.data.redirect_url); setScreen("qr");
        window.open(data.data.redirect_url, "_blank");
        startPolling(data.data.order.order_no);
      } else if (data.data?.qr_code) {
        setOrder(data.data.order); setQrCode(data.data.qr_code);
        setScreen("qr"); startPolling(data.data.order.order_no);
      } else {
        setOrder(data.data?.order || data.data); setScreen("qr");
      }
    } catch { toast.error("网络错误"); setScreen("select"); }
  };

  const startPolling = (orderNo: string) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    const token = localStorage.getItem("auth-token");
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/orders/${orderNo}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (d.data?.status === "paid") {
          clearInterval(id); pollingRef.current = false;
          setScreen("paid"); setCountdown(3);
          toast.success("支付成功"); onSuccess?.();
        }
      } catch {}
    }, 3000);
  };
  // PLACEHOLDER_RENDER
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && screen !== "qr") onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md p-0 gap-0 overflow-hidden [&>button]:hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">升级套餐</DialogTitle>
        <DialogDescription className="sr-only">选择套餐并完成支付</DialogDescription>

        {/* ═══ 选择套餐 ═══ */}
        {screen === "select" && (
          <div>
            <div className="px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold font-[family-name:var(--font-display)]">升级套餐</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">当前: {currentPlanName || "免费版"}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={onClose}>×</Button>
              </div>

              {/* 月付/年付切换 — 所有用户可见 */}
              <div className="mt-3 inline-flex items-center rounded-lg bg-muted p-0.5">
                {(["monthly", "yearly"] as const).map(b => (
                  <button key={b} onClick={() => { setBilling(b); setSelected(null); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      billing === b ? "text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}>
                    {b === "monthly" ? "月付" : "年付"}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 space-y-2.5 max-h-[min(340px,50vh)] overflow-y-auto scrollbar-thin">
              {showPlans.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">已是最高套餐</p>
              )}
              {showPlans.map((plan) => {
                const isCurrent = currentPlanId === plan.id;
                const isSelected = selected?.id === plan.id;
                const price = billing === "yearly" ? plan.price_yearly : plan.price_monthly;
                return (
                  <button key={plan.id} type="button" disabled={isCurrent}
                    onClick={() => !isCurrent && setSelected(plan)}
                    className={`relative w-full text-left rounded-xl border p-4 transition-all duration-200 disabled:opacity-40 ${
                      isSelected
                        ? "border-cyan-400 bg-cyan-500/5 ring-1 ring-cyan-400 shadow-sm"
                        : "border-border bg-card hover:border-cyan-300 dark:hover:border-cyan-700/60 hover:shadow-sm"
                    }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{plan.name}</span>
                        {isCurrent && <Badge variant="secondary" className="text-[9px] h-4">当前</Badge>}
                        {plan.highlighted && !isCurrent && <Badge className="text-[9px] h-4 border-0 text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)]">推荐</Badge>}
                      </div>
                      <span className={`size-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        isSelected ? "border-cyan-400 bg-cyan-400" : "border-border"
                      }`}>
                        {isSelected && <Check className="size-3 text-white" />}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-2xl font-bold tabular-nums font-[family-name:var(--font-display)]">{currency.symbol}{Math.round(price * currency.rate)}</span>
                      <span className="text-xs text-muted-foreground">{currency.isCredit ? " 积分/月" : "/月"}</span>
                      {billing === "yearly" && plan.price_monthly > price && (
                        <span className="text-xs text-muted-foreground line-through ml-1">{currency.symbol}{Math.round(plan.price_monthly * currency.rate)}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Zap className="size-3 text-cyan-500/70" /> 并发 {plan.concurrency}</span>
                      <span className="flex items-center gap-1"><Coins className="size-3 text-cyan-500/70" /> {plan.token_capacity} 令牌</span>
                      <span className="flex items-center gap-1"><Gauge className="size-3 text-cyan-500/70" /> {plan.rate_limit_per_min || 30} 次/分</span>
                      <span className="flex items-center gap-1"><Clock className="size-3 text-cyan-500/70" /> {billing === "yearly" ? (plan.duration_days_yearly > 0 ? plan.duration_days_yearly + "天" : "永久") : plan.duration_days + "天"}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="px-6 pb-6 pt-2 space-y-3">
              {/* 支付方式（后台启用多个渠道时显示；单渠道直接用唯一可用项） */}
              {gateways.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">支付方式</p>
                  <div className="grid grid-cols-2 gap-2">
                    {gateways.map(g => (
                      <button key={g.id} type="button" onClick={() => setGateway(g.id)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
                          (gateway || gateways[0]?.id) === g.id
                            ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-400"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted ring-1 ring-transparent"
                        }`}>
                        {g.id === "credit" ? <Coins className="size-3.5" /> : <Check className="size-3.5" />}
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Button disabled={!selected} onClick={() => handleConfirm(selected)} className="w-full h-10 gap-2 text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 disabled:opacity-40">
                {selected ? `升级至 ${selected.name}` : "选择套餐"}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══ 计价 loading ═══ */}
        {screen === "loading" && (
          <div className="flex flex-col items-center py-16 px-6">
            <div className="size-12 rounded-full border-2 border-muted border-t-cyan-500 animate-spin mb-5" />
            <p className="text-sm text-muted-foreground">正在计算升级价格…</p>
          </div>
        )}

        {/* ═══ 扫码支付 ═══ */}
        {screen === "qr" && (
          <div>
            <div className="px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold font-[family-name:var(--font-display)]">{payUrl ? "积分支付" : "扫码支付"}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{payUrl ? "Linux Do 积分" : "支付宝"} · 升级 {selected?.name}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={onClose}>×</Button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="space-y-2 text-sm">
                {upgradeData?.original_price != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">套餐原价</span>
                    <span className="tabular-nums text-muted-foreground line-through">{currency.symbol}{((upgradeData.original_price || 0) * currency.rate).toFixed(currency.isCredit ? 0 : 2)}</span>
                  </div>
                )}
                {upgradeData?.remaining_value > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">旧套餐抵扣</span>
                    <span className="tabular-nums text-emerald-600 dark:text-emerald-400">-{currency.symbol}{((upgradeData.remaining_value || 0) * currency.rate).toFixed(currency.isCredit ? 0 : 2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="font-medium">实付</span>
                  <span className="text-xl font-bold tabular-nums font-[family-name:var(--font-display)]">{currency.symbol}{((order?.amount || 0) * currency.rate).toFixed(currency.isCredit ? 0 : 2)}{currency.isCredit ? " 积分" : ""}</span>
                </div>
              </div>

              <div className="rounded-xl border bg-muted/30 p-5 flex flex-col items-center">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  {payUrl ? (
                    <div className="w-44 h-44 flex flex-col items-center justify-center gap-3 px-3">
                      <Coins className="size-10 text-amber-500" />
                      <p className="text-[11px] text-center text-muted-foreground leading-relaxed">已在新标签打开 Linux Do 积分支付页，完成后自动开通</p>
                    </div>
                  ) : (
                    <QRCanvas text={qrCode || ""} />
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="relative flex size-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex rounded-full size-2 bg-cyan-500" />
                  </span>
                  <span className="text-xs text-muted-foreground">等待支付</span>
                </div>
                {payUrl && (
                  <a href={payUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 py-2 text-white text-xs font-medium transition-colors">
                    <Coins className="size-3.5" /> 前往积分支付页
                  </a>
                )}
              </div>

              {order?.order_no && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60">
                  <Hash className="size-2.5" /> <span className="font-mono">{order.order_no}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ 支付成功 ═══ */}
        {screen === "paid" && (
          <div className="flex flex-col items-center py-14 px-6">
            <div className="relative mb-5">
              <div className="size-16 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center"
                style={{ animation: "successPop 0.5s cubic-bezier(0.16,1,0.3,1)" }}>
                <Check className="size-7 text-emerald-500" style={{ animation: "successCheck 0.4s ease-out 0.1s both" }} />
              </div>
              <div className="absolute inset-0 rounded-full border border-emerald-200 dark:border-emerald-500/20"
                style={{ animation: "successRing 2s ease-out 0.3s infinite" }} />
            </div>
            <h3 className="text-base font-semibold mb-1 font-[family-name:var(--font-display)]">升级成功</h3>
            <p className="text-sm text-muted-foreground mb-6">{selected?.name || ""} 已开通</p>
            <div className="w-full max-w-[160px] space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>即将关闭</span>
                <span className="font-mono tabular-nums">{countdown}s</span>
              </div>
              <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000 ease-linear bg-[linear-gradient(110deg,#0891b2,#6366f1)]"
                  style={{ width: `${((3 - countdown) / 3) * 100}%` }} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
