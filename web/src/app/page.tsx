"use client";

import { useState, useEffect, useRef } from "react";
import { BASE } from "@/lib/api";
import {
  ArrowRight, Check, Palette, Zap, Image, MessageCircle,
  Shield, Banknote, Coins, Timer, Layers, Clock, Loader2, Sparkles, Gauge
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { useAuth } from "@/lib/auth";
import { imageProxyUrl } from "@/lib/utils";
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
  // 折射引擎：棱镜光核 + 三道发光质点环（青→靛→品红→琥珀光谱），英雄区签名视觉
  const rings = [
    { r: 150, dur: 38, rev: false, hue: "rgba(34,211,238,0.55)", dot: "#22d3ee" },   // cyan
    { r: 215, dur: 30, rev: true,  hue: "rgba(129,140,248,0.45)", dot: "#818cf8" },  // indigo
    { r: 285, dur: 46, rev: false, hue: "rgba(232,121,249,0.40)", dot: "#e879f9" },  // fuchsia
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      <div className="relative w-[620px] h-[620px] lg:w-[740px] lg:h-[740px]">
        {/* 棱镜光谱核心 — 缓慢自转的 conic 光轮 */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 lg:w-72 lg:h-72 rounded-full blur-2xl opacity-70"
          style={{
            background:
              "conic-gradient(from 0deg, #22d3ee, #6366f1, #e879f9, #fbbf24, #22d3ee)",
            animation: "prismSpin 18s linear infinite",
          }}
        />
        {/* 核心亮点 — 折射焦点 */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 lg:w-20 lg:h-20 rounded-full blur-md"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.9), rgba(34,211,238,0.3) 50%, transparent 70%)",
            animation: "prismCore 5s ease-in-out infinite",
          }}
        />
        {/* 发光质点环 */}
        {rings.map((ring, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: ring.r * 2,
              height: ring.r * 2,
              border: `1px solid ${ring.hue}`,
              boxShadow: `0 0 24px -8px ${ring.hue}, inset 0 0 24px -12px ${ring.hue}`,
              animation: `orbSpin ${ring.dur}s linear infinite${ring.rev ? " reverse" : ""}`,
            }}
          >
            <div
              className="absolute w-2.5 h-2.5 rounded-full"
              style={{
                top: -5, left: "50%", marginLeft: -5,
                background: ring.dot,
                boxShadow: `0 0 14px 2px ${ring.dot}`,
              }}
            />
            <div
              className="absolute w-1.5 h-1.5 rounded-full opacity-70"
              style={{
                bottom: -3, left: "50%", marginLeft: -3,
                background: ring.dot,
                boxShadow: `0 0 10px 1px ${ring.dot}`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Hero Gallery — 右侧真实作品图片墙（错落多列浮动）
   拉取 /api/gallery 已分享作品，棱镜环作背景光源
   ═══════════════════════════════════════════════ */
function HeroGallery() {
  const [imgs, setImgs] = useState<{ id: number; prompt: string }[]>([]);

  useEffect(() => {
    fetch(`${BASE}/api/gallery?page=1&page_size=24`)
      .then((r) => r.json())
      .then((d) => {
        const items = (d.data?.items || []).filter((it: any) => it.id);
        setImgs(items.slice(0, 16));
      })
      .catch(() => {});
  }, []);

  if (imgs.length < 4) return null; // 作品不足时不展示，避免空架子

  // 四列错落：不同初始偏移 + 反向缓慢上下浮动，铺满右半屏
  const cols: { id: number; prompt: string }[][] = [[], [], [], []];
  imgs.forEach((im, i) => cols[i % 4].push(im));
  const colCfg = [
    { offset: "-translate-y-6", dur: "22s", dir: "" },
    { offset: "translate-y-10", dur: "27s", dir: " reverse" },
    { offset: "-translate-y-2", dur: "24s", dir: "" },
    { offset: "translate-y-6", dur: "29s", dir: " reverse" },
  ];

  return (
    <div className="absolute inset-y-0 right-0 w-[58%] lg:w-[55%] flex items-center justify-center pointer-events-none">
      <div className="flex gap-3 lg:gap-4 w-full px-4 lg:px-8 justify-center [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent),linear-gradient(to_right,transparent,black_30%)] [mask-composite:intersect] [-webkit-mask-composite:source-in]">
        {cols.map((col, ci) => (
          <div
            key={ci}
            className={`flex flex-col gap-3 lg:gap-4 flex-1 min-w-0 ${colCfg[ci].offset}`}
            style={{ animation: `heroAura ${colCfg[ci].dur} ease-in-out infinite${colCfg[ci].dir}` }}
          >
            {col.map((im) => (
              <div
                key={im.id}
                className="group relative rounded-xl overflow-hidden border border-white/10 dark:border-white/10 bg-zinc-200/40 dark:bg-white/5 shadow-lg shadow-black/20 dark:shadow-black/40"
              >
                <img
                  src={imageProxyUrl(im)}
                  alt=""
                  loading="lazy"
                  className="w-full h-auto object-cover"
                />
                {/* 光谱描边微光 */}
                <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-cyan-400/10" />
              </div>
            ))}
          </div>
        ))}
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
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            opacity: p.opacity,
            background: p.color,
            boxShadow: `0 0 ${p.size * 2.5}px ${p.size * 0.5}px ${p.color}`,
            animation: `particleFloat ${p.dur}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function makeParticles(count: number) {
  // 光谱质点：青/靛/品红/琥珀，少量发光尘埃漂浮
  const palette = ["#22d3ee", "#818cf8", "#e879f9", "#fbbf24"];
  return Array.from({ length: count }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 2 + Math.random() * 4,
    dur: 8 + Math.random() * 12,
    delay: Math.random() * 10,
    opacity: 0.2 + Math.random() * 0.45,
    color: palette[Math.floor(Math.random() * palette.length)],
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
      <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-white font-[family-name:var(--font-display)]">{value}</span>
      <span className="text-[10px] text-cyan-700/50 dark:text-cyan-200/40 tracking-wide uppercase">{label}</span>
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
      className={`group relative h-full rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-900/80 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-xl ${a.ring}`}
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
      <div className={`relative h-px w-full bg-zinc-200 dark:bg-zinc-800 transition-all duration-500 ease-out group-hover:h-[3px] group-hover:bg-gradient-to-r ${a.grad}`} />

      <div className={`relative ${hero ? "p-7" : "p-6"}`}>
        {/* 背景大序号 — hover 透出主题色 */}
        <div className={`absolute right-3 top-3 text-[72px] font-bold leading-none select-none pointer-events-none text-zinc-100 dark:text-zinc-800/60 transition-colors duration-500 ${a.num} font-[family-name:var(--font-display)]`}>
          {String(index + 1).padStart(2, "0")}
        </div>

        {/* 图标 — 主题色渐变底，hover 放大发光 */}
        <div
          className={`relative w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${a.grad} text-white shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:-translate-y-0.5`}
          style={{ boxShadow: `0 6px 20px -6px ${a.glow.replace("0.18", "0.5")}` }}
        >
          <Icon className={hero ? "w-5 h-5" : "w-5 h-5"} />
        </div>

        <h3 className={`font-semibold text-zinc-900 dark:text-zinc-100 mb-2 relative ${hero ? "text-lg" : "text-base"}`}>
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

      {/* ═══════════════════════════════════════
          HERO — Spectral（亮色：浅白冷调 / 暗色：墨色聚光区）
          ═══════════════════════════════════════ */}
      <section className="relative min-h-[92vh] flex items-center overflow-hidden bg-gradient-to-b from-[#f6f8fc] to-[#eef1f7] dark:from-[#080a12] dark:to-[#080a12] text-zinc-800 dark:text-zinc-100">
        {/* 基底径向微光 */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_70%_-10%,rgba(34,211,238,0.12),transparent_55%)] dark:bg-[radial-gradient(ellipse_120%_80%_at_70%_-10%,rgba(34,211,238,0.10),transparent_55%)]" />
        {/* 三团缓慢漂移的柔光晕：青 / 靛 / 琥珀（亮色更淡） */}
        <div className="absolute -left-[10%] top-[20%] w-[42rem] h-[42rem] rounded-full blur-[120px] opacity-[0.12] dark:opacity-[0.18] bg-[#22d3ee]" style={{ animation: "heroAura 22s ease-in-out infinite" }} />
        <div className="absolute left-[35%] -top-[15%] w-[38rem] h-[38rem] rounded-full blur-[120px] opacity-[0.10] dark:opacity-[0.16] bg-[#6366f1]" style={{ animation: "heroAura 28s ease-in-out infinite reverse" }} />
        <div className="absolute right-[5%] bottom-[5%] w-[32rem] h-[32rem] rounded-full blur-[120px] opacity-[0.10] dark:opacity-[0.12] bg-[#fbbf24]" style={{ animation: "heroAura 26s ease-in-out infinite" }} />
        {/* 极淡技术网格，径向蒙版淡出（亮色用深色线，暗色用白线） */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.04)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:radial-gradient(ellipse_70%_60%_at_35%_45%,black_15%,transparent_80%)]" />
        {/* 胶片颗粒噪点（仅暗色，亮色下噪点显脏） */}
        <div className="hidden dark:block absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

        {/* Orbital rings — 背景光源（棱镜引擎，作图片墙的辉光衬底） */}
        <div className="absolute right-[-18%] top-1/2 -translate-y-1/2 hidden md:block opacity-60">
          <OrbitalRings />
        </div>

        {/* 右侧真实作品图片墙 */}
        <div className="hidden md:block">
          <HeroGallery />
        </div>

        <Particles count={14} />

        {/* Content — left-aligned，桌面端限宽避免与右侧图墙重叠 */}
        <div className="relative w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-16 py-16 z-10">
          <div className="max-w-2xl md:max-w-xl lg:max-w-2xl">
            {/* Tag */}
            <div className="mb-6 opacity-0 animate-[heroReveal_0.6s_ease-out_0.1s_forwards]">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 dark:border-white/10 bg-cyan-500/[0.06] dark:bg-white/[0.04] px-3.5 py-1 backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inset-0 rounded-full bg-cyan-500 dark:bg-cyan-400 opacity-75" />
                  <span className="relative rounded-full h-1.5 w-1.5 bg-cyan-500 dark:bg-cyan-400" />
                </span>
                <span className="text-[11px] font-medium text-cyan-700 dark:text-cyan-100/70 tracking-[0.12em] uppercase">
                  AI Image Generation · Open API
                </span>
              </div>
            </div>

            {/* Title — 第一行站点标题，第二行副标题（光谱渐变） */}
            <h1 className="font-[family-name:var(--font-display)] text-[2.9rem] sm:text-6xl md:text-7xl font-medium tracking-tight leading-[0.98] mb-5 opacity-0 animate-[heroReveal_0.7s_ease-out_0.2s_forwards]">
              <span className="block text-zinc-900 dark:text-white">
                {settings.site_title || "ChatGPT2API Pro"}
              </span>
              <span className="block italic bg-[linear-gradient(110deg,#0891b2,#6366f1_40%,#c026d3_70%,#d97706)] dark:bg-[linear-gradient(110deg,#22d3ee,#818cf8_40%,#e879f9_70%,#fbbf24)] bg-[length:200%_auto] bg-clip-text text-transparent" style={{ animation: "spectralShift 8s ease-in-out infinite" }}>
                {settings.site_subtitle || "AI 图片生成服务"}
              </span>
            </h1>

            {/* Description — 第三行描述 */}
            <p className="text-base md:text-lg text-zinc-600 dark:text-zinc-400 max-w-md leading-relaxed mb-8 opacity-0 animate-[heroReveal_0.6s_ease-out_0.35s_forwards]">
              {settings.site_description}
            </p>

            {/* CTAs */}
            <div className="flex items-center gap-3 opacity-0 animate-[heroReveal_0.6s_ease-out_0.5s_forwards]">
              <Link
                href={ctaHref}
                aria-disabled={authLoading}
                onClick={(e) => { if (authLoading) e.preventDefault(); }}
                className={`group relative inline-flex items-center gap-2 rounded-xl px-7 h-11 text-sm font-semibold transition-all duration-300 text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] dark:bg-none dark:bg-white dark:text-[#080a12] ${authLoading ? "opacity-70 cursor-wait pointer-events-none" : "hover:-translate-y-0.5 shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] hover:shadow-[0_12px_40px_-8px_rgba(34,211,238,0.85)] dark:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_8px_30px_-8px_rgba(34,211,238,0.5)] dark:hover:shadow-[0_0_0_1px_rgba(34,211,238,0.5),0_12px_40px_-8px_rgba(34,211,238,0.7)]"}`}
              >
                {authLoading ? (
                  <>
                    加载中
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </>
                ) : (
                  <>
                    {user ? "开始创作" : "开始使用"}
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </Link>
              <Link
                href="#features"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300/70 bg-white/40 text-zinc-600 hover:bg-white/70 hover:border-zinc-400 hover:text-zinc-900 dark:border-white/15 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.07] dark:hover:border-white/25 dark:hover:text-white px-7 h-11 text-sm font-medium transition-all backdrop-blur-sm"
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
          <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
            <div className="w-4 h-7 rounded-full border border-zinc-300 dark:border-white/20 flex items-start justify-center p-1">
              <div className="w-0.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400 animate-[scrollDot_2s_ease-in-out_infinite]" />
            </div>
            <span className="text-[10px] tracking-[0.2em] uppercase">Scroll</span>
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
              <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-[0_6px_20px_-6px_rgba(99,102,241,0.6)]">
                <span className="text-lg font-bold text-white">✦</span>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-zinc-300 to-transparent dark:from-zinc-700" />
            </div>
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] px-3.5 py-1 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 mb-4 tracking-[0.12em] uppercase">
                Why Choose Us
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-[family-name:var(--font-display)]">
                让创意变为现实
              </h2>
              <p className="text-base text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xl">
                无需任何技术背景，输入文字描述，AI 即刻为你创作精美图片
              </p>
            </div>
          </div>

          {/* Feature grid — 均衡三列 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {features.map((f, i) => (
              <FeatureCard key={i} {...f} index={i} inView={featRef.inView} />
            ))}
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
              <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 via-fuchsia-500 to-amber-400 flex items-center justify-center shadow-[0_6px_20px_-6px_rgba(232,121,249,0.6)]">
                <span className="text-lg font-bold text-white">◆</span>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-zinc-300 to-transparent dark:from-zinc-700" />
            </div>
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/[0.06] px-3.5 py-1 text-[11px] font-medium text-fuchsia-700 dark:text-fuchsia-300 mb-4 tracking-[0.12em] uppercase">
                Pricing
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-[family-name:var(--font-display)]">
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
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        省 {best}%
                      </span>
                    ) : null;
                  })()}
                </button>
              </div>
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

        {/* CTA section — 居中收尾，光谱光晕烘托，轻盈对称 */}
        <div
          className="relative max-w-2xl mx-auto mt-20 sm:mt-28 px-6 text-center transition-all duration-700 delay-300"
          style={{
            opacity: priceRef.inView ? 1 : 0,
            transform: priceRef.inView ? "translateY(0)" : "translateY(30px)",
          }}
        >
          {/* 背景光谱光晕 */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-10 w-[28rem] h-56 rounded-full blur-[100px] opacity-20 bg-[radial-gradient(circle,#22d3ee,#6366f1_50%,transparent_75%)] pointer-events-none" />

          {/* 棱镜图标 */}
          <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-6 bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 shadow-[0_8px_30px_-6px_rgba(99,102,241,0.5)]">
            <Sparkles className="w-6 h-6 text-white" />
          </div>

          <h2 className="relative text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-[family-name:var(--font-display)]">
            准备好开始创作了吗？
          </h2>
          <p className="relative text-base text-zinc-500 dark:text-zinc-400 mb-8 max-w-md mx-auto leading-relaxed">
            {user ? "进入创作中心，开启你的 AI 图片生成之旅" : "免费注册即可体验 AI 图片生成的无限可能"}
          </p>
          <Link
            href={ctaHref}
            aria-disabled={authLoading}
            onClick={(e) => { if (authLoading) e.preventDefault(); }}
            className={`group relative inline-flex items-center gap-2 rounded-xl px-8 h-12 text-sm font-semibold transition-all text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] ${authLoading ? "opacity-70 cursor-wait pointer-events-none" : "hover:-translate-y-0.5 shadow-[0_10px_34px_-8px_rgba(34,211,238,0.6)] hover:shadow-[0_14px_44px_-8px_rgba(34,211,238,0.85)]"}`}
          >
            {authLoading ? (
              <>
                加载中
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </>
            ) : (
              <>
                {user ? "开始创作" : "免费开始"}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
              </>
            )}
          </Link>
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

          {/* 免责声明 — 商标无关联 + AI 生成式服务提示 */}
          <div className="space-y-1.5 mb-4">
            <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              本站为独立第三方服务，与 OpenAI、ChatGPT、GPT、DALL·E 等品牌及其权利人均无任何关联、合作或授权关系；相关名称、商标归各自所有者所有，提及仅为说明兼容性与技术描述之用。
            </p>
            <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              本站图片由人工智能生成式模型自动生成，结果可能存在不准确、不完整或与预期不符之处，不代表本站立场，请勿将其用于违法、侵权或误导性用途。用户须对自行输入的提示词及生成、发布、传播的内容负责，并确保遵守所在地法律法规；因使用本服务产生的任何后果由用户自行承担。继续使用即表示您已知悉并同意上述条款。
            </p>
          </div>

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

        /* Spectral Darkroom — 棱镜光轮自转 */
        @keyframes prismSpin {
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        /* 折射焦点呼吸 */
        @keyframes prismCore {
          0%, 100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.7; }
          50%      { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
        }
        /* 背景柔光晕缓慢漂移 */
        @keyframes heroAura {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(4%, -3%) scale(1.08); }
          66%  { transform: translate(-3%, 4%) scale(0.95); }
        }
        /* 标题光谱流动 */
        @keyframes spectralShift {
          0%, 100% { background-position: 0% center; }
          50%      { background-position: 100% center; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="heroAura"], [style*="prismSpin"], [style*="prismCore"], [style*="spectralShift"], [style*="orbSpin"] {
            animation: none !important;
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
      className={`group relative flex flex-col rounded-3xl overflow-hidden transition-all duration-500 hover:-translate-y-1 ${
        hot
          ? "bg-zinc-900 dark:bg-zinc-900 ring-1 ring-zinc-900 dark:ring-white/10 shadow-2xl shadow-zinc-900/25 md:-mt-2 md:mb-2"
          : "bg-white dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800 hover:ring-zinc-300 dark:hover:ring-zinc-700 hover:shadow-xl hover:shadow-zinc-900/5"
      }`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
        transition: `all 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {/* 推荐款顶部极淡光谱晕（仅深色卡内，亮色背景不外溢，不刺眼） */}
      {hot && (
        <div className="absolute inset-x-0 top-0 h-32 pointer-events-none bg-[radial-gradient(80%_100%_at_50%_0%,rgba(34,211,238,0.16),transparent_70%)]" />
      )}

      <div className="relative p-7 flex flex-col flex-1">
        {/* 套餐名 + POPULAR */}
        <div className="flex items-center justify-between mb-5">
          <span className={`text-[13px] font-semibold tracking-wide ${hot ? "text-white" : "text-zinc-900 dark:text-zinc-100"}`}>
            {p.name}
          </span>
          {hot && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 px-2 py-0.5 text-[9px] font-bold tracking-wider text-zinc-900">
              <Zap className="w-2.5 h-2.5" /> 推荐
            </span>
          )}
        </div>

        {/* 价格 — 视觉重心 */}
        <div className="mb-6">
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-medium ${hot ? "text-zinc-400" : "text-zinc-400 dark:text-zinc-500"}`}>¥</span>
            {isFree ? (
              <span className={`text-5xl font-bold tabular-nums font-[family-name:var(--font-display)] ${hot ? "text-white" : "text-zinc-900 dark:text-white"}`}>0</span>
            ) : (
              <AnimatedPrice
                value={Number(billing === "yearly" ? p.price_yearly : p.price_monthly)}
                className={`text-5xl font-bold tabular-nums font-[family-name:var(--font-display)] ${hot ? "text-white" : "text-zinc-900 dark:text-white"}`}
              />
            )}
            <span className={`text-xs ${hot ? "text-zinc-500" : "text-zinc-400"}`}>/月</span>
          </div>
          <div className="h-4 mt-1">
            {billing === "yearly" && p.price_monthly > 0 && (
              <span className={`text-[11px] line-through ${hot ? "text-zinc-600" : "text-zinc-400"}`}>原价 ¥{p.price_monthly}/月</span>
            )}
          </div>
        </div>

        {/* CTA — 价格正下方，决策即时 */}
        <Link
          href={planHref}
          aria-disabled={isFree && authLoading}
          onClick={(e) => { if (isFree && authLoading) e.preventDefault(); }}
          className={`inline-flex items-center justify-center gap-1.5 w-full rounded-xl text-xs font-semibold h-11 transition-all mb-7 ${
            hot
              ? "bg-white text-zinc-900 hover:bg-zinc-100 shadow-lg shadow-black/20"
              : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200"
          } ${isFree && authLoading ? "opacity-70 cursor-wait pointer-events-none" : ""}`}
        >
          {isFree && authLoading ? (
            <>加载中<Loader2 className="w-3 h-3 animate-spin" /></>
          ) : (
            <>{isFree ? "免费开始" : "立即订阅"}<ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" /></>
          )}
        </Link>

        {/* 特性清单 */}
        <div className="space-y-3 flex-1">
          {auto.length > 0 && (
            <ul className="space-y-2.5">
              {auto.map((f: any, j: number) => {
                const Icon = iconMap[f.icon] || Check;
                return (
                  <li key={j} className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 shrink-0 ${hot ? "text-cyan-400" : "text-cyan-600 dark:text-cyan-400"}`} />
                    <span className={`text-[13px] font-medium ${hot ? "text-zinc-200" : "text-zinc-700 dark:text-zinc-200"}`}>{f.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {custom.length > 0 && (
            <ul className="space-y-2.5 pt-1">
              {custom.map((text: string, j: number) => (
                <li key={j} className="flex items-start gap-2.5">
                  <Check className={`w-4 h-4 mt-px shrink-0 ${hot ? "text-zinc-500" : "text-zinc-300 dark:text-zinc-600"}`} />
                  <span className={`text-[13px] leading-relaxed ${hot ? "text-zinc-400" : "text-zinc-500 dark:text-zinc-400"}`}>{text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
