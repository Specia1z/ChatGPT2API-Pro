"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ImageIcon, RefreshCw, X, Trash2, Eye, ImagePlus, Share2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { imageProxyUrl } from "@/lib/utils";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/* ═══════════════════════════════════════════
   AdminGenerationsPage
   ═══════════════════════════════════════════ */

export default function AdminGenerationsPage() {
  const [gens, setGenerations] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageSize = 20;

  const fetchGens = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await api(`/api/admin/generations?page=${p}&page_size=${pageSize}`);
      const items = r.data?.items || [];
      setTotal(r.data?.total || 0);
      if (append) setGenerations(prev => [...prev, ...items]);
      else setGenerations(items);
      setHasMore(items.length === pageSize);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchGens(1, false); }, [fetchGens]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasMore && !loading) { const n = page + 1; setPage(n); fetchGens(n, true); } },
      { threshold: 0.1 }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [page, hasMore, loading, fetchGens]);

  const handleImageLoad = (id: number) => setLoadedImages(prev => new Set(prev).add(String(id)));

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api("/api/admin/generations", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) });
      setGenerations(prev => prev.filter(x => x.id !== deleteTarget.id));
      setTotal(t => t - 1);
      toast.success("已删除"); setDeleteTarget(null);
    } catch { toast.error("删除失败"); }
  };

  const adminUnshare = async (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    try {
      await api("/api/admin/gallery", { method: "DELETE", body: JSON.stringify({ id: g.id }) });
      setGenerations(prev => prev.map(x => x.id === g.id ? { ...x, shared: false } : x));
      toast.success("已下架");
    } catch { toast.error("操作失败"); }
  };

  /* ── Stats ── */
  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = gens.filter(g => g.created_at?.slice(0, 10) === today).length;
    const failedCount = gens.filter(g => g.status === "failed").length;
    const sharedCount = gens.filter(g => g.shared).length;
    return { todayCount, failedCount, sharedCount };
  }, [gens]);

  const fmtDate = (s: string) => s ? s.slice(5, 16) : "";

  if (loading && gens.length === 0) return (
    <div className="h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen bg-zinc-50 dark:bg-zinc-950 flex overflow-hidden">
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 px-8 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
            <div>
              <h1 className="text-sm font-semibold tracking-tight">生图管理</h1>
              <p className="text-[10px] text-zinc-400 mt-0.5 tracking-wide">
                共 <span className="font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums">{total}</span> 条记录
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setPage(1); fetchGens(1, false); }}
            className="gap-1.5 h-7 text-[10px] text-zinc-400 hover:text-zinc-600">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
        </div>

        <div className="flex-1 p-6 overflow-auto scrollbar-thin">

          {/* ═══ Stats strip ═══ */}
          <div className="flex items-stretch gap-0 mb-5 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 overflow-hidden">
            {[
              { label: "总记录", value: total, fill: "#6366f1" },
              { label: "今日生成", value: stats.todayCount, fill: "#10b981" },
              { label: "失败", value: stats.failedCount, fill: "#ef4444" },
              { label: "已分享", value: stats.sharedCount, fill: "#3b82f6" },
            ].map((item, i) => (
              <div key={item.label} className="flex-1 relative flex flex-col items-center justify-center py-3.5">
                <div className="text-lg font-bold tabular-nums tracking-tight" style={{ color: item.fill }}>{item.value}</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{item.label}</div>
                {i < 3 && <div className="absolute right-0 top-3 bottom-3 w-px bg-zinc-100 dark:bg-zinc-800" />}
              </div>
            ))}
          </div>

          {/* ═══ Masonry grid ═══ */}
          {gens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
              <ImageIcon className="w-8 h-8 mb-3 text-zinc-300 dark:text-zinc-600" />
              <p className="text-xs">暂无生图记录</p>
            </div>
          ) : (
            <>
              <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-3 space-y-3">
                {gens.map(g => {
                  const isLoaded = loadedImages.has(String(g.id));
                  const isFailed = g.status === "failed";
                  const imgSrc = imageProxyUrl(g) || null;
                  return (
                    <div key={g.id} className={`group relative break-inside-avoid rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 hover:shadow-lg dark:hover:shadow-zinc-900/50 transition-all duration-300 ${isFailed ? "ring-1 ring-red-200 dark:ring-red-500/20" : ""}`}>
                      {imgSrc ? (
                        <>
                          <div className="relative cursor-pointer" onClick={() => setPreview(imgSrc)}>
                            <img
                              src={imgSrc}
                              alt={g.prompt || ""}
                              loading="lazy"
                              onLoad={() => handleImageLoad(g.id)}
                              className={`w-full h-auto block transition-opacity duration-500 ${isLoaded ? "opacity-100" : "opacity-0"}`}
                            />
                            {!isLoaded && (
                              <div className="absolute inset-0 animate-pulse bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                <ImagePlus className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
                              </div>
                            )}
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <div className="absolute top-2 right-2 flex gap-1">
                                <button className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 backdrop-blur-sm transition-colors">
                                  <Eye className="w-3 h-3 text-white" />
                                </button>
                                <button onClick={e => { e.stopPropagation(); setDeleteTarget(g); }}
                                  className="p-1.5 rounded-lg bg-white/15 hover:bg-red-500/80 backdrop-blur-sm transition-colors">
                                  <Trash2 className="w-3 h-3 text-white" />
                                </button>
                              </div>
                              {g.shared && (
                                <button onClick={e => adminUnshare(e, g)}
                                  className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/15 hover:bg-red-500/80 backdrop-blur-sm text-[9px] text-white font-medium transition-colors">
                                  <Share2 className="w-2.5 h-2.5" /> 下架
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Footer info */}
                          <div className="px-2.5 py-2 space-y-1">
                            <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">{g.prompt || "无提示词"}</p>
                            <div className="flex items-center gap-1.5 text-[9px] text-zinc-400">
                              {g.user_email && <span className="truncate font-mono flex-1">{g.user_email}</span>}
                              {g.size && <span className="px-1 py-px rounded bg-zinc-100 dark:bg-zinc-800 font-mono shrink-0">{g.size}</span>}
                              <span className="shrink-0 tabular-nums">{fmtDate(g.created_at)}</span>
                            </div>
                            {g.shared && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-violet-500 font-medium">
                                <Share2 className="w-2 h-2" /> 已分享
                              </span>
                            )}
                          </div>
                        </>
                      ) : isFailed ? (
                        <div className="aspect-[4/3] flex items-center justify-center bg-red-50 dark:bg-red-500/5">
                          <div className="text-center p-4">
                            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-2">
                              <X className="w-4 h-4 text-red-400" />
                            </div>
                            <p className="text-[10px] text-red-500 font-medium">生成失败</p>
                            {g.error_msg && <p className="text-[9px] text-red-400 mt-0.5 line-clamp-2">{g.error_msg}</p>}
                            <button onClick={() => setDeleteTarget(g)}
                              className="mt-2 text-[9px] text-red-400 hover:text-red-600 transition-colors">删除</button>
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-[4/3] flex items-center justify-center bg-zinc-50 dark:bg-zinc-800/50">
                          <div className="text-center">
                            <RefreshCw className="w-5 h-5 animate-spin text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                            <p className="text-[10px] text-zinc-400">生成中...</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
                {loading && gens.length > 0 && <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />}
                {!hasMore && gens.length > 0 && <span className="text-[10px] text-zinc-400">已加载全部 {total} 条</span>}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ═══ Delete Confirm ═══ */}
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="删除生成记录" description="确定要删除此生成记录？此操作不可撤销。"
        confirmLabel="删除" variant="destructive" onConfirm={confirmDelete}
      />

      {/* ═══ Preview ═══ */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-zinc-800">
          <button onClick={() => setPreview(null)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          {preview && <img src={preview} alt="Preview" className="w-full h-full object-contain rounded-xl" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
