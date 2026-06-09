"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ShieldCheck, RefreshCw, Check, X, ImagePlus, Eye, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { imageProxyUrl, formatShort } from "@/lib/utils";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/* ═══════════════════════════════════════════
   AdminSharesPage — 分享内容审核（先审后发）
   待审队列：通过 → 公开到广场；拒绝 → 附原因，不公开
   ═══════════════════════════════════════════ */

export default function AdminSharesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageSize = 20;

  const fetchPending = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await api(`/api/admin/shares/pending?page=${p}&page_size=${pageSize}`);
      const list = r.data?.items || [];
      setTotal(r.data?.total || 0);
      if (append) setItems(prev => [...prev, ...list]);
      else setItems(list);
      setHasMore(list.length === pageSize);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchPending(1, false); }, [fetchPending]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasMore && !loading) { const n = page + 1; setPage(n); fetchPending(n, true); } },
      { threshold: 0.1 }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [page, hasMore, loading, fetchPending]);

  const onLoad = (id: number) => setLoaded(prev => new Set(prev).add(String(id)));

  // 通过：公开到广场
  const approve = async (g: any) => {
    setBusy(g.id);
    try {
      await api("/api/admin/shares/review", { method: "POST", body: JSON.stringify({ id: g.id, approve: true }) });
      setItems(prev => prev.filter(x => x.id !== g.id));
      setTotal(t => Math.max(0, t - 1));
      toast.success("已通过并展示到广场");
    } catch { toast.error("操作失败，请重试"); }
    setBusy(null);
  };

  // 拒绝：附原因
  const doReject = async () => {
    if (!rejectTarget) return;
    setBusy(rejectTarget.id);
    try {
      await api("/api/admin/shares/review", { method: "POST", body: JSON.stringify({ id: rejectTarget.id, approve: false, reason: rejectReason.trim() }) });
      setItems(prev => prev.filter(x => x.id !== rejectTarget.id));
      setTotal(t => Math.max(0, t - 1));
      toast.success("已拒绝");
    } catch { toast.error("操作失败，请重试"); }
    setBusy(null);
    setRejectTarget(null);
    setRejectReason("");
  };

  if (loading && items.length === 0) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-1 h-5 rounded-full bg-foreground/20 shrink-0" />
            <div>
              <h1 className="text-sm font-semibold tracking-tight">内容审核</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5 tracking-wide">
                待审 <span className="font-semibold text-foreground tabular-nums">{total}</span> 条
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setPage(1); fetchPending(1, false); }}
            className="gap-1 sm:gap-1.5 h-7 text-[10px] text-muted-foreground hover:text-foreground px-1.5 sm:px-2 shrink-0">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">刷新</span>
          </Button>
        </div>

        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <ShieldCheck className="w-8 h-8 mb-3 text-emerald-500/50" />
              <p className="text-xs">暂无待审内容，全部处理完毕</p>
            </div>
          ) : (
            <>
              <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
                {items.map(g => {
                  const isLoaded = loaded.has(String(g.id));
                  const imgSrc = imageProxyUrl(g) || null;
                  return (
                    <div key={g.id} className="group relative break-inside-avoid rounded-xl overflow-hidden bg-card border hover:shadow-lg transition-all duration-300">
                      {imgSrc && (
                        <div className="relative cursor-pointer" onClick={() => setPreview(imgSrc)}>
                          <img src={imgSrc} alt={g.prompt || ""} loading="lazy" onLoad={() => onLoad(g.id)}
                            className={`w-full h-auto block transition-opacity duration-500 ${isLoaded ? "opacity-100" : "opacity-0"}`} />
                          {!isLoaded && (
                            <div className="absolute inset-0 animate-pulse bg-muted flex items-center justify-center">
                              <ImagePlus className="w-5 h-5 text-muted-foreground/50" />
                            </div>
                          )}
                          <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/90 text-[9px] text-white font-medium">
                            <Clock className="w-2.5 h-2.5" /> 待审
                          </span>
                        </div>
                      )}
                      {/* 信息 + 操作 */}
                      <div className="p-2.5 space-y-2">
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{g.prompt}</p>
                        <p className="text-[9px] text-muted-foreground/70 truncate">
                          {g.user_name || g.user_email || `用户#${g.user_id}`} · {formatShort(g.created_at)}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button disabled={busy === g.id} onClick={() => approve(g)}
                            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white text-[11px] font-medium transition-colors disabled:opacity-50">
                            <Check className="w-3 h-3" /> 通过
                          </button>
                          <button disabled={busy === g.id} onClick={() => { setRejectTarget(g); setRejectReason(""); }}
                            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white text-[11px] font-medium transition-colors disabled:opacity-50">
                            <X className="w-3 h-3" /> 拒绝
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div ref={sentinelRef} className="h-8" />
            </>
          )}
        </div>
      </main>

      {/* 预览大图 */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-3xl p-0 bg-transparent border-0 shadow-none">
          {preview && <img src={preview} alt="" className="w-full h-auto rounded-xl" />}
        </DialogContent>
      </Dialog>

      {/* 拒绝原因 */}
      <Dialog open={!!rejectTarget} onOpenChange={() => { setRejectTarget(null); setRejectReason(""); }}>
        <DialogContent className="max-w-sm">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">拒绝分享</h3>
            <p className="text-xs text-muted-foreground">填写拒绝原因（可选），将记录到该作品。</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} maxLength={255}
              placeholder="如：包含违规 / 低质量内容…"
              className="w-full rounded-lg border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-foreground/20" />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>取消</Button>
              <Button size="sm" onClick={doReject} className="bg-red-500 hover:bg-red-600 text-white">确认拒绝</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

