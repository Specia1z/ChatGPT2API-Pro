"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tag, Check, ArrowLeft, Crown, Clock, Zap, Coins, Sparkles, X, Hash } from "lucide-react";
import { BASE } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode";
import { toast } from "sonner";

const PLAN_COLORS = ["#3b82f6", "#f59e0b", "#8b5cf6"];

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
          const color = PLAN_COLORS[i % 3];
          return (
            <button key={plan.id} onClick={() => { setSelected(plan); setCouponDiscount(null); }}
              className={`relative text-left w-full rounded-2xl border-2 p-5 transition-all duration-200 ${
                active
                  ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-900 shadow-lg"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700"
              }`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{plan.name}</span>
                {active && <Check className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />}
              </div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
                  ¥{billing === "yearly" ? plan.price_yearly : plan.price_monthly}
                </span>
                <span className="text-sm text-zinc-400">/月</span>
                {billing === "yearly" && plan.price_monthly > 0 && (
                  <span className="text-sm text-zinc-400 line-through ml-1">¥{plan.price_monthly}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> {plan.concurrency} 并发</span>
                <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5" /> {plan.token_capacity} 张</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {billing === "yearly" ? (plan.duration_days_yearly || plan.duration_days * 12) : plan.duration_days}天</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2">
        {["monthly", "yearly"].map(b => (
          <button key={b} onClick={() => { setBilling(b as any); setCouponDiscount(null); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              billing === b ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}>
            {b === "monthly" ? "月付" : "年付"}
          </button>
        ))}
      </div>

      {selected && (
        <Button onClick={() => setScreen("pay")} size="lg" className="w-full h-12 text-sm font-semibold rounded-xl shadow-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200">
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
      <div className="max-w-lg mx-auto">
        {/* Receipt card */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          {/* Receipt header */}
          <div className="px-6 pt-6 pb-3 border-b border-dashed border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                <span className="text-[8px] font-black text-white dark:text-zinc-900">¥</span>
              </div>
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 tracking-wide">订单确认</span>
            </div>
            <p className="text-[10px] text-zinc-400 tracking-wide">请确认以下信息</p>
          </div>

          {/* Order items */}
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">套餐</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{selected?.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">时长</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{months} 个月 · {billing === "yearly" ? "年付" : "月付"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">小计</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">¥{originalTotal.toFixed(2)}</span>
            </div>

            {/* Coupon */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                  <input value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="优惠码" readOnly={!!couponDiscount}
                    className={`w-full h-8 rounded-lg border pl-7 pr-2 text-[11px] font-mono tracking-wider outline-none transition-colors ${
                      couponDiscount
                        ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:ring-1 focus:ring-zinc-400"
                    }`} />
                </div>
                {couponDiscount ? (
                  <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> -¥{discount.toFixed(2)}
                  </span>
                ) : (
                  <button onClick={validateCoupon} disabled={couponValidating || !couponCode.trim()}
                    className="shrink-0 h-8 px-3 rounded-lg text-[10px] font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                    {couponValidating ? "..." : "应用"}
                  </button>
                )}
              </div>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between pt-3 border-t-2 border-zinc-900 dark:border-zinc-100">
              <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">合计</span>
              <span className="text-xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
                ¥{finalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Receipt footer */}
          <div className="px-6 py-3 border-t border-dashed border-zinc-200 dark:border-zinc-800">
            <div className="flex justify-between text-[9px] text-zinc-300 dark:text-zinc-600 font-mono">
              <span>单价 ¥{total}/月</span>
              <span>{billing === "yearly" ? "年付" : "月付"} · {months}期</span>
            </div>
          </div>
        </div>

        {/* Pay button */}
        <Button onClick={handlePay} size="lg"
          className="w-full h-12 mt-4 text-sm font-semibold rounded-xl shadow-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200">
          ¥{finalPrice.toFixed(2)} — 立即支付
        </Button>
      </div>
    );
  };

  // ── QR Screen ──

  const renderQR = () => (
    <div className="max-w-sm mx-auto text-center">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">支付宝扫码支付</span>
          </div>
          <span className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">¥{(order?.amount || 0).toFixed(2)}</span>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col items-center">
          {qrCode && (
            <div className="p-2 bg-white rounded-xl shadow-sm">
              <QRCanvas text={qrCode} />
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[11px] text-zinc-400">等待支付</span>
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">打开支付宝扫码完成支付</p>
        </div>
        {order?.order_no && (
          <p className="mt-3 text-[9px] text-zinc-300 dark:text-zinc-600 font-mono">{order.order_no}</p>
        )}
      </div>
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
          <div className="h-full bg-zinc-900 dark:bg-zinc-100 rounded-full transition-all duration-1000" style={{ width: `${((3 - countdown) / 3) * 100}%` }} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-16 md:pb-0">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Back button */}
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mb-6 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回
        </button>

        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">
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
