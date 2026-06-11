// 用户中心数值动画 hooks：缓动数字 + 令牌恢复倒计时。
import { useState, useEffect, useRef } from "react";
import { formatHMS } from "./helpers";

/* 缓动数字（两位小数） */
export function useAnimatedNumber(value: number): number {
  const [display, setDisplay] = useState(0);
  const cur = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const from = cur.current;
    if (Math.abs(value - from) < 0.5) { cur.current = value; setDisplay(value); return; }
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min((now - start) / 900, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * e;
      cur.current = v; setDisplay(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return display;
}

/* 令牌恢复倒计时：返回预估当前值 + 下一个令牌的剩余时间（满额或无恢复时返回 null） */
export function useCountdown(tokens: number, cap: number, refill: number): { est: number; nextHMS: string | null } | null {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (refill <= 0) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [tokens, cap, refill]);
  if (tokens >= cap || refill <= 0) return null;
  const est = Math.min(tokens + (tick * refill) / 3600, cap);
  if (est >= cap) return { est, nextHMS: null };
  return { est, nextHMS: formatHMS(((Math.floor(est) + 1 - est) / refill) * 3600) };
}
