"use client";

import { useState, useEffect } from "react";
import { Info, AlertTriangle, CheckCircle, Sparkles, X, ArrowUpRight } from "lucide-react";
import { BASE } from "@/lib/api";

type Announcement = {
  id: number;
  title: string;
  content: string;
  type: string;
  link: string;
};

// 类型 → 配色与图标
const TYPE_STYLE: Record<string, { wrap: string; icon: typeof Info }> = {
  info: { wrap: "bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-200 border-sky-200/60 dark:border-sky-500/20", icon: Info },
  warning: { wrap: "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-200/60 dark:border-amber-500/20", icon: AlertTriangle },
  success: { wrap: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-200/60 dark:border-emerald-500/20", icon: CheckCircle },
  activity: { wrap: "bg-violet-50 dark:bg-violet-500/10 text-violet-800 dark:text-violet-200 border-violet-200/60 dark:border-violet-500/20", icon: Sparkles },
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

  useEffect(() => {
    setDismissed(getDismissed());
    fetch(`${BASE}/api/announcements`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.data)) setItems(d.data); })
      .catch(() => {});
  }, []);

  const dismiss = (id: number) => {
    const next = Array.from(new Set([...getDismissed(), id]));
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    setDismissed(next);
  };

  const visible = items.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="w-full">
      {visible.map((a) => {
        const style = TYPE_STYLE[a.type] || TYPE_STYLE.info;
        const Icon = style.icon;
        const body = (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {a.title && <strong className="font-semibold">{a.title}</strong>}
              {a.title && a.content && <span className="mx-1.5 opacity-40">·</span>}
              {a.content && <span className="opacity-90">{a.content}</span>}
            </span>
            {a.link && <ArrowUpRight className="w-3.5 h-3.5 shrink-0 opacity-70" />}
          </div>
        );
        return (
          <div key={a.id} className={`border-b ${style.wrap}`}>
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-1.5 flex items-center gap-2 text-[12.5px]">
              {a.link ? (
                <a href={a.link} target="_blank" rel="noreferrer" className="contents hover:underline underline-offset-2">
                  {body}
                </a>
              ) : body}
              <button
                onClick={() => dismiss(a.id)}
                className="shrink-0 p-1 -mr-1 rounded-md opacity-50 hover:opacity-100 transition-opacity"
                aria-label="关闭公告"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
