"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Trash2, Palette, Clock, Share2, Image as ImageIcon, Download, AlertCircle } from "lucide-react";
import { imageProxyUrl, formatShort } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { IconTip } from "@/components/ui/icon-tip";
import { FILTER_TABS } from "../lib/constants";
import { sizeLabel, sizeTitle, shareState } from "../lib/helpers";

type Counts = { all: number; completed: number; failed: number; pending: number };

type Props = {
  buckets: any[][];
  filtered: any[];
  generations: any[];
  total: number;
  revealedIds: Set<string>;
  setRevealedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  mounted: boolean;
  hsFilter: "all" | "completed" | "failed" | "pending";
  setHsFilter: (k: "all" | "completed" | "failed" | "pending") => void;
  counts: Counts;
  clearFailed: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  galleryRef: (node: HTMLDivElement | null) => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  setPreviewGen: (g: any) => void;
  toggleShare: (e: React.MouseEvent, g: any) => void;
  editGen: (e: React.MouseEvent, g: any) => void;
  downloadImg: (src: string, i: number) => void;
  setDeleteTarget: (id: number) => void;
  retryGen: (e: React.MouseEvent, g: any) => void;
};

// 右栏作品画廊：筛选标签 + 瀑布流（卡片三态：完成/生成中/失败）+ 无限滚动。
export function GalleryGrid(p: Props) {
  const {
    buckets, filtered, generations, total, revealedIds, setRevealedIds, mounted,
    hsFilter, setHsFilter, counts, clearFailed, hasMore, loadingMore,
    galleryRef, sentinelRef, setPreviewGen, toggleShare, editGen, downloadImg, setDeleteTarget, retryGen,
  } = p;

  return (
    <div className="flex-1 min-w-0 px-4 sm:px-6 py-6 lg:px-0 lg:py-0 lg:pb-6">
      {/* Gallery header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white tracking-tight">作品</h2>
          <span className="text-[10px] text-zinc-400 dark:text-white/40 tabular-nums">{total || generations.length}</span>
        </div>
        {generations.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-nowrap max-w-full -mx-2 sm:mx-0 px-2 sm:px-0">
            <div className="flex items-center gap-1 p-0.5 rounded-xl bg-zinc-900/[0.04] dark:bg-white/[0.06] shrink-0">
              {FILTER_TABS.map(tab => (
                <button key={tab.key} onClick={() => setHsFilter(tab.key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                    hsFilter === tab.key
                      ? "bg-white dark:bg-white/10 text-zinc-900 dark:text-white shadow-sm"
                      : "text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white"
                  }`}>
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                  <span className="text-[10px] tabular-nums opacity-60">{counts[tab.key]}</span>
                </button>
              ))}
            </div>
            {counts.failed > 0 && (
              <button onClick={clearFailed}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                <Trash2 className="w-3 h-3" /> 清除失败
              </button>
            )}
          </div>
        )}
      </div>
      {/* Empty state */}
      {filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="flex flex-col items-center py-24 text-zinc-400 dark:text-white/40">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900/[0.04] dark:bg-white/[0.06] flex items-center justify-center mb-4 ring-1 ring-zinc-900/[0.05] dark:ring-white/10">
            <Palette className="w-7 h-7 text-zinc-400/60 dark:text-white/30" />
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-white/55">
            {hsFilter !== "all" ? "无匹配记录" : "开始创作"}
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-white/35 mt-1">
            {hsFilter !== "all" ? "切换筛选标签查看其他记录" : "输入提示词，Enter 添加多个"}
          </p>
        </motion.div>
      ) : (
        /* Masonry — JS 横向轮转分列：外层 flex，每列 flex-col，视觉顺序左→右 */
        <div ref={galleryRef} className="flex gap-2 sm:gap-3 items-start">
          {buckets.map((col, ci) => (
            <div key={ci} className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-3">
              <AnimatePresence>
              {col.map((g) => {
                const isRev = revealedIds.has(String(g.id));
                return (
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.25 } }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    style={{ willChange: "transform" }}
                    className="group relative rounded-2xl overflow-hidden bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl ring-1 ring-zinc-900/[0.06] dark:ring-white/10 cursor-pointer transition-all duration-300 hover:ring-zinc-900/15 dark:hover:ring-white/20 hover:shadow-lg hover:-translate-y-0.5"
                    onClick={() => { if (imageProxyUrl(g)) setPreviewGen(g); }}
                  >
                {(g.image_url || (g.image_b64 && g.image_b64.length > 100)) ? (
                  <>
                    {mounted ? (
                      <img src={imageProxyUrl(g)} alt={g.prompt} className="w-full h-auto"
                        onLoad={() => setRevealedIds(prev => { if (prev.has(String(g.id))) return prev; return new Set(prev).add(String(g.id)); })} />
                    ) : (
                      <div className="w-full aspect-square bg-zinc-100 dark:bg-white/5" />
                    )}
                    {/* Loading shimmer — 显影效果 */}
                    {!isRev && (
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-0 bg-zinc-100 dark:bg-white/5" />
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-900/10 dark:via-white/10 to-transparent animate-[shimmer_2.5s_ease-in-out_infinite]"
                          style={{ backgroundSize: "200% 100%" }} />
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-200 dark:bg-white/10 overflow-hidden">
                          <div className="h-full bg-zinc-900 dark:bg-white rounded-full animate-[developProgress_3s_ease-out_forwards]" />
                        </div>
                      </div>
                    )}
                    {/* 扫光渐出遮罩 */}
                    <div className={`absolute inset-0 bg-zinc-100 dark:bg-white/5 transition-opacity duration-700 pointer-events-none ${isRev ? "opacity-0" : "opacity-100"}`} />
                    {/* 分享状态角标 — 仅移动端常驻 */}
                    {isRev && shareState(g).active && (
                      <span className={`sm:hidden absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full shadow-sm pointer-events-none ${shareState(g).key === "pending" ? "bg-amber-500/90" : "bg-emerald-500/90"}`}>
                        {shareState(g).key === "pending"
                          ? <Clock className="w-2.5 h-2.5 text-white" />
                          : <Share2 className="w-2.5 h-2.5 text-white" />}
                      </span>
                    )}
                    {/* Hover overlay — 仅桌面端 */}
                    <div className="hidden sm:block absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-auto">
                        <p className="text-[11px] text-white/90 line-clamp-2 mb-2 leading-relaxed">{g.prompt}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {g.size && (sizeTitle(g.size)
                              ? <IconTip label={sizeTitle(g.size)}><span className="text-[10px] px-1 py-0.5 rounded bg-white/15 text-white/70 font-mono">{sizeLabel(g.size)}</span></IconTip>
                              : <span className="text-[10px] px-1 py-0.5 rounded bg-white/15 text-white/70 font-mono">{sizeLabel(g.size)}</span>)}
                            <span className="text-[10px] text-white/40">{formatShort(g.created_at)}</span>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <Tooltip>
                              <TooltipTrigger render={
                                <button onClick={e => toggleShare(e, g)}
                                  className="p-1 rounded-lg transition-colors"
                                  style={{ backgroundColor: shareState(g).key === "pending" ? "rgba(245,158,11,0.5)" : shareState(g).key === "approved" ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.15)" }}>
                                  {shareState(g).key === "pending"
                                    ? <Clock className="w-3 h-3 text-white" />
                                    : <Share2 className="w-3 h-3 text-white" />}
                                </button>
                              } />
                              <TooltipContent>{shareState(g).key === "pending" ? "审核中（点击撤回）" : shareState(g).key === "approved" ? "已展示（点击撤回）" : shareState(g).key === "rejected" ? "未通过审核（点击重新提交）" : "分享到广场"}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={
                                <button onClick={e => editGen(e, g)}
                                  className="p-1 rounded-lg bg-white/15 hover:bg-white/30 transition-colors">
                                  <ImageIcon className="w-3 h-3 text-white" />
                                </button>
                              } />
                              <TooltipContent>作为参考图编辑</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={
                                <button onClick={e => { e.stopPropagation(); downloadImg(imageProxyUrl(g), g.id); }}
                                  className="p-1 rounded-lg bg-white/15 hover:bg-white/30 transition-colors">
                                  <Download className="w-3 h-3 text-white" />
                                </button>
                              } />
                              <TooltipContent>下载</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={
                                <button onClick={e => { e.stopPropagation(); setDeleteTarget(g.id); }}
                                  className="p-1 rounded-lg bg-white/15 hover:bg-red-500/50 transition-colors">
                                  <Trash2 className="w-3 h-3 text-white" />
                                </button>
                              } />
                              <TooltipContent>删除</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : g.status === "pending" ? (
                  <div className="relative flex flex-col items-center justify-center gap-4 py-12 sm:py-16 bg-zinc-100/50 dark:bg-white/5 overflow-hidden">
                    {/* 柔光呼吸底（中性） */}
                    <div aria-hidden className="absolute left-1/2 top-1/2 w-32 h-32 rounded-full blur-3xl bg-[radial-gradient(circle,rgba(0,0,0,0.06),transparent_70%)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_70%)]"
                      style={{ animation: "aiGlowBreathe 2.8s ease-in-out infinite" }} />
                    {/* 旋转光环 + 中心点（中性黑白） */}
                    <div className="relative w-11 h-11">
                      <div aria-hidden className="absolute inset-0 rounded-full border-2 border-zinc-900/10 dark:border-white/10 border-t-zinc-900 dark:border-t-white"
                        style={{ animation: "aiPrismSpin 1s linear infinite" }} />
                      <div aria-hidden className="absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-zinc-900 dark:bg-white"
                        style={{ animation: "aiDotPulse 1.6s ease-in-out infinite" }} />
                    </div>
                    {/* 文案 + 思考三点 */}
                    <div className="relative flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-zinc-500 dark:text-white/55 font-medium tracking-wide">AI 创作中</span>
                        <span className="flex items-center gap-0.5">
                          {[0, 1, 2].map(i => (
                            <span key={i} className="w-1 h-1 rounded-full bg-zinc-400 dark:bg-white/50"
                              style={{ animation: `aiThinkDot 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                          ))}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400 dark:text-white/40">约 10-30 秒</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 sm:py-16 bg-zinc-100/50 dark:bg-white/5">
                    <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-zinc-500 dark:text-white/55 font-medium block">生成失败</span>
                      <span className="text-[10px] text-zinc-400 dark:text-white/40 mt-0.5 block">{g.error_msg || g.prompt?.slice(0, 30)}</span>
                    </div>
                    <button onClick={e => retryGen(e, g)}
                      className="px-3 py-1 rounded-lg text-[10px] font-medium bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white transition-colors">
                      重试
                    </button>
                  </div>
                )}
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {/* 无限滚动哨兵 + 底部状态 */}
      {filtered.length > 0 && (
        <div ref={sentinelRef} className="flex items-center justify-center py-8">
          {loadingMore ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-white/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载中...
            </div>
          ) : hasMore ? (
            <span className="text-[11px] text-zinc-400 dark:text-white/35">下滑加载更多</span>
          ) : (
            <span className="text-[11px] text-zinc-400 dark:text-white/35">没有更多了</span>
          )}
        </div>
      )}
    </div>
  );
}
