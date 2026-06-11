"use client";

import { useState, useEffect, useRef } from "react";
import { BASE } from "@/lib/api";
import {
  ArrowRight, Check, Palette, Zap, Image, MessageCircle,
  Shield, Banknote, Coins, Timer, Layers, Clock, Loader2, Sparkles, Gauge,
  Mail, Globe
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { useAuth } from "@/lib/auth";
import { PaymentDialog } from "@/components/payment-dialog";
import { AnimatedPrice } from "@/components/animated-price";
import Link from "next/link";
import { toast } from "sonner";

/* ═══════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════ */

const iconMap: Record<string, any> = { Coins, Timer, Layers, Clock, Check, Gauge };

function buildFeatures(p: any, billing?: string) {
  const custom = (() => { try { return JSON.parse(p.features || "[]"); } catch { return []; } })();
  const auto: { icon: string; text: string }[] = [];
  const cap = p.token_capacity || 50;
  const refill = p.token_refill_per_hour || 3;
  const conc = p.concurrency || 1;
  const apiRate = p.rate_limit_per_min || 30;
  if (cap > 0) auto.push({ icon: "Coins", text: `图片额度 ${cap} 张` });
  if (refill > 0) auto.push({ icon: "Timer", text: `每小时恢复 ${refill} 张` });
  if (conc > 0) auto.push({ icon: "Layers", text: `同时生成 ${conc} 张` });
  auto.push({ icon: "Gauge", text: `API 速率 ${apiRate} 次/分钟` });
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
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-8 mt-12 opacity-0 animate-[heroReveal_0.6s_ease-out_0.65s_forwards]">
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
      <span className="text-xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{value}</span>
      <span className="text-[10px] text-zinc-400 dark:text-white/40 tracking-wide uppercase">{label}</span>
    </div>
  );
}

/* ── Footer 导航列 ──────────────────────────── */

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold tracking-[0.12em] uppercase text-zinc-400 dark:text-white/40 mb-4">
        {title}
      </h4>
      <ul className="space-y-3">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-[13px] text-zinc-600 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Feature card（光谱主题色 · 序号+图标+排版分层 · hover 发光） ──────────── */

// 各 accent 的配色集合（icon 渐变 / hover 光晕 / hover 边框 / 大序号 hover 色）
const ACCENTS: Record<string, { grad: string; glow: string; ring: string; num: string }> = {
  cyan:    { grad: "from-cyan-400 to-sky-500",      glow: "rgba(34,211,238,0.18)",  ring: "group-hover:border-cyan-400/40",    num: "group-hover:text-cyan-500/15" },
  amber:   { grad: "from-amber-400 to-orange-500",  glow: "rgba(251,191,36,0.18)",  ring: "group-hover:border-amber-400/40",   num: "group-hover:text-amber-500/15" },
  violet:  { grad: "from-violet-400 to-indigo-500", glow: "rgba(139,92,246,0.18)",  ring: "group-hover:border-violet-400/40",  num: "group-hover:text-violet-500/15" },
  fuchsia: { grad: "from-fuchsia-400 to-pink-500",  glow: "rgba(232,121,249,0.18)", ring: "group-hover:border-fuchsia-400/40", num: "group-hover:text-fuchsia-500/15" },
  emerald: { grad: "from-emerald-400 to-teal-500",  glow: "rgba(16,185,129,0.18)",  ring: "group-hover:border-emerald-400/40", num: "group-hover:text-emerald-500/15" },
  indigo:  { grad: "from-indigo-400 to-blue-500",   glow: "rgba(99,102,241,0.18)",  ring: "group-hover:border-indigo-400/40",  num: "group-hover:text-indigo-500/15" },
};

