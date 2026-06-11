"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, AlertTriangle, CheckCircle, Sparkles, X, ArrowUpRight } from "lucide-react";
import { BASE } from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Announcement = {
  id: number;
  title: string;
  content: string;
  type: string;
  link: string;
  dismissible: boolean;
};

// 类型 → 配色与图标（光谱主题）
// ribbon：顶部全宽 ribbon 的实心渐变背景（深色调，确保白字对比度达标）
// dot/iconBg/iconColor：详情弹窗与指示点复用
const TYPE_STYLE: Record<string, { dot: string; grad: string; ribbon: string; icon: typeof Info; iconColor: string; iconBg: string }> = {
  info:     { dot: "from-cyan-400 to-sky-500",       grad: "#22d3ee,#0ea5e9",  ribbon: "linear-gradient(90deg,#0891b2,#4f46e5)", icon: Info,          iconColor: "text-cyan-500 dark:text-cyan-400",      iconBg: "bg-cyan-500/10" },
  warning:  { dot: "from-amber-400 to-orange-500",   grad: "#fbbf24,#f97316",  ribbon: "linear-gradient(90deg,#d97706,#ea580c)", icon: AlertTriangle, iconColor: "text-amber-500 dark:text-amber-400",    iconBg: "bg-amber-500/10" },
  success:  { dot: "from-emerald-400 to-teal-500",   grad: "#34d399,#14b8a6",  ribbon: "linear-gradient(90deg,#059669,#0d9488)", icon: CheckCircle,   iconColor: "text-emerald-500 dark:text-emerald-400", iconBg: "bg-emerald-500/10" },
  activity: { dot: "from-violet-400 to-fuchsia-500", grad: "#a78bfa,#e879f9",  ribbon: "linear-gradient(90deg,#7c3aed,#c026d3)", icon: Sparkles,      iconColor: "text-violet-500 dark:text-violet-400",  iconBg: "bg-violet-500/10" },
};

const DISMISS_KEY = "dismissed-announcements";

function getDismissed(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);

  useEffect(() => {
    setDismissed(getDismissed());
    fetch(`${BASE}/api/announcements`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.data)) setItems(d.data); })
      .catch(() => {});
  }, []);

  const visible = items.filter((a) => !dismissed.includes(a.id));

  // 轮播：多条时每 5s 切换下一条（悬停/弹窗打开时暂停）
  useEffect(() => {
    if (visible.length <= 1 || paused || detail) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % visible.length), 5000);
    return () => clearInterval(t);
  }, [visible.length, paused, detail]);

  // 当前索引越界保护（关闭后列表变短）
  useEffect(() => {
    if (idx >= visible.length && visible.length > 0) setIdx(0);
  }, [visible.length, idx]);

  const dismiss = (id: number) => {
    const next = Array.from(new Set([...getDismissed(), id]));
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    setDismissed(next);
  };

  if (visible.length === 0) return null;
  const a = visible[Math.min(idx, visible.length - 1)];
  const style = TYPE_STYLE[a.type] || TYPE_STYLE.info;
  const Icon = style.icon;

  // 点击公告主体：有链接则跳转，否则打开详情弹窗看全文
  const openMain = () => {
    if (a.link) window.open(a.link, "_blank", "noreferrer");
    else setDetail(a);
  };

  return (
    <>
      {/* ───────── 顶部全宽渐变 ribbon（置于导航上方，随页面滚动上移） ───────── */}
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="relative z-40 w-full text-white overflow-hidden"
        style={{ background: style.ribbon }}
      >
        {/* 顶部高光 + 极淡噪点，增强实心渐变的层次 */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(ellipse_at_right,rgba(255,255,255,0.12),transparent_70%)]" />

        <div className="relative max-w-6xl mx-auto px-4 md:px-6 min-h-[40px] py-1.5 flex items-center gap-3">
          {/* 左：图标 + 文案（点击跳转/看全文），居中靠拢 */}
          <button onClick={openMain} className="group flex items-center justify-center gap-2 min-w-0 flex-1 text-left sm:text-center">
            <Icon className="w-4 h-4 shrink-0 opacity-95" />
            <AnimatePresence mode="wait">
              <motion.span
                key={a.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="min-w-0 flex items-center gap-1.5 text-[13px]"
              >
                {a.title && <strong className="font-semibold shrink-0">{a.title}</strong>}
                {a.title && a.content && <span className="opacity-50 shrink-0 hidden sm:inline">·</span>}
                {a.content && <span className="truncate opacity-90 max-w-[18rem] sm:max-w-[34rem]">{a.content}</span>}
                {/* 行内 CTA 胶囊（有链接时显示「查看详情」，否则「了解更多」） */}
                <span className="ml-1 shrink-0 hidden sm:inline-flex items-center gap-1 rounded-full bg-white/15 group-hover:bg-white/25 px-2.5 py-0.5 text-[12px] font-medium backdrop-blur-sm transition-colors">
                  {a.link ? "查看详情" : "了解更多"}
                  <ArrowUpRight className="w-3 h-3" />
                </span>
              </motion.span>
            </AnimatePresence>
          </button>

          {/* 右：轮播指示点 + 关闭，绝对定位不挤压居中文案 */}
          <div className="flex items-center gap-2 shrink-0 sm:absolute sm:right-4 md:right-6 sm:top-1/2 sm:-translate-y-1/2">
            {visible.length > 1 && (
              <div className="flex items-center gap-1">
                {visible.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIdx(i)}
                    aria-label={`公告 ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`}
                  />
                ))}
              </div>
            )}
            {a.dismissible && (
              <button onClick={() => dismiss(a.id)} aria-label="关闭公告"
                className="w-6 h-6 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ───────── 详情弹窗（无链接公告点击看全文） ───────── */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {detail && (() => {
            const ds = TYPE_STYLE[detail.type] || TYPE_STYLE.info;
            const DIcon = ds.icon;
            return (
              <>
                {/* 顶部彩色条 */}
                <div className="h-1 w-full" style={{ background: `linear-gradient(90deg,${ds.grad})` }} />
                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${ds.iconBg}`}>
                      <DIcon className={`w-4 h-4 ${ds.iconColor}`} />
                    </span>
                    {detail.title && <h2 className="text-base font-semibold text-foreground leading-snug">{detail.title}</h2>}
                  </div>
                  {detail.content && (
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto scrollbar-thin">
                      {detail.content}
                    </p>
                  )}
                  {detail.link && (
                    <a href={detail.link} target="_blank" rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:underline underline-offset-2">
                      查看详情 <ArrowUpRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
