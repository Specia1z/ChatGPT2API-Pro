"use client";

import { useState, useEffect } from "react";

/* ── helpers ────────────────────────── */

function breakDown(ms: number) {
  if (ms <= 0) return { y: 0, m: 0, d: 0, h: 0, min: 0, s: 0 };
  const totalDays = ms / 86400000;
  const y = Math.floor(totalDays / 365);
  const m = Math.floor((totalDays % 365) / 30);
  const d = Math.floor(totalDays % 30);
  const rest = ms % 86400000;
  const h = Math.floor(rest / 3600000);
  const min = Math.floor((rest % 3600000) / 60000);
  const s = Math.floor((rest % 60000) / 1000);
  return { y, m, d, h, min, s };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/* ── Props ── */

interface Props {
  expiresAt: string | null;
}

/* ── Main ── */

export function SubscriptionTimer({ expiresAt }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── 永久 ──
  if (!expiresAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </span>
        <span className="tracking-wide">永久有效</span>
      </span>
    );
  }

  const diff = new Date(expiresAt).getTime() - now;

  // ── 已过期 ──
  if (diff <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-500 dark:text-red-400 font-medium">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-red-400 animate-pulse" />
        </span>
        <span>已过期</span>
      </span>
    );
  }

  const { y, m, d, h, min, s } = breakDown(diff);

  // Format: "1年 3月 12天 05:30:45"
  const parts: string[] = [];
  if (y > 0) parts.push(`${y}年`);
  if (m > 0) parts.push(`${m}月`);
  if (d > 0) parts.push(`${d}天`);
  const hms = `${pad(h)}:${pad(min)}:${pad(s)}`;

  const isUrgent = diff < 3 * 86400000;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      {/* dot */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className={`absolute inset-0 rounded-full ${isUrgent ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
      </span>
      {/* label */}
      <span className="text-zinc-400">剩余</span>
      {/* numbers */}
      <span className={`font-mono tabular-nums tracking-tight ${isUrgent ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-900 dark:text-zinc-100"}`}>
        {parts.join("")}
        {parts.length > 0 ? " " : ""}{hms}
      </span>
    </span>
  );
}
