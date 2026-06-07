"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, AlertTriangle, CheckCircle, Sparkles, X, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
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
const TYPE_STYLE: Record<string, { dot: string; grad: string; icon: typeof Info; iconColor: string; iconBg: string }> = {
  info:     { dot: "from-cyan-400 to-sky-500",       grad: "#22d3ee,#0ea5e9",  icon: Info,          iconColor: "text-cyan-500 dark:text-cyan-400",      iconBg: "bg-cyan-500/10" },
  warning:  { dot: "from-amber-400 to-orange-500",   grad: "#fbbf24,#f97316",  icon: AlertTriangle, iconColor: "text-amber-500 dark:text-amber-400",    iconBg: "bg-amber-500/10" },
  success:  { dot: "from-emerald-400 to-teal-500",   grad: "#34d399,#14b8a6",  icon: CheckCircle,   iconColor: "text-emerald-500 dark:text-emerald-400", iconBg: "bg-emerald-500/10" },
  activity: { dot: "from-violet-400 to-fuchsia-500", grad: "#a78bfa,#e879f9",  icon: Sparkles,      iconColor: "text-violet-500 dark:text-violet-400",  iconBg: "bg-violet-500/10" },
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
  const go = (dir: number) => setIdx((i) => (i + dir + visible.length) % visible.length);

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
      <div
        className="relative w-full border-b border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-[#0b0e16]/80 backdrop-blur-xl overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* 顶部光谱微光线 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.4),rgba(99,102,241,0.3)_50%,rgba(232,121,249,0.3),transparent)]" />

        {/* ───────── 桌面：优雅细条单行 (≥sm) ───────── */}
        <div className="hidden sm:flex max-w-6xl mx-auto px-4 md:px-6 h-9 items-center gap-3 text-[12.5px]">
          <button onClick={openMain} className="group flex items-center gap-2.5 min-w-0 flex-1 text-left">
            <Icon className={`w-3.5 h-3.5 shrink-0 ${style.iconColor}`} />
            <AnimatePresence mode="wait">
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="min-w-0 flex-1 flex items-center gap-1.5 whitespace-nowrap overflow-hidden"
              >
                {a.title && <strong className="font-semibold text-zinc-900 dark:text-zinc-100 group-hover:underline underline-offset-2">{a.title}</strong>}
                {a.title && a.content && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                {a.content && <span className="truncate text-zinc-600 dark:text-zinc-300 group-hover:underline underline-offset-2">{a.content}</span>}
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
            </AnimatePresence>
          </button>

          {/* 轮播指示点 */}
          {visible.length > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              {visible.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  aria-label={`公告 ${i + 1}`}
                  className={`h-1 rounded-full transition-all duration-300 ${i === idx ? "w-4 bg-gradient-to-r " + style.dot : "w-1 bg-zinc-300 dark:bg-zinc-600 hover:bg-zinc-400"}`}
                />
              ))}
            </div>
          )}

          {a.dismissible && (
            <button onClick={() => dismiss(a.id)} aria-label="关闭公告"
              className="shrink-0 p-1 -mr-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ───────── 移动端：可换行卡片条 (<sm) ───────── */}
        <div className="sm:hidden px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ${style.iconBg}`}>
              <Icon className={`w-4 h-4 ${style.iconColor}`} />
            </span>
            <AnimatePresence mode="wait">
              <motion.button
                key={a.id}
                onClick={openMain}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="min-w-0 flex-1 text-left"
              >
                {a.title && <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{a.title}</p>}
                {a.content && (
                  <p className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed line-clamp-2 mt-0.5">
                    {a.content}
                    {a.link && <ArrowUpRight className="w-3 h-3 inline -mt-0.5 ml-0.5 text-zinc-400" />}
                  </p>
                )}
              </motion.button>
            </AnimatePresence>
            {a.dismissible && (
              <button onClick={() => dismiss(a.id)} aria-label="关闭公告"
                className="shrink-0 -mt-0.5 -mr-1 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* 移动端轮播控制：左右切换 + 指示点 + 计数 */}
          {visible.length > 1 && (
            <div className="flex items-center justify-center gap-3 mt-2">
              <button onClick={() => go(-1)} aria-label="上一条" className="p-1 rounded-md text-zinc-400 active:scale-90 transition-transform">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1">
                {visible.map((_, i) => (
                  <button key={i} onClick={() => setIdx(i)} aria-label={`公告 ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? "w-5 bg-gradient-to-r " + style.dot : "w-1.5 bg-zinc-300 dark:bg-zinc-600"}`} />
                ))}
              </div>
              <button onClick={() => go(1)} aria-label="下一条" className="p-1 rounded-md text-zinc-400 active:scale-90 transition-transform">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
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
