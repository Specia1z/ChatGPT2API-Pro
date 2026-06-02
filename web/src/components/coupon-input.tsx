"use client";

import { Tag, Check } from "lucide-react";

interface CouponInputProps {
  value: string;
  onChange: (v: string) => void;
  onApply: () => Promise<void>;
  discount?: { discount: number } | null;
  validating?: boolean;
  compact?: boolean;
}

export function CouponInput({ value, onChange, onApply, discount, validating, compact }: CouponInputProps) {
  const applied = !!discount;

  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "justify-center"}`}>
      <div className={`relative flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        <Tag className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} ${applied ? "text-emerald-500" : "text-zinc-400"}`} />
        <input
          value={value}
          onChange={e => onChange(e.target.value.toUpperCase())}
          placeholder={compact ? "优惠码" : "输入优惠码"}
          readOnly={applied}
          maxLength={15}
          className={`
            rounded-lg border bg-white dark:bg-zinc-900 text-center font-mono tracking-wider outline-none transition-colors
            focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600
            ${compact ? "h-6 w-20 text-[9px]" : "h-8 w-28 text-[10px]"}
            ${applied
              ? "border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/5"
              : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-700"
            }
          `}
        />
      </div>

      {applied ? (
        <span className={`flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400 ${compact ? "text-[9px]" : "text-[10px]"}`}>
          <Check className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
          -¥{discount?.discount.toFixed(2)}
        </span>
      ) : (
        <button
          onClick={onApply}
          disabled={validating || !value.trim()}
          className={`
            rounded-lg font-medium transition-colors
            bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200
            disabled:opacity-40 disabled:cursor-not-allowed
            ${compact ? "h-6 px-2 text-[9px]" : "h-8 px-3 text-[10px]"}
          `}
        >
          {validating ? (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </span>
          ) : "应用"}
        </button>
      )}
    </div>
  );
}
