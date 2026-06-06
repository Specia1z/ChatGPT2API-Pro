"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tag, Check, ArrowLeft, Crown, Clock, Zap, Coins, Sparkles, X, Hash } from "lucide-react";
import { BASE } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode";
import { toast } from "sonner";

function QRCanvas({ text, size = 192 }: { text: string; size?: number }) {
  const [ref, setRef] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (ref) QRCode.toCanvas(ref, text, { width: size, margin: 2, color: { dark: "#18181b", light: "#ffffff" } });
  }, [text, size, ref]);
  return <canvas ref={setRef} width={size} height={size} className="w-44 h-44" />;
}

function SubscribePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [plans, setPlans] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  // Coupon
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState<any>(null);
  const [couponValidating, setCouponValidating] = useState(false);

  // Payment state
  const [screen, setScreen] = useState<"select" | "pay" | "qr" | "paid">("select");
  const [order, setOrder] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    fetch(`${BASE}/api/plans`).then(r => r.json()).then(d => setPlans(d.data || [])).catch(() => {});
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => {
      if (d.data) { setSettings(d.data); document.title = d.data.site_title || "ChatGPT2API Pro"; }
    }).catch(() => {});
    const pid = params.get("plan_id");
    const bill = params.get("billing");
    if (bill === "yearly") setBilling("yearly");
    if (pid && plans.length > 0) {
      const found = plans.find((p: any) => p.id === parseInt(pid));
      if (found) setSelected(found);
    }
  }, [params]);

  // 当 plans 加载后，如果有 URL 参数则选中对应套餐
  useEffect(() => {
    const pid = params.get("plan_id");
    if (pid && plans.length > 0) {
      const found = plans.find((p: any) => p.id === parseInt(pid));
      if (found) { setSelected(found); setScreen("pay"); }
    }
  }, [plans]);

  useEffect(() => {
    if (screen !== "paid" || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [screen, countdown]);

  useEffect(() => {
    if (screen === "paid" && countdown <= 0) router.push("/user");
  }, [screen, countdown, router]);

  const validateCoupon = async () => {
    if (!couponCode.trim() || !selected) return;
    setCouponValidating(true);
    try {
      const token = localStorage.getItem("auth-token");
      const res = await fetch(`${BASE}/api/orders/coupon/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: couponCode.trim(), plan_id: selected.id, billing }),
      });
      const d = await res.json();
      if (d.data?.valid) { setCouponDiscount(d.data); } else { setCouponDiscount(null); }
    } catch {} finally { setCouponValidating(false); }
  };

  const handlePay = async () => {
    if (!selected) return;
    const token = localStorage.getItem("auth-token");
    if (!token) { router.push("/login"); return; }
    setScreen("qr");
    setOrder(null);
    try {
      const res = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: selected.id, billing, coupon_code: couponCode || undefined }),
      });
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      if (data.data?.qr_code) {
        setOrder(data.data.order);
        setQrCode(data.data.qr_code);
        startPolling(data.data.order.order_no);
      } else {
        toast.error("支付服务暂不可用");
        setScreen("pay");
      }
    } catch { toast.error("创建订单失败"); setScreen("pay"); }
  };

  const pollingRef = { current: false };
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
          toast.success("支付成功");
        }
      } catch {}
    }, 3000);
  };

  const total = selected ? (billing === "yearly" ? selected.price_yearly : selected.price_monthly) : 0;
  const months = selected ? Math.ceil((billing === "yearly" ? (selected.duration_days_yearly || selected.duration_days * 12) : selected.duration_days) / 30) : 0;
  const originalTotal = selected ? (billing === "yearly"
    ? (selected.duration_days_yearly > 0 ? selected.price_yearly * 12 * selected.duration_days_yearly / 365 : selected.price_yearly * 12)
    : selected.price_monthly * selected.duration_days / 30) : 0;

  // ── Plan Selection Screen ──

  const renderSelect = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">选择套餐</h2>
      <div className="grid gap-3">
        {plans.map((plan, i) => {
          const active = selected?.id === plan.id;
          return (
            <button key={plan.id} onClick={() => { setSelected(plan); setCouponDiscount(null); }}
              className={`relative text-left w-full rounded-2xl border-2 p-5 transition-all duration-200 ${
                active
                  ? "border-cyan-400 dark:border-cyan-400/60 bg-white dark:bg-zinc-900 shadow-lg shadow-cyan-500/10"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-cyan-300 dark:hover:border-cyan-700/60"
              }`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{plan.name}</span>
                {active && <Check className="w-5 h-5 text-cyan-500 dark:text-cyan-400" />}
              </div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100 font-[family-name:var(--font-display)]">
                  ¥{billing === "yearly" ? plan.price_yearly : plan.price_monthly}
                </span>
                <span className="text-sm text-zinc-400">/月</span>
                {billing === "yearly" && plan.price_monthly > 0 && (
                  <span className="text-sm text-zinc-400 line-through ml-1">¥{plan.price_monthly}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-cyan-500/70" /> {plan.concurrency} 并发</span>
                <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5 text-cyan-500/70" /> {plan.token_capacity} 张</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-cyan-500/70" /> {billing === "yearly" ? (plan.duration_days_yearly || plan.duration_days * 12) : plan.duration_days}天</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2">
        {["monthly", "yearly"].map(b => (
          <button key={b} onClick={() => { setBilling(b as any); setCouponDiscount(null); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              billing === b ? "text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}>
            {b === "monthly" ? "月付" : "年付"}
          </button>
        ))}
      </div>

      {selected && (
        <Button onClick={() => setScreen("pay")} size="lg" className="w-full h-12 text-sm font-semibold rounded-xl shadow-sm text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 hover:shadow-[0_8px_24px_-6px_rgba(34,211,238,0.6)]">
          去支付 — ¥{Math.round(billing === "yearly" ? selected.price_yearly : selected.price_monthly)}/月
        </Button>
      )}
    </div>
  );

  // ── Payment Screen ──

  const renderPay = () => {
    const discount = couponDiscount?.discount || 0;
    const finalPrice = originalTotal - discount;

    return (
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* ═══ 左栏：账单明细 ═══ */}
        <div className="lg:col-span-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {/* 套餐头部 */}
          <div className="relative p-6 border-b border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full blur-3xl opacity-[0.12] bg-[radial-gradient(circle,#22d3ee,#6366f1)] pointer-events-none" />
            <div className="relative flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shrink-0 shadow-[0_6px_18px_-6px_rgba(34,211,238,0.6)]">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">{selected?.name}</h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-cyan-500/70" /> {selected?.concurrency} 并发</span>
                  <span className="flex items-center gap-1"><Coins className="w-3 h-3 text-cyan-500/70" /> {selected?.token_capacity} 张额度</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-cyan-500/70" /> {billing === "yearly" ? "年付" : "月付"} · {months}个月</span>
                </div>
              </div>
            </div>
          </div>

          {/* 明细行 */}
          <div className="p-6 space-y-3.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">单价</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">¥{total}/月</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">计费周期</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{months} 个月</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">小计</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">¥{originalTotal.toFixed(2)}</span>
            </div>
            {couponDiscount && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> 优惠码</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">−¥{discount.toFixed(2)}</span>
              </div>
            )}

            {/* 优惠码输入 */}
            <div className="pt-3.5 border-t border-zinc-100 dark:border-zinc-800">
              <label className="text-[11px] font-medium text-zinc-400 tracking-wide mb-2 block">优惠码</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                  <input value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="输入优惠码" readOnly={!!couponDiscount}
                    className={`w-full h-10 rounded-xl border pl-9 pr-3 text-xs font-mono tracking-wider outline-none transition-colors ${
                      couponDiscount
                        ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                        : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                    }`} />
                </div>
                {couponDiscount ? (
                  <button onClick={() => { setCouponDiscount(null); setCouponCode(""); }}
                    className="shrink-0 h-10 px-3 rounded-xl text-[11px] font-medium text-zinc-400 hover:text-red-500 border border-zinc-200 dark:border-zinc-800 transition-colors">
                    移除
                  </button>
                ) : (
                  <button onClick={validateCoupon} disabled={couponValidating || !couponCode.trim()}
                    className="shrink-0 h-10 px-4 rounded-xl text-xs font-medium text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 disabled:opacity-40 transition-all">
                    {couponValidating ? "..." : "应用"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ 右栏：支付摘要（粘性深色卡） ═══ */}
        <div className="lg:col-span-2 lg:sticky lg:top-20">
          <div className="relative rounded-2xl bg-zinc-900 dark:bg-[#0b0e16] ring-1 ring-white/10 overflow-hidden shadow-xl shadow-zinc-900/20">
            <div className="absolute -left-6 -top-10 w-40 h-40 rounded-full blur-[80px] opacity-25 bg-[#22d3ee] pointer-events-none" />
            <div className="relative p-6">
              <span className="text-[11px] font-medium text-cyan-100/60 tracking-[0.15em] uppercase">应付金额</span>
              <div className="flex items-baseline gap-1 mt-2 mb-1">
                <span className="text-lg font-medium text-zinc-400">¥</span>
                <span className="text-4xl font-bold text-white tabular-nums font-[family-name:var(--font-display)]">{finalPrice.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <p className="text-[11px] text-zinc-500 line-through mb-4">原价 ¥{originalTotal.toFixed(2)}</p>
              )}
              {discount === 0 && <div className="mb-4" />}

              <Button onClick={handlePay} size="lg"
                className="w-full h-12 text-sm font-semibold rounded-xl text-zinc-900 bg-white hover:bg-zinc-100 shadow-lg shadow-black/20">
                立即支付
              </Button>

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> 支付宝安全支付
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> 开通后立即生效
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── QR Screen ──

  const renderQR = () => (
    <div className="max-w-md mx-auto">
      <div className="relative rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xl shadow-zinc-900/5">
        {/* 顶部金额条 — 深色光谱 */}
        <div className="relative bg-zinc-900 dark:bg-[#0b0e16] px-6 py-5 overflow-hidden">
          <div className="absolute -left-6 -top-8 w-36 h-36 rounded-full blur-[70px] opacity-30 bg-[#22d3ee] pointer-events-none" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-[11px] text-cyan-100/60 tracking-[0.15em] uppercase mb-1">应付金额</p>
              <div className="flex items-baseline gap-1">
                <span className="text-base font-medium text-zinc-400">¥</span>
                <span className="text-3xl font-bold text-white tabular-nums font-[family-name:var(--font-display)]">{(order?.amount || 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-zinc-400">{selected?.name}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{billing === "yearly" ? "年付" : "月付"} · {months}个月</p>
            </div>
          </div>
        </div>

        {/* 二维码区 */}
        <div className="p-7 flex flex-col items-center">
          <div className="relative">
            {/* 四角光谱装饰 */}
            <span className="absolute -left-2 -top-2 w-5 h-5 border-l-2 border-t-2 border-cyan-400 rounded-tl-md" />
            <span className="absolute -right-2 -top-2 w-5 h-5 border-r-2 border-t-2 border-violet-400 rounded-tr-md" />
            <span className="absolute -left-2 -bottom-2 w-5 h-5 border-l-2 border-b-2 border-violet-400 rounded-bl-md" />
            <span className="absolute -right-2 -bottom-2 w-5 h-5 border-r-2 border-b-2 border-fuchsia-400 rounded-br-md" />
            <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100">
              {qrCode
                ? <QRCanvas text={qrCode} />
                : <div className="w-44 h-44 flex items-center justify-center"><div className="w-7 h-7 border-2 border-zinc-200 border-t-cyan-500 rounded-full animate-spin" /></div>}
            </div>
          </div>

          {/* 等待状态 */}
          <div className="mt-5 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-cyan-500" />
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">等待支付中…</span>
          </div>

          {/* 扫码引导 */}
          <div className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 py-3 px-4">
            <Sparkles className="w-4 h-4 text-cyan-500 shrink-0" />
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">打开<span className="font-medium text-zinc-700 dark:text-zinc-200">支付宝</span>扫一扫，完成支付后自动跳转</span>
          </div>

          {order?.order_no && (
            <p className="mt-4 text-[10px] text-zinc-300 dark:text-zinc-600 font-mono tracking-wide">订单号 {order.order_no}</p>
          )}
        </div>
      </div>

      {/* 返回改价 */}
      <button onClick={() => setScreen("pay")} className="mt-4 w-full text-center text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
        返回上一步
      </button>
    </div>
  );

  // ── Paid Screen ──

  const renderPaid = () => (
    <div className="max-w-sm mx-auto text-center py-10">
      <div className="relative mb-5 inline-flex">
        <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center"
          style={{ animation: "successPop 0.5s cubic-bezier(0.16,1,0.3,1)" }}>
          <Check className="w-7 h-7 text-emerald-500" style={{ animation: "successCheck 0.4s ease-out 0.1s both" }} />
        </div>
      </div>
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">支付成功</h3>
      <p className="text-sm text-zinc-500 mb-5">{selected?.name} 已开通</p>
      <div className="w-full max-w-[160px] mx-auto space-y-2">
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>即将跳转</span>
          <span className="font-mono tabular-nums">{countdown}秒</span>
        </div>
        <div className="w-full h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full bg-[linear-gradient(110deg,#0891b2,#6366f1)] rounded-full transition-all duration-1000" style={{ width: `${((3 - countdown) / 3) * 100}%` }} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-16 md:pb-0">
      <Navbar />
      <main className={`mx-auto px-4 py-8 transition-[max-width] duration-300 ${screen === "pay" ? "max-w-5xl" : "max-w-2xl"}`}>
        {/* Back button */}
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mb-6 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回
        </button>

        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-6 font-[family-name:var(--font-display)]">
          {screen === "select" ? "选择套餐" : screen === "pay" ? "确认订单" : screen === "qr" ? "扫码支付" : "支付完成"}
        </h1>

        {screen === "select" && renderSelect()}
        {screen === "pay" && renderPay()}
        {screen === "qr" && renderQR()}
        {screen === "paid" && renderPaid()}
      </main>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SubscribePageInner />
    </Suspense>
  );
}
