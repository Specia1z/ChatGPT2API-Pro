"use client";

import { useState, useEffect } from "react";
import { Outfit, DM_Mono } from "next/font/google";
import { ShoppingBag, Coins, Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export default function ShopPage() {
  const [items, setItems] = useState<any[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buyTarget, setBuyTarget] = useState<any>(null);
  const [buying, setBuying] = useState(false);

  const load = async () => {
    try {
      const r = await api<any>("/api/user/shop");
      setItems(r.data?.items || []);
      setPoints(r.data?.points || 0);
    } catch (e: any) { toast.error(e.message || "加载失败"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const redeem = async () => {
    if (!buyTarget) return;
    setBuying(true);
    try {
      const r = await api<any>("/api/user/shop/redeem", { method: "POST", body: JSON.stringify({ item_id: buyTarget.id }) });
      toast.success(`兑换成功！${r.data?.plan || ""} +${buyTarget.days || 0}天`);
      setBuyTarget(null);
      load();
    } catch (e: any) { toast.error(e.message || "兑换失败"); }
    setBuying(false);
  };

  return (
    <div className={`${heading.variable} ${mono.variable} min-h-screen bg-background`}>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-pink-500/10 flex items-center justify-center">
              <ShoppingBag className="size-5 text-pink-500" />
            </div>
            <div>
              <h1 className={`${heading.className} text-xl font-bold tracking-tight`}>积分商城</h1>
              <p className="text-xs text-muted-foreground mt-0.5">用积分兑换套餐时长</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2">
            <Coins className="size-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">我的积分</span>
            <span className={`${mono.className} text-lg font-bold tabular-nums text-amber-500`}>{points}</span>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground/60">
            <ShoppingBag className="size-10 mx-auto mb-3" />
            <p className="text-sm">商城暂未上架商品</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(it => {
              const affordable = points >= it.points;
              return (
                <div key={it.id} className="rounded-2xl border bg-card overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  <div className="p-5 flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-9 rounded-xl bg-gradient-to-br from-pink-500/15 to-violet-500/15 flex items-center justify-center">
                        <Crown className="size-4 text-pink-500" />
                      </div>
                      <h3 className={`${heading.className} text-base font-bold truncate`}>{it.name}</h3>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">套餐</span><span className="font-medium">{it.plan_name || "—"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">时长</span><span className="font-medium">{it.days > 0 ? `${it.days} 天` : "永久"}</span></div>
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t flex items-center justify-between bg-muted/20">
                    <span className="flex items-center gap-1"><Coins className="size-4 text-amber-500" /><span className={`${mono.className} font-bold tabular-nums`}>{it.points}</span></span>
                    <Button size="sm" disabled={!affordable} onClick={() => setBuyTarget(it)} className="gap-1.5">
                      {affordable ? "兑换" : "积分不足"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ConfirmDialog open={!!buyTarget} onOpenChange={() => !buying && setBuyTarget(null)}
        title="确认兑换"
        description={buyTarget ? `用 ${buyTarget.points} 积分兑换「${buyTarget.name}」（${buyTarget.plan_name} ${buyTarget.days > 0 ? buyTarget.days + "天" : "永久"}）？兑换后将累加到你的订阅到期时间。` : ""}
        confirmLabel={buying ? "兑换中…" : "确认兑换"} onConfirm={redeem} />
    </div>
  );
}
