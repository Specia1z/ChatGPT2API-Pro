"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ImageIcon, X, Download, Sparkles, Palette } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { BASE } from "@/lib/api";
import { imageProxyUrl } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type GalleryItem = {
  id: number;
  user_id: number;
  prompt: string;
  model: string;
  size: string;
  image_b64: string;
  image_url?: string;
  user_email: string;
  user_name: string;
  shared: boolean;
  created_at: string;
};

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<any>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchGallery = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await fetch(
        `${BASE}/api/gallery?page=${p}&page_size=20`
      ).then((r) => r.json());
      const newItems = r.data?.items || [];
      setTotal(r.data?.total || 0);
      if (append) {
        setItems((prev) => [...prev, ...newItems]);
      } else {
        setItems(newItems);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => {
      if (d.data) { setSettings(d.data); document.title = d.data.site_title || "ChatGPT2API Pro"; }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchGallery(1, false);
  }, [fetchGallery]);

  /* Infinite scroll */
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && items.length < total && !loading) {
          const next = page + 1;
          setPage(next);
          fetchGallery(next, true);
        }
      },
      { threshold: 0.1 }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [page, items.length, total, loading, fetchGallery]);

  const download = (src: string) => {
    const a = document.createElement("a");
    a.download = "gallery-image.png";
    if (src.startsWith("data:")) {
      a.href = src; a.click();
    } else {
      fetch(src).then(r => r.blob()).then(blob => {
        a.href = URL.createObjectURL(blob); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }).catch(() => {});
    }
  };

  if (loading && items.length === 0) return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-16 md:pb-0">
      <Navbar />

      {/* Hero — editorial header with diamond */}
      <div className="border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex items-center gap-3 mb-5">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">✦</span>
            </div>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-4 tracking-wide">
              <Sparkles className="w-3 h-3" />
              灵感广场
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3">
              {settings?.site_title || "探索社区创作"}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              浏览其他创作者分享的作品，获取灵感
              {total > 0 && (
                <span className="ml-2 text-zinc-400">
                  · 共 <span className="font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums">{total}</span> 张
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-zinc-400">
            <div className="relative w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4 overflow-hidden">
              <Palette className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
              <div className="absolute inset-0 rounded-2xl border border-zinc-200 dark:border-zinc-700" />
            </div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">暂无分享作品</p>
            <p className="text-xs text-zinc-400 mt-1">去创作中心生成图片并分享到这里</p>
          </div>
        ) : (
          <>
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
              {items.map((item, i) => {
                return (
                  <div
                    key={item.id}
                    className="group relative break-inside-avoid rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 hover:shadow-xl dark:hover:shadow-zinc-900/50 transition-all duration-300 cursor-pointer"
                    style={{ animation: `galleryCardIn 0.5s ease-out ${Math.min(i, 8) * 50}ms both` }}
                    onClick={() => setPreview(item)}
                  >
                    {/* Top accent bar — 中性，hover 加深 */}
                    <div className="h-[2px] w-full bg-zinc-200 dark:bg-zinc-800 transition-colors group-hover:bg-zinc-900 dark:group-hover:bg-zinc-100" />

                    {/* Image */}
                    <div className="relative">
                      <img
                        src={imageProxyUrl(item)}
                        alt={item.prompt}
                        loading="lazy"
                        onLoad={() => setLoadedImages((prev) => new Set(prev).add(item.id))}
                        className={`w-full h-auto transition-opacity duration-500 ${
                          loadedImages.has(item.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {!loadedImages.has(item.id) && (
                        <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 animate-pulse flex items-center justify-center">
                          <ImageIcon className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3 space-y-2">
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {item.prompt}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                            {(item.user_name || item.user_email || "?")[0]?.toUpperCase()}
                          </div>
                          <span className="text-[11px] text-zinc-500 truncate">
                            {item.user_name || item.user_email?.split("@")[0] || "匿名"}
                          </span>
                        </div>
                        {item.size && (
                          <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 shrink-0">
                            {item.size}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sentinel */}
            <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-6">
              {loading && <div className="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />}
              {items.length >= total && total > 0 && (
                <span className="text-[10px] text-zinc-400">已加载全部 {total} 张作品</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Preview Dialog — full-screen darkroom */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="!max-w-full !max-h-full w-screen h-screen p-0 bg-zinc-950/98 border-0 rounded-none" showCloseButton={false}>
          {preview && (() => {
            return (
            <div className="relative w-full h-full flex flex-col overflow-hidden">
              {/* Close — 适配刘海安全区 */}
              <button onClick={() => setPreview(null)}
                className="absolute right-4 z-20 p-2.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md transition-colors shadow-lg ring-1 ring-white/10"
                style={{ top: "max(1rem, env(safe-area-inset-top))" }}>
                <X className="w-5 h-5 text-white" />
              </button>

              {/* Image */}
              <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-3 pt-14 sm:p-4 sm:pt-14">
                <img src={imageProxyUrl(preview)} alt={preview.prompt}
                  className="max-w-full max-h-full object-contain rounded-xl sm:rounded-2xl shadow-2xl" />
              </div>

              {/* Bottom glass bar */}
              <div className="shrink-0 px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 flex justify-center">
                <div className="w-full max-w-2xl rounded-2xl bg-white/10 backdrop-blur-xl border border-white/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-2xl">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white bg-white/15">
                        <span className="text-[11px] font-bold">
                          {(preview.user_name || preview.user_email || "?")[0]?.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-white/90 truncate">
                        {preview.user_name || preview.user_email?.split("@")[0] || "匿名"}
                      </span>
                      <span className="text-[10px] text-white/40 shrink-0">{preview.created_at?.slice(0, 16)}</span>
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed line-clamp-2">{preview.prompt}</p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      {preview.size && (
                        <Badge className="text-[9px] h-5 px-1.5 bg-white/10 text-white/80 border-0">{preview.size}</Badge>
                      )}
                      <Badge className="text-[9px] h-5 px-1.5 border-0 text-white/80 bg-white/10">
                        {preview.model}
                      </Badge>
                    </div>
                    <button onClick={() => download(imageProxyUrl(preview))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium transition-colors">
                      <Download className="w-3.5 h-3.5" /> 下载
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @keyframes galleryCardIn {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
