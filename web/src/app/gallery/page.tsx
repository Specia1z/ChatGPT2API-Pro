"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ImageIcon, X, Download, Sparkles, Palette, Copy, Check } from "lucide-react";
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

// size 展示：Auto 出图存为复合值 "auto:宽x高"，角标只显「Auto」（真实像素由旁边的 dimensions 角标负责）。
const sizeLabel = (size: string): string => (size.startsWith("auto:") ? "Auto" : size);

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [dimensions, setDimensions] = useState<Record<number, string>>({}); // id → "宽×高"（真实像素）
  const [copied, setCopied] = useState(false);
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

  const copyPrompt = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  // 图片加载完成：记录真实像素分辨率（naturalWidth/Height），用于常驻显示
  const onImgLoad = (id: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    setLoadedImages(prev => new Set(prev).add(id));
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setDimensions(prev => prev[id] ? prev : { ...prev, [id]: `${img.naturalWidth}×${img.naturalHeight}` });
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
            <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-[0_6px_20px_-6px_rgba(99,102,241,0.6)]">
              <span className="text-lg font-bold text-white">✦</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-zinc-300 to-transparent dark:from-zinc-700" />
          </div>
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] px-3 py-1 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 mb-4 tracking-[0.12em] uppercase">
              <Sparkles className="w-3 h-3" />
              灵感广场
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-[family-name:var(--font-display)]">
              {settings?.site_title || "探索社区创作"}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              浏览其他创作者分享的作品，获取灵感
              {total > 0 && (
                <span className="ml-2 text-zinc-400">
                  · 共 <span className="font-semibold text-cyan-600 dark:text-cyan-400 tabular-nums">{total}</span> 张
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
                    onClick={() => { setCopied(false); setPreview(item); }}
                  >
                    {/* Top accent bar — hover 变光谱渐变 */}
                    <div className="h-[2px] w-full bg-zinc-200 dark:bg-zinc-800 transition-all group-hover:bg-gradient-to-r group-hover:from-cyan-400 group-hover:via-violet-500 group-hover:to-fuchsia-500" />

                    {/* Image */}
                    <div className="relative">
                      <img
                        src={imageProxyUrl(item)}
                        alt={item.prompt}
                        loading="lazy"
                        onLoad={(e) => onImgLoad(item.id, e)}
                        className={`w-full h-auto transition-opacity duration-500 ${
                          loadedImages.has(item.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {!loadedImages.has(item.id) && (
                        <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 animate-pulse flex items-center justify-center">
                          <ImageIcon className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
                        </div>
                      )}
                      {/* 常驻信息标签：比例 + 真实分辨率（移动端常驻，桌面 hover 浮现） */}
                      {loadedImages.has(item.id) && (item.size || dimensions[item.id]) && (
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                          {item.size && (
                            <span className="text-[9px] font-mono font-medium text-white/95 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm">
                              {sizeLabel(item.size)}
                            </span>
                          )}
                          {dimensions[item.id] && (
                            <span className="text-[9px] font-mono font-medium text-white/95 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm">
                              {dimensions[item.id]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3 space-y-2">
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {item.prompt}
                      </p>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0 bg-gradient-to-br from-cyan-400 to-violet-500 text-white">
                          {(item.user_name || item.user_email || "?")[0]?.toUpperCase()}
                        </div>
                        <span className="text-[11px] text-zinc-500 truncate">
                          {item.user_name || item.user_email?.split("@")[0] || "匿名"}
                        </span>
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

      {/* Preview Dialog — 桌面左图右信息，移动端上下堆叠 */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="!max-w-full !max-h-full w-screen h-screen p-0 bg-zinc-950/98 border-0 rounded-none" showCloseButton={false}>
          {preview && (
            <div className="relative w-full h-full flex flex-col lg:flex-row overflow-hidden">
              {/* Close — 适配刘海安全区 */}
              <button onClick={() => setPreview(null)}
                className="absolute right-4 z-30 p-2.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md transition-colors shadow-lg ring-1 ring-white/10"
                style={{ top: "max(1rem, env(safe-area-inset-top))" }}>
                <X className="w-5 h-5 text-white" />
              </button>

              {/* Image 区 */}
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex items-center justify-center p-3 pt-14 lg:p-6">
                <img src={imageProxyUrl(preview)} alt={preview.prompt}
                  onLoad={(e) => onImgLoad(preview.id, e)}
                  className="max-w-full max-h-full object-contain rounded-xl lg:rounded-2xl shadow-2xl" />
              </div>

              {/* 信息面板：桌面右侧定宽纵列，移动端底部 */}
              <div className="shrink-0 lg:w-[360px] lg:h-full lg:border-l border-white/10 bg-white/[0.04] lg:bg-white/[0.03] backdrop-blur-xl flex flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4 lg:p-6 gap-4 max-h-[45vh] lg:max-h-none">
                {/* 作者 + 时间 */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white bg-gradient-to-br from-cyan-400 to-violet-500">
                    <span className="text-xs font-bold">
                      {(preview.user_name || preview.user_email || "?")[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white/90 truncate">
                      {preview.user_name || preview.user_email?.split("@")[0] || "匿名"}
                    </div>
                    <div className="text-[10px] text-white/40">{preview.created_at?.slice(0, 16)}</div>
                  </div>
                </div>

                {/* 元数据 chips：比例 / 分辨率 / 模型 */}
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {preview.size && (
                    <Badge className="text-[10px] h-5 px-2 bg-white/10 text-white/80 border-0 font-mono">{sizeLabel(preview.size)}</Badge>
                  )}
                  {dimensions[preview.id] && (
                    <Badge className="text-[10px] h-5 px-2 bg-white/10 text-white/80 border-0 font-mono">{dimensions[preview.id]}</Badge>
                  )}
                  <Badge className="text-[10px] h-5 px-2 bg-white/10 text-white/80 border-0">{preview.model}</Badge>
                </div>

                {/* 完整提示词：可滚动 + 一键复制 */}
                <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between shrink-0">
                    <span className="text-[11px] font-medium text-white/50 tracking-wide">提示词</span>
                    <button onClick={() => copyPrompt(preview.prompt)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 text-[11px] font-medium transition-colors">
                      {copied ? <><Check className="w-3 h-3 text-emerald-400" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-lg bg-black/20 p-3">
                    <p className="text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap break-words">{preview.prompt}</p>
                  </div>
                </div>

                {/* 下载 */}
                <button onClick={() => download(imageProxyUrl(preview))}
                  className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-white text-sm font-medium transition-all bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 hover:shadow-[0_8px_24px_-6px_rgba(34,211,238,0.6)]">
                  <Download className="w-4 h-4" /> 下载原图
                </button>
              </div>
            </div>
          )}
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
