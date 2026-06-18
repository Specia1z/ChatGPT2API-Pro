"use client";

import { useState, useEffect } from "react";
import { Coins, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, BASE } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function RechargeDialog({ open, onOpenChange }: Props) {
  const [points, setPoints] = useState(100);
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!open) return;
    fetch(`${BASE}/api/settings`)
      .then(r => r.json())
      .then(d => {
        if (d?.data?.credit_config) {
          try {
            const cc = JSON.parse(d.data.credit_config);
            if (cc?.rate > 0) setRate(cc.rate);
          } catch {}
        }
      })
      .catch(() => {});
  }, [open]);

  const amount = rate > 0 ? (points / rate).toFixed(2) : points.toFixed(2);

  const handleRecharge = async () => {
    if (points <= 0) return;
    setLoading(true);
    try {
      const res = await api<any>("/api/user/recharge", {
        method: "POST",
        body: JSON.stringify({ points, gateway: "credit" }),
      });
      const url = res.data?.redirect_url;
      if (url) {
        window.location.href = url;
      } else {
        toast.error("无法获取支付链接");
      }
    } catch (e: any) {
      toast.error(e.message || "充值失败");
    } finally {
      setLoading(false);
    }
  };

  const presets = [50, 100, 200, 500, 1000];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="size-4" /> 充值积分
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setPoints(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  points === p
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">自定义数量</label>
            <Input
              type="number"
              min={1}
              value={points}
              onChange={e => setPoints(Math.max(1, +e.target.value || 0))}
              className="h-10"
            />
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">充值积分</span>
              <span className="font-medium">{points}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">需支付（LDC 积分）</span>
              <span className="font-medium">{amount}</span>
            </div>
          </div>
          <Button onClick={handleRecharge} disabled={loading || points <= 0} className="w-full h-10">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" />}
            {loading ? "跳转支付中..." : `充值 ${points} 积分`}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            支付完成后积分将自动到账，如未到账请刷新页面
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
