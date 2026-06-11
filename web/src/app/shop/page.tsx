"use client";

import { useState, useEffect } from "react";
import { ShoppingBag, Coins, Sparkles, Loader2, Image as ImageIcon, Timer, Layers, Clock, Gauge, Check, Tag, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// 套餐核心指标 → 网格展示（图标 + 数值 + 标签），信息密度高
function buildPlanMetrics(plan: any, days: number) {
  const metrics: { icon: any; value: string; label: string }[] = [];
  if (!plan) return metrics;
  const cap = plan.token_capacity || 0;
  const refill = plan.token_refill_per_hour || 0;
  const conc = plan.concurrency || 0;
  const apiRate = plan.rate_limit_per_min || 0;
  if (cap > 0) metrics.push({ icon: ImageIcon, value: `${cap}`, label: "图片额度（张）" });
  if (refill > 0) metrics.push({ icon: Timer, value: `${refill}/时`, label: "额度恢复" });
  if (conc > 0) metrics.push({ icon: Layers, value: `${conc}`, label: "并发生成" });
  metrics.push({ icon: Gauge, value: `${apiRate > 0 ? apiRate : 600}/分`, label: "API 速率" });
  metrics.push({ icon: Clock, value: days > 0 ? `${days} 天` : "永久", label: "有效期" });
  return metrics;
}

// 套餐自定义特性（后台配置的 features JSON）
function planCustomFeatures(plan: any): string[] {
  if (!plan) return [];
  try { return JSON.parse(plan.features || "[]"); } catch { return []; }
}

export default function ShopPage() {
  const [items, setItems] = useState<any[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buyTarget, setBuyTarget] = useState<any>(null);
  const [buying, setBuying] = useState(false);
  const [detailTarget, setDetailTarget] = useState<any>(null); // 查看套餐详情

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
    <div className="min-h-screen bg-[#fbfbfd] dark:bg-[#06070d] pb-16 md:pb-0">
      <Navbar />

      {/* ════ 流体头部：与全站统一 ════ */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-6%] w-[42vw] h-[42vw] rounded-full blur-[110px] opacity-45 dark:opacity-50 mix-blend-multiply dark:mix-blend-screen bg-[#fbbf24] [will-change:transform]" style={{ animation: "fluidE 18s ease-in-out infinite" }} />
          <div className="absolute top-[-6%] right-[-4%] w-[38vw] h-[38vw] rounded-full blur-[110px] opacity-40 dark:opacity-45 mix-blend-multiply dark:mix-blend-screen bg-[#fb7185] [will-change:transform]" style={{ animation: "fluidD 20s ease-in-out infinite" }} />
          <div className="absolute top-[8%] left-1/3 w-[36vw] h-[36vw] rounded-full blur-[110px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidB 22s ease-in-out infinite" }} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[#fbfbfd] dark:to-[#06070d]" />
        </div>
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

        <div className="relative max-w-3xl mx-auto px-6 pt-16 sm:pt-20 pb-8 text-center">
          <span style={{ animationDelay: "0.05s" }} className="fade-up-anim inline-flex items-center gap-2 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] px-4 py-1.5 backdrop-blur-md text-[11px] font-medium text-zinc-600 dark:text-white/70 tracking-[0.14em] uppercase mb-6">
            <Sparkles className="w-3 h-3" />
            Points Shop
          </span>
          <h1 style={{ animationDelay: "0.15s" }} className="fade-up-anim text-4xl sm:text-5xl md:text-[3.5rem] font-bold tracking-[-0.03em] leading-[1.05] text-zinc-900 dark:text-white mb-4 [text-wrap:balance]">
            积分商城
          </h1>
          <p style={{ animationDelay: "0.25s" }} className="fade-up-anim text-base sm:text-lg text-zinc-500 dark:text-white/55 leading-relaxed max-w-xl mx-auto mb-6">
            用积分兑换套餐时长，兑换后自动累加到你的订阅到期时间
          </p>
          {/* 我的积分 — 玻璃药丸 */}
          <div style={{ animationDelay: "0.35s" }} className="fade-up-anim inline-flex items-center gap-2.5 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/60 dark:bg-white/[0.06] backdrop-blur-md px-5 py-2.5">
            <Coins className="size-4 text-amber-500" />
            <span className="text-xs text-zinc-500 dark:text-white/55">我的积分</span>
            <span className="text-xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{points}</span>
          </div>
        </div>
      </div>

      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        {loading ? (
          <div className="py-20 text-center"><Loader2 className="size-6 animate-spin mx-auto text-zinc-400 dark:text-white/40" /></div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-zinc-400 dark:text-white/40">
            <div className="relative w-16 h-16 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border border-zinc-900/[0.06] dark:border-white/10 flex items-center justify-center mb-4 mx-auto">
              <ShoppingBag className="size-8 text-zinc-300 dark:text-white/30" />
            </div>
            <p className="text-sm font-medium text-zinc-500 dark:text-white/55">商城暂未上架商品</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((it, i) => {
              const affordable = points >= it.points;
              const refPrice = it.plan?.price_monthly || 0; // 套餐月付价，作价值参考
              return (
                <div
                  key={it.id}
                  className="fade-up-anim group relative flex flex-col rounded-[1.75rem] overflow-hidden border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl transition-all duration-500 hover:-translate-y-1.5 hover:bg-white/80 dark:hover:bg-white/[0.06] hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.25)]"
                  style={{ animationDelay: `${0.4 + i * 0.07}s` }}
                >
                  <div className="relative p-6 sm:p-7 flex flex-col flex-1">
                    {/* 商品名 + 关联套餐标签 */}
                    <div className="mb-5">
                      <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white mb-1.5 truncate">{it.name}</h3>
                      <div className="flex items-center gap-2 text-[12px] text-zinc-500 dark:text-white/50">
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.08] px-2.5 py-0.5 font-medium">
                          <Tag className="w-2.5 h-2.5" />{it.plan_name || "套餐"}
                        </span>
                        <span>{it.days > 0 ? `${it.days} 天` : "永久"}</span>
                      </div>
                    </div>

                    {/* 积分价格 + 价值参考 */}
                    <div className="mb-5">
                      <div className="flex items-end gap-1.5">
                        <Coins className="size-6 text-amber-500 mb-1" />
                        <span className="text-5xl font-bold tabular-nums tracking-tight leading-none text-zinc-900 dark:text-white">{it.points}</span>
                        <span className="text-sm font-medium text-zinc-400 dark:text-white/40 mb-1">积分</span>
                      </div>
                      {refPrice > 0 && (
                        <p className="text-[11px] text-zinc-400 dark:text-white/35 mt-2">
                          等值套餐月付价 <span className="font-medium text-zinc-500 dark:text-white/55">¥{refPrice}</span>
                        </p>
                      )}
                    </div>

                    {/* 查看套餐详情入口 */}
                    {it.plan && (
                      <button
                        onClick={() => setDetailTarget(it)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white transition-colors mb-5 w-fit"
                      >
                        <Info className="w-3.5 h-3.5" />
                        查看套餐详情
                      </button>
                    )}

                    <div className="flex-1" />

                    {/* 兑换按钮 */}
                    <Button
                      disabled={!affordable}
                      onClick={() => setBuyTarget(it)}
                      className="w-full h-11 rounded-full text-[13px] font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-zinc-900 dark:disabled:hover:bg-white"
                    >
                      {affordable ? "立即兑换" : `还差 ${it.points - points} 积分`}
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

      {/* 套餐详情弹窗 — 完整额度/并发/速率指标 + 自定义权益 */}
      <Dialog open={!!detailTarget} onOpenChange={(o) => { if (!o) setDetailTarget(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {detailTarget && (() => {
            const metrics = buildPlanMetrics(detailTarget.plan, detailTarget.days);
            const custom = planCustomFeatures(detailTarget.plan);
            return (
              <div className="p-6">
                {/* 标题 */}
                <div className="mb-5">
                  <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white mb-2">{detailTarget.name}</h2>
                  <div className="flex items-center gap-2 text-[12px] text-zinc-500 dark:text-white/50">
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.08] px-2.5 py-0.5 font-medium">
                      <Tag className="w-2.5 h-2.5" />{detailTarget.plan_name || "套餐"}
                    </span>
                    <span className="inline-flex items-center gap-1"><Coins className="w-3 h-3 text-amber-500" />{detailTarget.points} 积分</span>
                  </div>
                </div>

                {/* 核心指标网格 */}
                {metrics.length > 0 && (
                  <div className="grid grid-cols-2 gap-2.5 mb-5">
                    {metrics.map((m, j) => {
                      const Icon = m.icon;
                      return (
                        <div key={j} className="rounded-xl border border-zinc-900/[0.06] dark:border-white/10 bg-zinc-900/[0.02] dark:bg-white/[0.03] px-3.5 py-3">
                          <div className="flex items-center gap-1.5 text-zinc-400 dark:text-white/40 mb-1.5">
                            <Icon className="w-3.5 h-3.5" />
                            <span className="text-[11px] leading-none">{m.label}</span>
                          </div>
                          <div className="text-lg font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{m.value}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 自定义权益 */}
                {custom.length > 0 && (
                  <div className="pt-5 border-t border-zinc-900/[0.07] dark:border-white/10">
                    <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-400 dark:text-white/40 mb-3">套餐权益</p>
                    <ul className="space-y-2.5">
                      {custom.map((text: string, j: number) => (
                        <li key={j} className="flex items-start gap-2.5">
                          <Check className="w-3.5 h-3.5 mt-px shrink-0 text-cyan-600 dark:text-cyan-400" />
                          <span className="text-[13px] leading-relaxed text-zinc-600 dark:text-white/65">{text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 兑换按钮 */}
                <Button
                  disabled={points < detailTarget.points}
                  onClick={() => { setDetailTarget(null); setBuyTarget(detailTarget); }}
                  className="w-full h-11 rounded-full text-[13px] font-semibold mt-6 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
                >
                  {points >= detailTarget.points ? "立即兑换" : `还差 ${detailTarget.points - points} 积分`}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