function FeatureCard({
  icon: Icon, title, desc, index = 0, inView = false, hero = false, accent = "cyan",
}: {
  icon: any; title: string; desc: string; accent?: string;
  index?: number; inView?: boolean; hero?: boolean;
}) {
  const a = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div
      className={`group relative h-full rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl overflow-hidden transition-all duration-500 hover:-translate-y-1.5 hover:bg-white/80 dark:hover:bg-white/[0.06] hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.25)] ${a.ring}`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
        transition: `all 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${index * 100}ms`,
      }}
    >
      {/* hover 时透出的主题色光晕（左上角放射） */}
      <div
        className="absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(120% 80% at 0% 0%, ${a.glow}, transparent 60%)` }}
      />
      {/* 顶部光谱细线 — hover 加粗渐显 */}
      <div className={`relative h-px w-full bg-zinc-200/60 dark:bg-white/10 transition-all duration-500 ease-out group-hover:h-[3px] group-hover:bg-gradient-to-r ${a.grad}`} />

      <div className={`relative ${hero ? "p-7" : "p-6"}`}>
        {/* 背景大序号 — hover 透出主题色 */}
        <div className={`absolute right-3 top-3 text-[72px] font-bold leading-none select-none pointer-events-none text-zinc-900/[0.04] dark:text-white/[0.04] transition-colors duration-500 ${a.num} font-[family-name:var(--font-display)]`}>
          {String(index + 1).padStart(2, "0")}
        </div>

        {/* 图标 — 主题色渐变底，hover 放大发光 */}
        <div
          className={`relative w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${a.grad} text-white shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:-translate-y-0.5`}
          style={{ boxShadow: `0 6px 20px -6px ${a.glow.replace("0.18", "0.5")}` }}
        >
          <Icon className="w-5 h-5" />
        </div>

        <h3 className={`font-semibold text-zinc-900 dark:text-white mb-2 relative ${hero ? "text-lg" : "text-base"}`}>
          {title}
        </h3>
        <p className={`text-zinc-500 dark:text-white/55 leading-relaxed relative ${hero ? "text-sm" : "text-[13px]"}`}>
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
  const { user, loading: authLoading } = useAuth();
  // 已登录直达创作中心，未登录去注册
  const ctaHref = user ? "/create" : "/register";
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
  // Hero 副标题轮播：在多个卖点间切换（首项为站点配置的副标题）
  const [subIdx, setSubIdx] = useState(0);
  const subtitles = [settings.site_subtitle || "AI 图片生成服务", "矢量设计 · 一键生成 SVG", "图生图 · 智能增强", "OpenAI 兼容 · 开放 API"];
  useEffect(() => {
    const t = setInterval(() => setSubIdx((i) => (i + 1) % subtitles.length), 2800);
    return () => clearInterval(t);
  }, [subtitles.length]);
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

  /* ── Feature definitions（每张卡分配一个光谱主题色） ── */
  const features = [
    { icon: Palette, title: "无限风格", desc: "从照片级写实到动漫插画，从油画到赛博朋克，数百种艺术风格任你选择", accent: "cyan" },
    { icon: Zap, title: "极速生成", desc: "平均 30 秒完成创作，多任务并发处理，告别漫长等待", accent: "amber" },
    { icon: Image, title: "高清输出", desc: "高分辨率细节清晰锐利，画质出众，可直接用于商业项目", accent: "violet" },
    { icon: MessageCircle, title: "简单易用", desc: "用自然语言描述想法，像聊天一样简单，零学习成本", accent: "fuchsia" },
    { icon: Shield, title: "安全可靠", desc: "99.9% 可用率，加密传输，保护你的创作隐私和数据安全", accent: "emerald" },
    { icon: Banknote, title: "灵活定价", desc: "从免费体验到企业定制，按需选择方案，随时升级不设限", accent: "indigo" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <Navbar />

      {/* ═══════════════════════════════════════════════════════════════
          连续流体舞台 — hero / features / pricing 共用同一张流体画布，
          色彩从头到尾不间断流动，彻底消除区块间的纯色拼接死区。
          ═══════════════════════════════════════════════════════════════ */}
      <div className="relative bg-[#fbfbfd] dark:bg-[#06070d] overflow-hidden">
        {/* ════ 贯穿全程的流体色斑：沿整段高度（top 0%→90%）连续分布，永不断流 ════ */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* 顶部 · hero 区 — 较浓，整屏即画 */}
          <div className="absolute top-[-8%] left-[-8%] w-[52vw] h-[52vw] rounded-full blur-[110px] opacity-55 dark:opacity-55 mix-blend-multiply dark:mix-blend-screen bg-[#22d3ee] [will-change:transform]" style={{ animation: "fluidA 16s ease-in-out infinite" }} />
          <div className="absolute top-[2%] right-[-6%] w-[48vw] h-[48vw] rounded-full blur-[110px] opacity-50 dark:opacity-55 mix-blend-multiply dark:mix-blend-screen bg-[#e879f9] [will-change:transform]" style={{ animation: "fluidC 18s ease-in-out infinite" }} />
          <div className="absolute top-[12%] left-[26%] w-[46vw] h-[46vw] rounded-full blur-[110px] opacity-50 dark:opacity-50 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidB 20s ease-in-out infinite" }} />
          {/* 中部 · features 区 — 中等，色彩自 hero 流淌下来 */}
          <div className="absolute top-[34%] left-[0%] w-[44vw] h-[44vw] rounded-full blur-[120px] opacity-38 dark:opacity-42 mix-blend-multiply dark:mix-blend-screen bg-[#fb7185] [will-change:transform]" style={{ animation: "fluidD 24s ease-in-out infinite" }} />
          <div className="absolute top-[44%] right-[2%] w-[42vw] h-[42vw] rounded-full blur-[120px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#22d3ee] [will-change:transform]" style={{ animation: "fluidE 22s ease-in-out infinite" }} />
          {/* 下部 · features→pricing 衔接 — 持续不断流 */}
          <div className="absolute top-[60%] left-[18%] w-[46vw] h-[46vw] rounded-full blur-[120px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#a78bfa] [will-change:transform]" style={{ animation: "fluidB 26s ease-in-out infinite" }} />
          {/* 底部 · pricing 区 — 渐弱，向 footer 自然收束 */}
          <div className="absolute top-[76%] right-[6%] w-[44vw] h-[44vw] rounded-full blur-[120px] opacity-32 dark:opacity-38 mix-blend-multiply dark:mix-blend-screen bg-[#fbbf24] [will-change:transform]" style={{ animation: "fluidC 25s ease-in-out infinite" }} />
          <div className="absolute top-[88%] left-[4%] w-[42vw] h-[42vw] rounded-full blur-[120px] opacity-28 dark:opacity-35 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidA 23s ease-in-out infinite" }} />
        </div>

        {/* 全局柔光蒙版：整体压一层半透底色提升文字/卡片可读性，
            但不淡成纯色 —— 保持色彩从头到尾连续可见，无死区。 */}
        <div className="absolute inset-0 bg-[rgba(251,251,253,0.35)] dark:bg-[rgba(6,7,13,0.45)]" />

        {/* 胶片颗粒，给纯色块加质感 */}
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      {/* ═══════════════════════════════════════
          HERO
          ═══════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden text-zinc-800 dark:text-zinc-100">
        {/* ════ 居中内容 ════ */}
        <div className="relative w-full max-w-3xl mx-auto px-6 flex flex-col items-center text-center z-10">
          {/* Kicker */}
          <div className="mb-8 opacity-0 animate-[heroReveal_0.6s_ease-out_0.1s_forwards]">
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] px-4 py-1.5 backdrop-blur-md text-[11px] font-medium text-zinc-600 dark:text-white/70 tracking-[0.14em] uppercase">
              <Sparkles className="w-3 h-3" />
              AI Image Generation · Open API
            </span>
          </div>

          {/* Title — 逐字浮现 + 流动彩色渐变 */}
          <h1 className="text-[3.2rem] sm:text-7xl md:text-[6rem] font-bold tracking-[-0.04em] leading-[0.98] mb-7 [text-wrap:balance]">
            {Array.from(String(settings.site_title || "ChatGPT2API Pro")).map((ch, i) => (
              <span
                key={i}
                className="inline-block opacity-0 animate-[charRise_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] bg-[linear-gradient(110deg,#0891b2,#6366f1_35%,#c026d3_65%,#0891b2)] dark:bg-[linear-gradient(110deg,#22d3ee,#818cf8_35%,#e879f9_65%,#22d3ee)] bg-[length:200%_auto] bg-clip-text text-transparent"
                style={{ animationDelay: `${0.2 + i * 0.045}s`, animation: `charRise 0.6s cubic-bezier(0.16,1,0.3,1) ${0.2 + i * 0.045}s forwards, spectralFlow 6s ease-in-out infinite` }}
              >
                {ch === " " ? " " : ch}
              </span>
            ))}
          </h1>

          {/* Subtitle — 多卖点轮播（淡入淡出 + 轻微上浮） */}
          <div className="relative h-8 sm:h-9 mb-3 w-full opacity-0 animate-[heroReveal_0.6s_ease-out_0.4s_forwards]">
            {subtitles.map((s, i) => (
              <p
                key={i}
                className="absolute inset-0 flex items-center justify-center text-xl sm:text-2xl font-semibold tracking-tight text-zinc-700 dark:text-white/90 transition-all duration-700 ease-out"
                style={{
                  opacity: subIdx === i ? 1 : 0,
                  transform: subIdx === i ? "translateY(0)" : "translateY(8px)",
                  pointerEvents: subIdx === i ? "auto" : "none",
                }}
              >
                {s}
              </p>
            ))}
          </div>
          <p className="text-base md:text-lg text-zinc-500 dark:text-white/55 max-w-xl leading-relaxed mb-10 opacity-0 animate-[heroReveal_0.6s_ease-out_0.5s_forwards]">
            {settings.site_description}
          </p>

          {/* CTAs */}
          <div className="flex items-center justify-center gap-3 opacity-0 animate-[heroReveal_0.6s_ease-out_0.55s_forwards]">
            <Link
              href={ctaHref}
              aria-disabled={authLoading}
              onClick={(e) => { if (authLoading) e.preventDefault(); }}
              className={`group relative overflow-hidden inline-flex items-center gap-2 rounded-full px-8 h-[3.25rem] text-sm font-semibold transition-all duration-300 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 ${authLoading ? "opacity-70 cursor-wait pointer-events-none" : "hover:-translate-y-0.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] dark:shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] hover:shadow-[0_16px_50px_-10px_rgba(0,0,0,0.6)]"}`}
            >
              {/* hover 时扫过的高光 */}
              {!authLoading && (
                <span className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.45)_50%,transparent_70%)] dark:bg-[linear-gradient(110deg,transparent_30%,rgba(0,0,0,0.18)_50%,transparent_70%)]" />
              )}
              {authLoading ? (
                <>加载中 <Loader2 className="w-4 h-4 animate-spin" /></>
              ) : (
                <span className="relative inline-flex items-center gap-2">{user ? "开始创作" : "开始使用"} <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></span>
              )}
            </Link>
            <Link
              href="#features"
              className="inline-flex items-center rounded-full border border-zinc-900/15 bg-white/40 text-zinc-700 hover:bg-white/70 hover:text-zinc-900 dark:border-white/20 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.1] dark:hover:text-white px-8 h-[3.25rem] text-sm font-medium transition-all backdrop-blur-md"
            >
              了解更多
            </Link>
          </div>

          {/* Stats strip */}
          <PublicStats />
        </div>
      </section>

      {/* ═══════════════════════════════════════
          WHY CHOOSE US — 透明背景，叠在连续流体画布上
          ═══════════════════════════════════════ */}
      <section id="features" className="relative overflow-hidden pt-10 sm:pt-16 pb-24 sm:pb-32">
        <div className="relative max-w-6xl mx-auto px-6" ref={featRef.ref}>
          {/* 居中标题区 — 与英雄区居中排版统一 */}
          <div
            className="text-center max-w-2xl mx-auto mb-14 sm:mb-20 transition-all duration-700"
            style={{
              opacity: featRef.inView ? 1 : 0,
              transform: featRef.inView ? "translateY(0)" : "translateY(30px)",
            }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] px-4 py-1.5 backdrop-blur-md text-[11px] font-medium text-zinc-600 dark:text-white/70 tracking-[0.14em] uppercase mb-6">
              <Sparkles className="w-3 h-3" />
              Why Choose Us
            </span>
            <h2 className="text-4xl sm:text-5xl md:text-[3.5rem] font-semibold tracking-[-0.03em] leading-[1.05] text-zinc-900 dark:text-white mb-4 font-[family-name:var(--font-display)] [text-wrap:balance]">
              让创意变为现实
            </h2>
            <p className="text-base sm:text-lg text-zinc-500 dark:text-white/55 leading-relaxed">
              无需任何技术背景，输入文字描述，AI 即刻为你创作精美图片
            </p>
          </div>

          {/* 玻璃拟态卡片网格 — 均衡三列 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {features.map((f, i) => (
              <FeatureCard key={i} {...f} index={i} inView={featRef.inView} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          PRICING — 透明背景，延续同一张连续流体画布
          ═══════════════════════════════════════ */}
      <section id="pricing" className="relative overflow-hidden pt-12 sm:pt-20 pb-24 sm:pb-32">
        <div className="relative max-w-5xl mx-auto px-6" ref={priceRef.ref}>
          {/* 居中标题区 — 与英雄区/Why Choose Us 统一 */}
          <div
            className="text-center max-w-2xl mx-auto mb-14 sm:mb-16 transition-all duration-700"
            style={{
              opacity: priceRef.inView ? 1 : 0,
              transform: priceRef.inView ? "translateY(0)" : "translateY(30px)",
            }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] px-4 py-1.5 backdrop-blur-md text-[11px] font-medium text-zinc-600 dark:text-white/70 tracking-[0.14em] uppercase mb-6">
              <Sparkles className="w-3 h-3" />
              Pricing
            </span>
            <h2 className="text-4xl sm:text-5xl md:text-[3.5rem] font-semibold tracking-[-0.03em] leading-[1.05] text-zinc-900 dark:text-white mb-4 font-[family-name:var(--font-display)] [text-wrap:balance]">
              选择适合你的方案
            </h2>
            <p className="text-base sm:text-lg text-zinc-500 dark:text-white/55 leading-relaxed mb-8">
              从免费开始，按需升级。所有方案都包含 AI 图片生成核心功能
            </p>

            {/* 月付/年付切换 — 圆角胶囊，与全站统一 */}
            <div className="inline-flex items-center rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] backdrop-blur-md p-1">
              <button
                onClick={() => setBilling("monthly")}
                className={`relative px-6 py-2 rounded-full text-xs font-medium transition-all duration-200 ${
                  billing === "monthly"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm"
                    : "text-zinc-500 dark:text-white/60 hover:text-zinc-800 dark:hover:text-white"
                }`}
              >
                月付
              </button>
              <button
                onClick={() => setBilling("yearly")}
                className={`relative px-6 py-2 rounded-full text-xs font-medium transition-all duration-200 ${
                  billing === "yearly"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm"
                    : "text-zinc-500 dark:text-white/60 hover:text-zinc-800 dark:hover:text-white"
                }`}
              >
                年付
                {(() => {
                  const best = plans.reduce((max: number, p: any) => {
                    if (!p.price_monthly || !p.price_yearly) return max;
                    return Math.max(max, Math.round((1 - p.price_yearly / p.price_monthly) * 100));
                  }, 0);
                  return best > 0 ? (
                    <span className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ${billing === "yearly" ? "bg-white/20 text-white dark:bg-zinc-900/15 dark:text-zinc-900" : "bg-gradient-to-r from-cyan-500 to-violet-500 text-white"}`}>
                      省 {best}%
                    </span>
                  ) : null;
                })()}
              </button>
            </div>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mt-6 md:px-2 md:py-3">
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

        {/* CTA section — 居中收尾，流体光晕烘托，轻盈对称 */}
        <div
          className="relative max-w-2xl mx-auto mt-24 sm:mt-32 px-6 text-center transition-all duration-700 delay-300"
          style={{
            opacity: priceRef.inView ? 1 : 0,
            transform: priceRef.inView ? "translateY(0)" : "translateY(30px)",
          }}
        >
          {/* 背景流体光晕 — 与全站色系一致，柔和烘托 */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-16 w-[34rem] h-72 rounded-full blur-[110px] opacity-30 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[radial-gradient(circle,#6366f1,#e879f9_45%,transparent_72%)] pointer-events-none [will-change:transform]" style={{ animation: "fluidA 20s ease-in-out infinite" }} />

          {/* 图标 */}
          <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-7 bg-zinc-900 dark:bg-white shadow-[0_8px_30px_-6px_rgba(0,0,0,0.4)] dark:shadow-[0_8px_30px_-6px_rgba(255,255,255,0.3)]">
            <Sparkles className="w-6 h-6 text-white dark:text-zinc-900" />
          </div>

          <h2 className="relative text-3xl sm:text-4xl md:text-[3rem] font-semibold tracking-[-0.03em] leading-[1.05] text-zinc-900 dark:text-white mb-4 font-[family-name:var(--font-display)] [text-wrap:balance]">
            准备好开始创作了吗？
          </h2>
          <p className="relative text-base sm:text-lg text-zinc-500 dark:text-white/55 mb-9 max-w-md mx-auto leading-relaxed">
            {user ? "进入创作中心，开启你的 AI 图片生成之旅" : "免费注册即可体验 AI 图片生成的无限可能"}
          </p>
          <Link
            href={ctaHref}
            aria-disabled={authLoading}
            onClick={(e) => { if (authLoading) e.preventDefault(); }}
            className={`group relative inline-flex items-center gap-2 rounded-full px-8 h-[3.25rem] text-sm font-semibold transition-all duration-300 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 ${authLoading ? "opacity-70 cursor-wait pointer-events-none" : "hover:-translate-y-0.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] dark:shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] hover:shadow-[0_16px_50px_-10px_rgba(0,0,0,0.6)]"}`}
          >
            {authLoading ? (
              <>加载中 <Loader2 className="w-4 h-4 animate-spin" /></>
            ) : (
              <>{user ? "开始创作" : "免费开始"} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" /></>
            )}
          </Link>
        </div>
      </section>

      {/* 连续流体舞台底部：向下收束到纯底色，平滑过渡到 footer */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#fbfbfd] dark:to-[#06070d] pointer-events-none" />
      </div>{/* ← 连续流体舞台 wrapper 结束 */}

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
      <footer className="relative border-t border-zinc-200/60 dark:border-white/10 bg-[#fbfbfd] dark:bg-[#06070d] overflow-hidden">
        {/* 顶部细微流体余晖，与全站连续画布呼应（极淡，不抢内容） */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-300/60 dark:via-white/15 to-transparent" />
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[60vw] h-48 rounded-full blur-[120px] opacity-15 dark:opacity-20 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1]" />

        <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-8">
          {/* ── 主区：品牌 + 导航列 ── */}
          <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8 md:gap-10 mb-12">
            {/* 品牌块 */}
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="inline-flex items-center gap-2.5 group mb-4">
                <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
                    <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-[18px] h-[18px] object-contain" />
                  ) : (
                    <span className="text-[10px] font-black text-white dark:text-zinc-900 tracking-tighter">{settings?.site_logo_text || "C2"}</span>
                  )}
                </div>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{settings.site_title}</span>
              </Link>
              <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-white/50 max-w-xs mb-5">
                {settings.site_subtitle || "AI 图片生成服务"} · 用自然语言描述，AI 即刻为你创作。
              </p>
              {/* 社交 / 联系 */}
              <div className="flex items-center gap-2.5">
                {[{ icon: Globe, label: "官网" }, { icon: MessageCircle, label: "社区" }, { icon: Mail, label: "邮箱" }].map(({ icon: Ico, label }) => (
                  <span
                    key={label}
                    aria-label={label}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-zinc-900/[0.08] dark:border-white/10 bg-white/50 dark:bg-white/[0.04] backdrop-blur-md text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-900/15 dark:hover:border-white/25 transition-colors cursor-pointer"
                  >
                    <Ico className="w-4 h-4" />
                  </span>
                ))}
              </div>
            </div>

            {/* 导航列 */}
            <FooterColumn
              title="产品"
              links={[
                { label: "创作中心", href: "/create" },
                { label: "AI 矢量", href: "/vector" },
                { label: "灵感广场", href: "/gallery" },
                { label: "积分商城", href: "/shop" },
              ]}
            />
            <FooterColumn
              title="资源"
              links={[
                { label: "API 文档", href: "/docs" },
                { label: "定价方案", href: "/#pricing" },
                { label: "用户中心", href: "/user" },
              ]}
            />
            <FooterColumn
              title="法律"
              links={[
                { label: "隐私政策", href: "#" },
                { label: "服务条款", href: "#" },
              ]}
            />
          </div>

          {/* ── 免责声明 ── */}
          <div className="space-y-1.5 mb-6 pt-6 border-t border-zinc-900/[0.06] dark:border-white/[0.07]">
            <p className="text-[10.5px] leading-relaxed text-zinc-400 dark:text-white/35">
              本站为独立第三方服务，与 OpenAI、ChatGPT、GPT、DALL·E 等品牌及其权利人均无任何关联、合作或授权关系；相关名称、商标归各自所有者所有，提及仅为说明兼容性与技术描述之用。
            </p>
            <p className="text-[10.5px] leading-relaxed text-zinc-400 dark:text-white/35">
              本站图片由人工智能生成式模型自动生成，结果可能存在不准确、不完整或与预期不符之处，不代表本站立场，请勿将其用于违法、侵权或误导性用途。用户须对自行输入的提示词及生成、发布、传播的内容负责，并确保遵守所在地法律法规；因使用本服务产生的任何后果由用户自行承担。继续使用即表示您已知悉并同意上述条款。
            </p>
          </div>

          {/* ── 版权 ── */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-zinc-900/[0.06] dark:border-white/[0.07]">
            <p className="text-[11px] text-zinc-400 dark:text-white/40">
              © 2026 {settings.site_title}. All rights reserved.
            </p>
            <p className="text-[10px] text-zinc-300 dark:text-white/25 font-mono tracking-wider">
              v{process.env.NEXT_PUBLIC_VERSION || "2.0"}
            </p>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════
          GLOBAL KEYFRAMES
          ═══════════════════════════════════════ */}
      <style jsx global>{`
        /* Hero text reveal */
        @keyframes heroReveal {
          0%   { opacity: 0; transform: translateY(36px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* 标题逐字浮现 */
        @keyframes charRise {
          0%   { opacity: 0; transform: translateY(0.5em) rotate(3deg); }
          100% { opacity: 1; transform: translateY(0) rotate(0deg); }
        }
        /* 标题流动彩色渐变 */
        @keyframes spectralFlow {
          0%, 100% { background-position: 0% center; }
          50%      { background-position: 100% center; }
        }

        /* ── 流体艺术背景：每团色斑各自大幅游动 + 形变 + 旋转，重叠交融 ── */
        @keyframes fluidA {
          0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
          25%  { transform: translate(28%, 18%) scale(1.25) rotate(8deg); }
          50%  { transform: translate(14%, 36%) scale(0.85) rotate(-6deg); }
          75%  { transform: translate(-18%, 16%) scale(1.15) rotate(5deg); }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes fluidB {
          0%   { transform: translate(0, 0) scale(1) rotate(0deg); }
          25%  { transform: translate(-30%, 22%) scale(0.8) rotate(-10deg); }
          50%  { transform: translate(-12%, -20%) scale(1.3) rotate(7deg); }
          75%  { transform: translate(22%, -10%) scale(0.95) rotate(-4deg); }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes fluidC {
          0%   { transform: translate(0, 0) scale(1.05) rotate(0deg); }
          33%  { transform: translate(-26%, 30%) scale(0.78) rotate(9deg); }
          66%  { transform: translate(20%, 14%) scale(1.28) rotate(-8deg); }
          100% { transform: translate(0, 0) scale(1.05) rotate(0deg); }
        }
        @keyframes fluidD {
          0%   { transform: translate(0, 0) scale(0.95) rotate(0deg); }
          30%  { transform: translate(34%, -22%) scale(1.3) rotate(-12deg); }
          60%  { transform: translate(-20%, -12%) scale(0.85) rotate(6deg); }
          85%  { transform: translate(12%, 18%) scale(1.1) rotate(-3deg); }
          100% { transform: translate(0, 0) scale(0.95) rotate(0deg); }
        }
        @keyframes fluidE {
          0%   { transform: translate(0, 0) scale(1.1) rotate(0deg); }
          33%  { transform: translate(-34%, -26%) scale(0.82) rotate(11deg); }
          66%  { transform: translate(-14%, 20%) scale(1.25) rotate(-9deg); }
          100% { transform: translate(0, 0) scale(1.1) rotate(0deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="fluid"], [style*="spectralFlow"], [style*="charRise"] {
            animation: none !important;
            opacity: 1 !important;
          }
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
  const { user, loading: authLoading } = useAuth();
  const isFree = p.price_monthly === 0;
  const planHref = isFree
    ? (user ? "/create" : "/register")
    : `/subscribe?plan_id=${p.id}&billing=${billing}`;
  const hot = p.highlighted; // 推荐款 = 深色反转卡

  return (
    <div
      className={`group relative flex flex-col rounded-[1.75rem] overflow-hidden transition-all duration-500 hover:-translate-y-1.5 ${
        hot
          ? "bg-zinc-900 dark:bg-white/[0.06] dark:backdrop-blur-xl ring-1 ring-zinc-900 dark:ring-white/15 shadow-2xl shadow-zinc-900/25 md:-mt-3 md:mb-3"
          : "bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl ring-1 ring-zinc-900/[0.06] dark:ring-white/10 hover:bg-white/80 dark:hover:bg-white/[0.06] hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.25)]"
      }`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
        transition: `all 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {/* 推荐款顶部流体晕（青→靛，呼应全站流体语言） */}
      {hot && (
        <div className="absolute inset-x-0 top-0 h-36 pointer-events-none bg-[radial-gradient(80%_100%_at_50%_0%,rgba(99,102,241,0.25),transparent_70%)]" />
      )}

      <div className="relative p-7 sm:p-8 flex flex-col flex-1">
        {/* 套餐名 + 推荐徽章 */}
        <div className="flex items-center justify-between mb-6 h-6">
          <span className={`text-sm font-semibold tracking-tight ${hot ? "text-white" : "text-zinc-900 dark:text-white"}`}>
            {p.name}
          </span>
          {hot && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 dark:bg-white/15 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">
              <Zap className="w-2.5 h-2.5 fill-current" /> 最受欢迎
            </span>
          )}
        </div>

        {/* 价格 — 视觉重心，无衬线等宽数字，紧凑利落 */}
        <div className="mb-7">
          <div className="flex items-start">
            <span className={`text-2xl font-semibold mt-1.5 mr-0.5 ${hot ? "text-white/70" : "text-zinc-400 dark:text-white/50"}`}>¥</span>
            {isFree ? (
              <span className={`text-6xl font-bold tabular-nums tracking-tight leading-none ${hot ? "text-white" : "text-zinc-900 dark:text-white"}`}>0</span>
            ) : (
              <AnimatedPrice
                prefix=""
                value={Number(billing === "yearly" ? p.price_yearly : p.price_monthly)}
                className={`text-6xl font-bold tabular-nums tracking-tight leading-none ${hot ? "text-white" : "text-zinc-900 dark:text-white"}`}
              />
            )}
            <span className={`text-sm font-medium self-end mb-1.5 ml-1.5 ${hot ? "text-white/50" : "text-zinc-400 dark:text-white/40"}`}>/月</span>
          </div>
          {/* 年付折前原价（占位高度固定，避免月付/年付切换时跳动） */}
          <div className="h-5 mt-2">
            {billing === "yearly" && p.price_monthly > 0 && (
              <span className={`text-xs ${hot ? "text-white/40" : "text-zinc-400 dark:text-white/35"}`}>
                原价 <span className="line-through">¥{p.price_monthly}</span> /月
              </span>
            )}
          </div>
        </div>

        {/* CTA — 价格正下方，决策即时 */}
        <Link
          href={planHref}
          aria-disabled={isFree && authLoading}
          onClick={(e) => { if (isFree && authLoading) e.preventDefault(); }}
          className={`group/btn inline-flex items-center justify-center gap-1.5 w-full rounded-full text-[13px] font-semibold h-12 transition-all ${
            hot
              ? "bg-white text-zinc-900 hover:bg-zinc-100 shadow-lg shadow-black/20"
              : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200"
          } ${isFree && authLoading ? "opacity-70 cursor-wait pointer-events-none" : ""}`}
        >
          {isFree && authLoading ? (
            <>加载中<Loader2 className="w-3.5 h-3.5 animate-spin" /></>
          ) : (
            <>{isFree ? "免费开始" : "立即订阅"}<ArrowRight className="w-4 h-4 group-hover/btn:translate-x-0.5 transition-transform" /></>
          )}
        </Link>

        {/* 分隔线 */}
        <div className={`my-7 h-px w-full ${hot ? "bg-white/10" : "bg-zinc-900/[0.07] dark:bg-white/10"}`} />

        {/* 特性清单 */}
        <div className="space-y-3.5 flex-1">
          {auto.length > 0 && (
            <ul className="space-y-3.5">
              {auto.map((f: any, j: number) => {
                const Icon = iconMap[f.icon] || Check;
                return (
                  <li key={j} className="flex items-center gap-3">
                    <span className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full ${hot ? "bg-white/10" : "bg-cyan-500/10 dark:bg-cyan-400/10"}`}>
                      <Icon className={`w-3 h-3 ${hot ? "text-cyan-300" : "text-cyan-600 dark:text-cyan-400"}`} />
                    </span>
                    <span className={`text-[13px] font-medium ${hot ? "text-white/90" : "text-zinc-700 dark:text-white/85"}`}>{f.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {custom.length > 0 && (
            <ul className="space-y-3.5">
              {custom.map((text: string, j: number) => (
                <li key={j} className="flex items-start gap-3">
                  <span className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full mt-px ${hot ? "bg-white/[0.06]" : "bg-zinc-900/[0.04] dark:bg-white/[0.06]"}`}>
                    <Check className={`w-3 h-3 ${hot ? "text-white/40" : "text-zinc-400 dark:text-white/40"}`} />
                  </span>
                  <span className={`text-[13px] leading-relaxed ${hot ? "text-white/55" : "text-zinc-500 dark:text-white/55"}`}>{text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
