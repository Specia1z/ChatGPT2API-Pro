"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Shapes, RefreshCw, X, Trash2, Download, Code2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/* ═══════════════════════════════════════════
   AdminSVGGenerationsPage — 矢量图(SVG)管理
   ═══════════════════════════════════════════ */

// 把 SVG 文本转成 data URI，用 <img> 渲染（img 加载的 SVG 不执行脚本，安全）。
function svgToDataUri(svg: string): string {
  try {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } catch {
    return "";
  }
}

export default function AdminSVGPage() {
  const [gens, setGens] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState<any | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageSize = 20;

  const fetchGens = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await api(`/api/admin/svg-generations?page=${p}&page_size=${pageSize}`);
      const items = r.data?.items || [];
      setTotal(r.data?.total || 0);
      if (append) setGens(prev => [...prev, ...items]);
      else setGens(items);
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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api("/api/admin/generations", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) });
      setGens(prev => prev.filter(x => x.id !== deleteTarget.id));
      setTotal(t => t - 1);
      toast.success("已删除"); setDeleteTarget(null);
    } catch { toast.error("删除失败"); }
  };

  const downloadSvg = (g: any) => {
    const svg = g.image_b64 || "";
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = `vector-${g.id}.svg`; a.click();
    URL.revokeObjectURL(u);
  };

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = gens.filter(g => g.created_at?.slice(0, 10) === today).length;
    const failedCount = gens.filter(g => g.status === "failed").length;
    return { todayCount, failedCount };
  }, [gens]);

  const fmtDate = (s: string) => s ? s.slice(5, 16) : "";

  if (loading && gens.length === 0) return (
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
              <h1 className="text-sm font-semibold tracking-tight">矢量图管理</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5 tracking-wide">
                共 <span className="font-semibold text-foreground tabular-nums">{total}</span> 条 SVG 记录
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setPage(1); fetchGens(1, false); }}
            className="gap-1 sm:gap-1.5 h-7 text-[10px] text-muted-foreground hover:text-foreground px-1.5 sm:px-2 shrink-0">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">刷新</span>
          </Button>
        </div>

        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin">
          {/* ═══ Stats ═══ */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
            {[
              { label: "总记录", value: total, icon: Shapes, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
              { label: "今日生成", value: stats.todayCount, icon: RefreshCw, color: "text-emerald-500", bg: "bg-emerald-500/10" },
              { label: "失败", value: stats.failedCount, icon: X, color: "text-red-500", bg: "bg-red-500/10" },
            ].map(item => (
              <div key={item.label} className="rounded-xl border bg-card p-3 sm:p-3.5">
                <div className={`size-7 sm:size-8 rounded-lg ${item.bg} flex items-center justify-center mb-1.5 sm:mb-2`}>
                  <item.icon className={`size-3.5 sm:size-4 ${item.color}`} />
                </div>
                <p className="text-base sm:text-lg font-semibold tabular-nums leading-none">{item.value}</p>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-1 sm:mt-1.5">{item.label}</p>
              </div>
            ))}
          </div>
          {/* PLACEHOLDER_GRID */}
          {gens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <Shapes className="w-8 h-8 mb-3 text-muted-foreground/50" />
              <p className="text-xs">暂无矢量图记录</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {gens.map(g => {
                  const isFailed = g.status === "failed";
                  const svg = g.image_b64 || "";
                  const uri = svg ? svgToDataUri(svg) : "";
                  return (
                    <div key={g.id} className={`group relative rounded-xl overflow-hidden bg-card border hover:shadow-lg transition-all ${isFailed ? "ring-1 ring-red-500/20" : ""}`}>
                      {uri ? (
                        <>
                          <div className="relative aspect-square bg-[conic-gradient(at_50%_50%,#f8f8f8_25%,#efefef_0_50%,#f8f8f8_0_75%,#efefef_0)] bg-[length:16px_16px] dark:bg-zinc-800/40 cursor-pointer flex items-center justify-center p-3"
                            onClick={() => { setPreview(g); setShowCode(false); }}>
                            <img src={uri} alt={g.prompt || ""} loading="lazy" className="max-w-full max-h-full object-contain" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="absolute top-2 right-2 flex gap-1">
                                <button onClick={e => { e.stopPropagation(); downloadSvg(g); }} title="下载 SVG"
                                  className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 backdrop-blur-sm transition-colors">
                                  <Download className="w-3 h-3 text-white" />
                                </button>
                                <button onClick={e => { e.stopPropagation(); setDeleteTarget(g); }}
                                  className="p-1.5 rounded-lg bg-white/15 hover:bg-red-500/80 backdrop-blur-sm transition-colors">
                                  <Trash2 className="w-3 h-3 text-white" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="px-2.5 py-2 space-y-1">
                            <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{g.prompt || "无提示词"}</p>
                            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
                              {g.user_email && <span className="truncate font-mono flex-1">{g.user_email}</span>}
                              <span className="shrink-0 tabular-nums">{fmtDate(g.created_at)}</span>
                            </div>
                          </div>
                        </>
                      ) : isFailed ? (
                        <div className="aspect-square flex items-center justify-center bg-red-50 dark:bg-red-500/5">
                          <div className="text-center p-4">
                            <X className="w-6 h-6 text-red-400 mx-auto mb-2" />
                            <p className="text-[10px] text-red-500 font-medium">生成失败</p>
                            {g.error_msg && <p className="text-[9px] text-red-400 mt-0.5 line-clamp-2">{g.error_msg}</p>}
                            <button onClick={() => setDeleteTarget(g)} className="mt-2 text-[9px] text-red-400 hover:text-red-600">删除</button>
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-square flex items-center justify-center bg-muted">
                          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
                {loading && gens.length > 0 && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
                {!hasMore && gens.length > 0 && <span className="text-[10px] text-muted-foreground">已加载全部 {total} 条</span>}
              </div>
            </>
          )}
        </div>
      </main>
      {/* PLACEHOLDER_DIALOGS */}
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="删除矢量图" description="确定要删除此 SVG 记录？此操作不可撤销。"
        confirmLabel="删除" variant="destructive" onConfirm={confirmDelete}
      />

      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-2xl max-h-[90vh] p-0 overflow-hidden">
          {preview && (
            <div className="flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <span className="text-xs font-medium truncate mr-2">{preview.prompt || "矢量图"}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => setShowCode(s => !s)}>
                    <Code2 className="w-3 h-3" /> {showCode ? "看图" : "看代码"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => downloadSvg(preview)}>
                    <Download className="w-3 h-3" /> 下载
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-[conic-gradient(at_50%_50%,#f8f8f8_25%,#efefef_0_50%,#f8f8f8_0_75%,#efefef_0)] bg-[length:20px_20px] dark:bg-zinc-900">
                {showCode ? (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-foreground bg-card rounded-lg p-3 border">{preview.image_b64 || ""}</pre>
                ) : (
                  <img src={svgToDataUri(preview.image_b64 || "")} alt="" className="w-full h-auto max-h-[60vh] object-contain" />
                )}
              </div>
              <div className="px-4 py-2 border-t text-[10px] text-muted-foreground flex items-center gap-3 shrink-0">
                {preview.user_email && <span className="font-mono truncate">{preview.user_email}</span>}
                <span className="tabular-nums ml-auto">{fmtDate(preview.created_at)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}