"use client";

import { useState, useEffect, useRef } from "react";
import { BASE } from "@/lib/api";
import {
  ArrowRight, Check, Palette, Zap, Image, MessageCircle,
  Shield, Banknote, Coins, Timer, Layers, Clock
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { PaymentDialog } from "@/components/payment-dialog";
import { AnimatedPrice } from "@/components/animated-price";
import Link from "next/link";
import { toast } from "sonner";

/* ═══════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════ */

const iconMap: Record<string, any> = { Coins, Timer, Layers, Check };

function buildFeatures(p: any, billing?: string) {
  const custom = (() => { try { return JSON.parse(p.features || "[]"); } catch { return []; } })();
  const auto: { icon: string; text: string }[] = [];
  const cap = p.token_capacity || 50;
  const refill = p.token_refill_per_hour || 3;
  const conc = p.concurrency || 1;
  if (cap > 0) auto.push({ icon: "Coins", text: `图片额度 ${cap} 张` });
  if (refill > 0) auto.push({ icon: "Timer", text: `每小时恢复 ${refill} 张` });
  if (conc > 0) auto.push({ icon: "Layers", text: `同时生成 ${conc} 张` });
  const durDays = billing === "yearly" ? (p.duration_days_yearly > 0 ? p.duration_days_yearly : 0) : p.duration_days;
  if (durDays > 0) {
    const dur = durDays >= 365 ? `${Math.round(durDays / 30)}个月` : `${durDays}天`;
    auto.push({ icon: "Clock", text: `有效期 ${dur}` });
  }
  return { auto, custom };
}

/* ═══════════════════════════════════════════════
   useInView – scroll-triggered animation
   ═══════════════════════════════════════════════ */

function useInView(opts?: { once?: boolean; threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          if (opts?.once) obs.unobserve(el);
        } else if (!opts?.once) setInView(false);
      },
      { threshold: opts?.threshold ?? 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

/* ═══════════════════════════════════════════════
   Wave Divider
   ═══════════════════════════════════════════════ */

function WaveDivider({ flip, className }: { flip?: boolean; className?: string }) {
  return (
    <div className={`relative h-14 ${flip ? "-mb-14" : "-mt-14"} overflow-hidden pointer-events-none ${className || "text-white dark:text-zinc-950"}`}>
      <svg
        viewBox="0 0 1440 100"
        className="absolute bottom-0 w-full h-full"
        preserveAspectRatio="none"
        style={{ transform: flip ? "rotate(180deg)" : undefined }}
      >
        <path
          d="M0 50 C180 100, 360 0, 540 50 C720 100, 900 0, 1080 50 C1260 100, 1440 50, 1440 50 L1440 100 L0 100 Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Orbital Rings — abstract hero visual
   ═══════════════════════════════════════════════ */

function OrbitalRings() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      <div className="relative w-[600px] h-[600px] lg:w-[700px] lg:h-[700px]">
        {[280, 220, 160, 100].map((size, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              width: size * 2, height: size * 2,
              borderColor: `rgba(161,161,170,${0.08 + i * 0.04})`,
              animation: `orbSpin ${20 + i * 8}s linear infinite ${i % 2 === 0 ? "" : "reverse"}`,
            }}
          >
            <div
              className="absolute w-2 h-2 rounded-full bg-zinc-400/40 dark:bg-zinc-500/40"
              style={{ top: -4, left: "50%", marginLeft: -4 }}
            />
          </div>
        ))}
        {/* Center glow */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full bg-gradient-to-br from-zinc-300/20 to-transparent dark:from-zinc-600/10 blur-3xl" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Floating particles
   ═══════════════════════════════════════════════ */

function Particles({ count = 20 }: { count?: number }) {
  const [particles, setParticles] = useState<ReturnType<typeof makeParticles> | null>(null);

  useEffect(() => {
    setParticles(makeParticles(count));
  }, [count]);

  if (!particles) return <div className="absolute inset-0 overflow-hidden pointer-events-none" />;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-zinc-400 dark:bg-zinc-500"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            opacity: p.opacity,
            animation: `particleFloat ${p.dur}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function makeParticles(count: number) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 2 + Math.random() * 4,
    dur: 8 + Math.random() * 12,
    delay: Math.random() * 10,
    opacity: 0.15 + Math.random() * 0.35,
  }));
}

/* ── Public Stats ──────────────────────────── */

function PublicStats() {
  const [data, setData] = useState<{ total_generations: number; success_rate: number; avg_daily: number } | null>(null);
  useEffect(() => {
    fetch(`${BASE}/api/public/stats`)
      .then(r => r.json())
      .then(d => { if (d.data) setData(d.data); })
      .catch(() => {});
  }, []);
  const fmt = (n: number) => n >= 10000 ? (n / 10000).toFixed(1) + "w" : String(Math.round(n));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:gap-6 mt-10 opacity-0 animate-[heroReveal_0.6s_ease-out_0.65s_forwards]">
      {data ? (
        <>
          <StatItem value={`${fmt(data.avg_daily)}`} label="日均生成" />
          <StatItem value={`${data.success_rate.toFixed(1)}%`} label="可用率" />
          <StatItem value={`${fmt(data.total_generations)}`} label="总生成" />
        </>
      ) : (
        <>
          <StatItem value="—" label="日均生成" />
          <StatItem value="—" label="可用率" />
          <StatItem value="—" label="总生成" />
        </>
      )}
    </div>
  );
}

function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</span>
      <span className="text-[10px] text-zinc-400 tracking-wide">{label}</span>
    </div>
  );
}

/* ── Feature card (中性灰阶 · 序号+图标+排版分层) ──────────── */

function FeatureCard({
  icon: Icon, title, desc, index = 0, inView = false, hero = false,
}: {
  icon: any; title: string; desc: string; accent?: string;
  index?: number; inView?: boolean; hero?: boolean;
}) {
  return (
    <div
      className={`group relative h-full rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-900/80 overflow-hidden transition-all duration-500 ${
        hero
          ? "hover:shadow-2xl hover:shadow-zinc-900/10 dark:hover:shadow-black/30"
          : "hover:shadow-lg hover:shadow-zinc-900/5 dark:hover:shadow-black/20"
      } hover:-translate-y-0.5 hover:border-zinc-300 dark:hover:border-zinc-700`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
        transition: `all 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${index * 100}ms`,
      }}
    >
      {/* 顶部细线 — hover 加粗，中性灰 */}
      <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800 transition-all duration-500 ease-out group-hover:h-[3px] group-hover:bg-zinc-900 dark:group-hover:bg-zinc-100" />

      <div className={`relative ${hero ? "p-7" : "p-5"}`}>
        {/* 背景大序号 — 极淡灰 */}
        <div className="absolute right-3 top-3 text-[72px] font-bold leading-none select-none pointer-events-none text-zinc-100 dark:text-zinc-800/60 transition-colors duration-500 group-hover:text-zinc-200/80 dark:group-hover:text-zinc-700/60">
          {String(index + 1).padStart(2, "0")}
        </div>

        {/* 图标 — 中性底 */}
        <div className="relative w-9 h-9 rounded-xl flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all duration-300 group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:bg-zinc-900 group-hover:text-white dark:group-hover:bg-zinc-100 dark:group-hover:text-zinc-900">
          <Icon className="w-[18px] h-[18px]" />
        </div>

        <h3 className={`font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5 relative ${hero ? "text-lg" : "text-sm"}`}>
          {title}
        </h3>
        <p className={`text-zinc-500 dark:text-zinc-400 leading-relaxed relative ${hero ? "text-sm" : "text-[13px]"}`}>
          {desc}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════ */

export default function HomePage() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    site_title: "ChatGPT2API Pro",
    site_subtitle: "AI 图片生成服务",
    site_description: "基于 ChatGPT 最新模型的图片生成服务。",
  });
  const [buyPlan, setBuyPlan] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [paid, setPaid] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState<any>(null);
  const [couponValidating, setCouponValidating] = useState(false);

  useEffect(() => {
    if (paid) {
      const t = setTimeout(() => { window.location.href = "/user"; }, 3000);
      return () => clearTimeout(t);
    }
  }, [paid]);

  const validateCoupon = async () => {
    if (!couponCode.trim()) { setCouponDiscount(null); return; }
    setCouponValidating(true);
    try {
      const token = localStorage.getItem("auth-token");
      const res = await fetch(`${BASE}/api/orders/coupon/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: couponCode.trim(), plan_id: plans[0]?.id || 0, billing }),
      });
      const d = await res.json();
      if (d.data?.valid) {
        setCouponDiscount(d.data);
        toast.success(`优惠码已应用: ${d.data.discount_type === "percent" ? d.data.discount_value + "%" : "¥" + d.data.discount_value}折扣`);
      } else {
        setCouponDiscount(null);
        toast.error(d.data?.message || "优惠码无效");
      }
    } catch { toast.error("校验失败"); }
    setCouponValidating(false);
  };

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((d) => {
        if (d.data) { setSettings(d.data); document.title = d.data.site_title || "ChatGPT2API Pro"; }
      })
      .catch(() => {});
    fetch(`${BASE}/api/plans`)
      .then((r) => r.json())
      .then((d) => { if (d.data) setPlans(d.data); })
      .catch(() => {});
  }, []);

  /* ── Payment ──────────────────────────── */

  const handleBuy = async (plan: any) => {
    // Check auth FIRST — before any state change
    const token = localStorage.getItem("auth-token");
    if (!token) { window.location.href = "/login"; return; }
    setBuyPlan(plan);
    setOrder(null);
    setQrCode(null);
    setPaid(false);
    try {
      const res = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: plan.id, billing }),
      });
      if (res.status === 401) { setBuyPlan(null); window.location.href = "/login"; return; }
      const data = await res.json();
      if (data.data?.qr_code) {
        setOrder(data.data.order);
        setQrCode(data.data.qr_code);
        // Start polling
        setPolling(true);
        const pollInterval = setInterval(async () => {
          try {
            const r = await fetch(`${BASE}/api/orders/${data.data.order.order_no}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (r.status === 401) { clearInterval(pollInterval); setPolling(false); setBuyPlan(null); window.location.href = "/login"; return; }
            const pd = await r.json();
            if (pd.data?.status === "paid") {
              setPaid(true);
              setPolling(false);
              clearInterval(pollInterval);
            }
          } catch {}
        }, 3000);
      } else {
        setOrder(data.data?.order || data.data);
        setQrCode(null);
      }
    } catch {}
  };

  const featRef = useInView({ once: true, threshold: 0.1 });
  const priceRef = useInView({ once: true, threshold: 0.1 });

  /* ── Feature definitions ── */
  const features = [
    { icon: Palette, title: "无限风格", desc: "从照片级写实到动漫插画，从油画到赛博朋克，数百种艺术风格任你选择" },
    { icon: Zap, title: "极速生成", desc: "平均 30 秒完成创作，多任务并发处理，告别漫长等待" },
    { icon: Image, title: "高清输出", desc: "支持 8K 分辨率，细节清晰锐利，可直接用于商业项目" },
    { icon: MessageCircle, title: "简单易用", desc: "用自然语言描述想法，像聊天一样简单，零学习成本" },
    { icon: Shield, title: "安全可靠", desc: "99.9% 可用率，加密传输，保护你的创作隐私和数据安全" },
    { icon: Banknote, title: "灵活定价", desc: "从免费体验到企业定制，按需选择方案，随时升级不设限" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <Navbar />

      {/* ═══════════════════════════════════════
          HERO
          ═══════════════════════════════════════ */}
      <section className="relative min-h-[88vh] md:min-h-[90vh] flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-zinc-50 dark:bg-zinc-950" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(161,161,170,0.08)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_60%_at_30%_50%,black_20%,transparent_80%)]" />

        {/* Orbital rings — right side visual */}
        <div className="absolute right-[-10%] top-1/2 -translate-y-1/2 hidden md:block">
          <OrbitalRings />
        </div>

        <Particles count={10} />

        {/* Content — left-aligned */}
        <div className="relative w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-16 py-16 z-10">
          <div className="max-w-2xl">
            {/* Tag */}
            <div className="mb-6 opacity-0 animate-[heroReveal_0.6s_ease-out_0.1s_forwards]">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3.5 py-1 backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inset-0 rounded-full bg-zinc-400 dark:bg-zinc-500 opacity-75" />
                  <span className="relative rounded-full h-1.5 w-1.5 bg-zinc-500 dark:bg-zinc-400" />
                </span>
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 tracking-wide">
                  AI Image Generation · Open API
                </span>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[0.95] mb-5 opacity-0 animate-[heroReveal_0.7s_ease-out_0.2s_forwards]">
              <span className="block text-zinc-900 dark:text-zinc-100">
                {settings.site_subtitle?.split(" ")[0] || "AI"}
              </span>
              <span className="block bg-gradient-to-r from-zinc-900 via-zinc-500 to-zinc-400 dark:from-zinc-100 dark:via-zinc-400 dark:to-zinc-600 bg-clip-text text-transparent">
                {settings.site_subtitle?.split(" ").slice(1).join(" ") || settings.site_subtitle || "图片生成服务"}
              </span>
            </h1>

            {/* Description */}
            <p className="text-base md:text-lg text-zinc-500 dark:text-zinc-400 max-w-md leading-relaxed mb-8 opacity-0 animate-[heroReveal_0.6s_ease-out_0.35s_forwards]">
              {settings.site_description}
            </p>

            {/* CTAs */}
            <div className="flex items-center gap-3 opacity-0 animate-[heroReveal_0.6s_ease-out_0.5s_forwards]">
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-7 h-11 text-sm font-semibold hover:-translate-y-0.5 hover:shadow-xl hover:shadow-zinc-900/15 dark:hover:shadow-zinc-100/15 transition-all duration-300"
              >
                开始使用
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="#features"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-7 h-11 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
              >
                了解更多
              </Link>
            </div>

            {/* Stats strip */}
            <PublicStats />
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-5 sm:left-8 lg:left-16 opacity-0 animate-[heroReveal_0.6s_ease-out_0.8s_forwards]">
          <div className="flex items-center gap-2 text-zinc-400">
            <div className="w-4 h-7 rounded-full border border-zinc-300 dark:border-zinc-700 flex items-start justify-center p-1">
              <div className="w-0.5 h-1.5 rounded-full bg-zinc-400 animate-[scrollDot_2s_ease-in-out_infinite]" />
            </div>
            <span className="text-[10px] tracking-wider uppercase">Scroll</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          FEATURES
          ═══════════════════════════════════════ */}
      <WaveDivider />

      <section id="features" className="relative py-16 sm:py-24 overflow-hidden bg-white dark:bg-zinc-950">
        <Particles count={8} />

        <div className="relative max-w-6xl mx-auto px-6" ref={featRef.ref}>
          {/* Section header — left-aligned with decorative diamond */}
          <div
            className="mb-10 sm:mb-16 transition-all duration-700"
            style={{
              opacity: featRef.inView ? 1 : 0,
              transform: featRef.inView ? "translateY(0)" : "translateY(30px)",
            }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">✦</span>
              </div>
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 px-3.5 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-4 tracking-wide">
                Why Choose Us
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3">
                让创意变为现实
              </h2>
              <p className="text-base text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xl">
                无需任何技术背景，输入文字描述，AI 即刻为你创作精美图片
              </p>
            </div>
          </div>

          {/* Feature grid — asymmetric */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Hero card — 2 cols */}
            <div className="md:col-span-2 md:row-span-2">
              <FeatureCard {...features[0]} hero index={0} inView={featRef.inView} />
            </div>
            <FeatureCard {...features[1]} index={1} inView={featRef.inView} />
            <FeatureCard {...features[2]} index={2} inView={featRef.inView} />
            <FeatureCard {...features[3]} index={3} inView={featRef.inView} />
            <FeatureCard {...features[4]} index={4} inView={featRef.inView} />
            <div className="md:col-span-3">
              <FeatureCard {...features[5]} index={5} inView={featRef.inView} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          PRICING
          ═══════════════════════════════════════ */}
      <WaveDivider flip className="text-zinc-50 dark:text-zinc-900" />

      <section id="pricing" className="relative py-16 sm:py-24 overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/50">
        <Particles count={8} />

        <div className="relative max-w-5xl mx-auto px-6" ref={priceRef.ref}>
          {/* Section header — left-aligned with diamond accent */}
          <div
            className="mb-14 transition-all duration-700"
            style={{
              opacity: priceRef.inView ? 1 : 0,
              transform: priceRef.inView ? "translateY(0)" : "translateY(30px)",
            }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">◆</span>
              </div>
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 px-3.5 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-4 tracking-wide">
                Pricing
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3">
                选择适合你的方案
              </h2>
              <p className="text-base text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xl">
                从免费开始，按需升级。所有方案都包含 AI 图片生成核心功能
              </p>

              {/* Segmented control toggle — refined pill */}
              <div className="inline-flex items-center rounded-xl bg-zinc-100 dark:bg-zinc-800 p-0.5 mt-6">
                <button
                  onClick={() => setBilling("monthly")}
                  className={`relative px-5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    billing === "monthly"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  月付
                </button>
                <button
                  onClick={() => setBilling("yearly")}
                  className={`relative px-5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    billing === "yearly"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  年付
                  {(() => {
                    const best = plans.reduce((max: number, p: any) => {
                      if (!p.price_monthly || !p.price_yearly) return max;
                      return Math.max(max, Math.round((1 - p.price_yearly / p.price_monthly) * 100));
                    }, 0);
                    return best > 0 ? (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-zinc-900 dark:bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold text-white dark:text-zinc-900">
                        省 {best}%
                      </span>
                    ) : null;
                  })()}
                </button>
              </div>
            </div>
          </div>


          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            {plans.map((p, i) => {
              return (
                <PlanCard
                  key={p.id || i}
                  p={p}
                  billing={billing}
                  inView={priceRef.inView}
                  delay={i * 100}
                  onBuy={handleBuy}
                  index={i}
                />
              );
            })}
          </div>
        </div>

        {/* CTA section — split layout with signal visual */}
        <div
          className="relative max-w-3xl mx-auto mt-16 px-6 transition-all duration-700 delay-300"
          style={{
            opacity: priceRef.inView ? 1 : 0,
            transform: priceRef.inView ? "translateY(0)" : "translateY(30px)",
          }}
        >
          <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
            {/* Left gradient accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-zinc-300 via-zinc-500 to-zinc-300 dark:from-zinc-700 dark:via-zinc-400 dark:to-zinc-700" />

            <div className="relative flex items-center gap-6 p-6 sm:p-10">
              {/* ── Text side ── */}
              <div className="flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">✦</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white mb-2">
                  准备好开始创作了吗？
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
                  免费注册即可体验 AI 图片生成的无限可能
                </p>
                <Link
                  href="/register"
                  className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-7 h-11 text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-lg shadow-zinc-900/10 dark:shadow-white/10"
                >
                  免费开始
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
                </Link>
              </div>

              {/* ── Visual side — concentric pulse rings ── */}
              <div className="hidden md:flex items-center justify-center w-28 h-28 shrink-0">
                <div className="relative w-24 h-24">
                  <div className="absolute inset-0 rounded-full border border-zinc-200 dark:border-zinc-700 animate-[ctaSignal_3s_ease-in-out_infinite]" />
                  <div className="absolute inset-3 rounded-full border border-zinc-300 dark:border-zinc-600 animate-[ctaSignal_3s_ease-in-out_infinite_0.6s]" />
                  <div className="absolute inset-6 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shadow-lg">
                    <ArrowRight className="w-4 h-4 text-white dark:text-zinc-900" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          PAYMENT DIALOG
          ═══════════════════════════════════════ */}
      <PaymentDialog
        open={!!buyPlan}
        onClose={() => { setBuyPlan(null); setOrder(null); setQrCode(null); setPaid(false); }}
        plan={buyPlan}
        order={order}
        qrCode={qrCode}
        polling={polling}
        paid={paid}
      />

      {/* ═══════════════════════════════════════
          FOOTER — studio sign-off
          ═══════════════════════════════════════ */}
      <footer className="border-t border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
        {/* Gradient top line */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-zinc-200 dark:via-zinc-700 to-transparent" />

        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
                  <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-4 h-4 object-contain" />
                ) : (
                  <span className="text-[9px] font-black text-white dark:text-zinc-900 tracking-tighter">{settings?.site_logo_text || "C2"}</span>
                )}
              </div>
              <div>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{settings.site_title}</span>
                <span className="text-[10px] text-zinc-400 ml-1.5">AI Image Generation</span>
              </div>
            </div>

            {/* Links */}
            <div className="flex items-center gap-4">
              <span className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-default">隐私政策</span>
              <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-default">服务条款</span>
            </div>
          </div>

          {/* Separator */}
          <div className="mt-5 mb-3 border-t border-zinc-100 dark:border-zinc-800/50" />

          {/* Copyright */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-400">
              © 2026 {settings.site_title}. All rights reserved.
            </p>
            <p className="text-[9px] text-zinc-300 dark:text-zinc-600 font-mono">
              v{process.env.NEXT_PUBLIC_VERSION || "2.0"}
            </p>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════
          GLOBAL KEYFRAMES
          ═══════════════════════════════════════ */}
      <style jsx global>{`
        /* Orbital rings */
        @keyframes orbSpin {
          0%   { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }

        /* Hero text reveal */
        @keyframes heroReveal {
          0%   { opacity: 0; transform: translateY(36px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* Scroll indicator dot */
        @keyframes scrollDot {
          0%, 100% { transform: translateY(0); opacity: 1; }
          50%  { transform: translateY(8px); opacity: 0.3; }
        }

        /* Floating particles */
        @keyframes particleFloat {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.25; }
          25%  { transform: translate(30px, -40px) scale(1.3); opacity: 0.5; }
          50%  { transform: translate(-20px, -80px) scale(0.8); opacity: 0.15; }
          75%  { transform: translate(10px, -50px) scale(1.1); opacity: 0.35; }
        }

        /* CTA signal pulse */
        @keyframes ctaSignal {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50%  { transform: scale(1.1); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Plan Card — 中性灰阶（推荐款靠边框/ring/深色按钮突出，不靠彩色）
   ═══════════════════════════════════════════════ */

function PlanCard({
  p, billing, inView, delay, onBuy, index,
}: {
  p: any; billing: string; inView: boolean; delay: number; onBuy: (plan: any) => void;
  index: number;
}) {
  const { auto, custom } = buildFeatures(p, billing);
  const allFeatures = [...auto, ...custom.map((t: string) => ({ icon: "Check", text: t }))];

  return (
    <div
      className={`relative flex flex-col bg-white dark:bg-zinc-900/80 border rounded-2xl overflow-hidden transition-all duration-500 ${
        p.highlighted
          ? "border-zinc-900 dark:border-zinc-100 ring-1 ring-zinc-900 dark:ring-zinc-100 shadow-xl shadow-zinc-900/10 dark:shadow-black/30 md:scale-[1.03]"
          : "border-zinc-200/60 dark:border-zinc-800/50 hover:shadow-lg hover:-translate-y-0.5 hover:border-zinc-300 dark:hover:border-zinc-700"
      }`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
        transition: `all 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {/* 顶部条 — 推荐款深色实条，其余极淡灰 */}
      <div className={`h-[3px] w-full shrink-0 ${p.highlighted ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"}`} />

      {/* POPULAR 徽章 — 深色 */}
      {p.highlighted && (
        <div className="absolute top-3 right-3 z-10">
          <span className="inline-flex items-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2 py-0.5 text-[9px] font-bold tracking-wider">
            POPULAR
          </span>
        </div>
      )}

      <div className="p-6 flex flex-col flex-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">{p.name}</h3>

        <div className="mb-5">
          <div className="flex items-baseline gap-0.5">
            <span className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">¥</span>
            {p.price_monthly === 0 ? (
              <span className="text-4xl font-bold text-zinc-900 dark:text-white tabular-nums">0</span>
            ) : (
              <AnimatedPrice
                value={Number(billing === "yearly" ? p.price_yearly : p.price_monthly)}
                className="text-4xl font-bold text-zinc-900 dark:text-white tabular-nums"
              />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-400">/月</span>
            {billing === "yearly" && p.price_monthly > 0 && (
              <span className="text-[10px] text-zinc-400 line-through">{p.price_monthly}/月</span>
            )}
          </div>
        </div>

        <ul className="space-y-2.5 mb-6 flex-1">
          {allFeatures.map((f: any, j: number) => {
            const Icon = iconMap[f.icon] || Check;
            return (
              <li key={j} className="flex items-start gap-2.5">
                <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-900 dark:text-zinc-100" />
                <span className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">{f.text}</span>
              </li>
            );
          })}
        </ul>

        <Link
          href={p.price_monthly === 0 ? "/register" : `/subscribe?plan_id=${p.id}&billing=${billing}`}
          className={`inline-flex items-center justify-center w-full rounded-xl text-xs font-semibold h-10 transition-all ${
            p.highlighted
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-sm"
              : "border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {p.price_monthly === 0 ? "免费开始" : "立即订阅"}
        </Link>
      </div>
    </div>
  );
}
