"use client";

import { useState, useEffect, useRef } from "react";

export function AnimatedPrice({ value, className, prefix = "¥" }: { value: number; className?: string; prefix?: string }) {
  const [display, setDisplay] = useState("0");
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const duration = 600;
    const startTime = performance.now();
    const decimals = Math.max(0, String(end).split(".")[1]?.length || 0);

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = start + (end - start) * eased;
      setDisplay(current.toFixed(decimals));
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
    prevRef.current = end;
  }, [value]);

  return <span className={className}>{prefix}{display}</span>;
}
