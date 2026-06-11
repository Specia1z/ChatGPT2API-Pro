"use client";

import { Zap, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  exchangeTokens: number;
  setExchangeTokens: (n: number) => void;
  exchangeRate: number;
  exchangeBonus: number;
  userPoints: number;
  exchanging: boolean;
  onExchange: () => void;
};

// 积分兑换突发令牌弹窗。
export function ExchangeDialog({ open, onOpenChange, exchangeTokens, setExchangeTokens, exchangeRate, exchangeBonus, userPoints, exchanging, onExchange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <div className="p-2 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <Zap className="size-5 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">兑换突发令牌</h3>
              <p className="text-xs text-zinc-500 dark:text-white/50">积分 → 突发令牌（不受上限限制）</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 dark:text-white/50 block mb-1.5">兑换数量</label>
              <div className="flex items-center gap-1">
                {[10, 20, 50, 100].map(n => (
                  <button key={n} onClick={() => setExchangeTokens(n)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                      exchangeTokens === n
                        ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm"
                        : "bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-500 dark:text-white/55 hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.12]"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
              <Input type="number" min={1} value={exchangeTokens} onChange={e => setExchangeTokens(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-2 text-center" />
            </div>
          </div>

          <div className="rounded-xl bg-zinc-900/[0.04] dark:bg-white/[0.04] p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-white/50">需消耗积分</span>
              <span className="font-medium tabular-nums text-zinc-900 dark:text-white">{exchangeTokens * exchangeRate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-white/50">获得突发令牌</span>
              <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">
                {exchangeTokens}{exchangeBonus > 0 && exchangeTokens >= 50 ? ` + ${exchangeBonus * Math.floor(exchangeTokens / 50)} 奖励` : ""}
              </span>
            </div>
            {exchangeBonus > 0 && (
              <div className="flex justify-between text-[10px] text-zinc-400 dark:text-white/40">
                <span>兑换 ≥50 额外赠送</span>
                <span>每 50 个 +{exchangeBonus}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-zinc-900/[0.07] dark:border-white/10">
              <span className="text-zinc-500 dark:text-white/50">当前积分</span>
              <span className="font-medium tabular-nums text-zinc-900 dark:text-white">{userPoints}</span>
            </div>
          </div>

          <Button onClick={onExchange} disabled={exchanging || exchangeTokens <= 0 || userPoints < exchangeTokens * exchangeRate}
            className="w-full gap-1.5">
            {exchanging ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {exchanging ? "兑换中..." : "确认兑换"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
