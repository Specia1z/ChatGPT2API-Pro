"use client";

import { useState, useEffect, useRef } from "react";
import { Info, AlertTriangle, CheckCircle, Sparkles, X, ArrowUpRight } from "lucide-react";
import { BASE } from "@/lib/api";

type Announcement = {
  id: number;
  title: string;
  content: string;
  type: string;
  link: string;
  dismissible: boolean;
};

// 类型 → 配色与图标（光谱主题）
const TYPE_STYLE: Record<string, { dot: string; icon: typeof Info; iconColor: string }> = {
  info:     { dot: "from-cyan-400 to-sky-500",      icon: Info,          iconColor: "text-cyan-500 dark:text-cyan-400" },
  warning:  { dot: "from-amber-400 to-orange-500",  icon: AlertTriangle, iconColor: "text-amber-500 dark:text-amber-400" },
  success:  { dot: "from-emerald-400 to-teal-500",  icon: CheckCircle,   iconColor: "text-emerald-500 dark:text-emerald-400" },
  activity: { dot: "from-violet-400 to-fuchsia-500", icon: Sparkles,     iconColor: "text-violet-500 dark:text-violet-400" },
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

  useEffect(() => {
    setDismissed(getDismissed());
    fetch(`${BASE}/api/announcements`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.data)) setItems(d.data); })
      .catch(() => {});
  }, []);

  const visible = items.filter((a) => !dismissed.includes(a.id));

  // 轮播：多条时每 5s 切换下一条（悬停暂停）
  useEffect(() => {
    if (visible.length <= 1 || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % visible.length), 5000);
    return () => clearInterval(t);
  }, [visible.length, paused]);

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

  const inner = (
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${style.iconColor}`} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div key={a.id} className="flex items-center gap-1.5 whitespace-nowrap" style={{ animation: "annFade 0.5s ease-out" }}>
          {a.title && <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{a.title}</strong>}
          {a.title && a.content && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
          {a.content && <span className="text-zinc-600 dark:text-zinc-300">{a.content}</span>}
          {a.link && <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-400" />}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="relative w-full border-b border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-[#0b0e16]/80 backdrop-blur-xl overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 顶部光谱微光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.4),rgba(99,102,241,0.3)_50%,rgba(232,121,249,0.3),transparent)]" />

      <div className="max-w-6xl mx-auto px-4 md:px-6 h-9 flex items-center gap-3 text-[12.5px]">
        {a.link ? (
          <a href={a.link} target="_blank" rel="noreferrer" className="contents hover:[&_strong]:underline hover:[&_span]:underline underline-offset-2">
            {inner}
          </a>
        ) : inner}

        {/* 轮播指示点（多条时） */}
        {visible.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {visible.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`公告 ${i + 1}`}
                className={`h-1 rounded-full transition-all duration-300 ${i === idx ? "w-4 bg-gradient-to-r " + style.dot : "w-1 bg-zinc-300 dark:bg-zinc-600"}`}
              />
            ))}
          </div>
        )}

        {/* 关闭按钮 — 仅可关闭的公告显示 */}
        {a.dismissible && (
          <button
            onClick={() => dismiss(a.id)}
            className="shrink-0 p-1 -mr-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            aria-label="关闭公告"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
