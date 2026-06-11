"use client";

import { Loader2, Wand2, Image as ImageIcon, Zap, Palette, Sparkles, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage, compressOptionsFromSettings } from "@/lib/imageCompress";
import { IconTip } from "@/components/ui/icon-tip";
import { SIZE_GROUPS } from "../lib/constants";
import { resolveIcon, refImageSrc, type StylePreset } from "../lib/helpers";

type Props = {
  user: any;
  bucketTokens: number | null;
  // 提示词 / 标签
  tags: string[];
  currentInput: string;
  setCurrentInput: (v: string) => void;
  inputRef2: React.RefObject<HTMLInputElement | null>;
  addTag: () => void;
  removeTag: (idx: number) => void;
  editTag: (idx: number) => void;
  setTagCount: (tag: string, n: number) => void;
  getTagCount: (tag: string) => number;
  lineCount: number;
  totalImages: number;
  // AI 辅助
  polishing: boolean;
  describing: boolean;
  enhancing: boolean;
  doPolish: () => void;
  doDescribe: () => void;
  doEnhance: () => void;
  // 风格
  styles: StylePreset[];
  activeStyle: string | null;
  setActiveStyle: (id: string | null) => void;
  // 尺寸
  size: string;
  setSize: React.Dispatch<React.SetStateAction<string>>;
  sizeGroup: number;
  setSizeGroup: (i: number) => void;
  // 参考图
  refImages: string[];
  setRefImages: React.Dispatch<React.SetStateAction<string[]>>;
  refDim: { w: number; h: number } | null;
  setRefDim: (d: { w: number; h: number } | null) => void;
  fusionMode: boolean;
  setFusionMode: (v: boolean) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  settings: any;
  // 生成
  loading: boolean;
  batchProgress: { done: number; total: number } | null;
  generate: () => void;
};

// 左栏控制台：提示词输入 + AI 优化 + 风格 + 比例 + 参考图（图生图/融图/反推/增强）+ 生成。
export function PromptStudio(p: Props) {
  const {
    user, bucketTokens, tags, currentInput, setCurrentInput, inputRef2,
    addTag, removeTag, editTag, setTagCount, getTagCount, lineCount, totalImages,
    polishing, describing, enhancing, doPolish, doDescribe, doEnhance,
    styles, activeStyle, setActiveStyle, size, setSize, sizeGroup, setSizeGroup,
    refImages, setRefImages, refDim, setRefDim, fusionMode, setFusionMode, fileRef, settings,
    loading, batchProgress, generate,
  } = p;

  return (
    <div className="lg:w-[400px] lg:shrink-0 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto scrollbar-thin border-b lg:border-0 lg:rounded-2xl lg:ring-1 lg:ring-zinc-900/[0.08] dark:lg:ring-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl lg:shadow-sm">
      <div className="px-4 sm:px-6 py-5 sm:py-6">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-zinc-900 dark:bg-white">
              <Palette className="w-4 h-4 text-white dark:text-zinc-900" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">创作</h1>
              <p className="text-[11px] text-zinc-500 dark:text-white/50 tracking-wide">
                {totalImages > 1 ? `${lineCount} 个提示词 · 共 ${totalImages} 张` : "AI 图片生成"}
              </p>
            </div>
          </div>
          {/* Token + Plan pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.08] text-[10px]">
            <span className="px-1.5 py-px rounded-full bg-white/70 dark:bg-white/10 text-zinc-500 dark:text-white/55 font-medium">
              {(user as any)?.plan_name || "免费版"}
            </span>
            <span className="text-zinc-500 dark:text-white/55 tabular-nums">
              <Zap className="w-2.5 h-2.5 inline -mt-px mr-0.5" />
              {bucketTokens !== null ? `${Math.round(bucketTokens)}` : "—"}
            </span>
          </div>
        </div>

        {/* Prompt input — hero element */}
        <div className="relative">
          <div
            className={`absolute -inset-1 rounded-2xl blur-xl transition-all duration-500 bg-zinc-900/10 dark:bg-white/10 ${loading ? "opacity-100 animate-pulse" : "opacity-0 group-focus-within:opacity-100"}`}
            style={{ willChange: "transform", transform: "translateZ(0)" }} />
          <div className="group relative rounded-2xl border border-zinc-900/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] transition-all duration-300 focus-within:border-transparent focus-within:shadow-lg focus-within:ring-2 focus-within:ring-zinc-900/20 dark:focus-within:ring-white/20">
            <div className="px-3.5 py-3.5 space-y-2">
              <div className="flex flex-wrap gap-2">
                {tags.filter(Boolean).map((tag, i) => (
                  <span key={i} className="group inline-flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-lg bg-zinc-900/[0.05] dark:bg-white/[0.08] text-xs sm:text-[11px] text-zinc-900 dark:text-white max-w-full">
                    <IconTip label="点击修改"><span onClick={() => editTag(i)} className="truncate max-w-[200px] sm:max-w-xs cursor-pointer">{tag}</span></IconTip>
                    <span className="inline-flex items-center gap-0.5 ml-0.5 px-1 rounded-md bg-white/70 dark:bg-white/10 shrink-0">
                      <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) - 1); }}
                        className="size-3.5 flex items-center justify-center text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30" disabled={getTagCount(tag) <= 1}>
                        <svg className="size-2" viewBox="0 0 10 2" fill="none"><path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                      <span className="text-[10px] tabular-nums w-3 text-center text-zinc-500 dark:text-white/55">{getTagCount(tag)}</span>
                      <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) + 1); }}
                        className="size-3.5 flex items-center justify-center text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30" disabled={getTagCount(tag) >= 10}>
                        <svg className="size-2" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </span>
                    <button onClick={e => { e.stopPropagation(); removeTag(i); }}
                      className="size-3.5 rounded-full flex items-center justify-center text-zinc-500 dark:text-white/55 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/[0.08] shrink-0 transition-colors">
                      <svg className="size-2.5" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </span>
                ))}
              </div>
              <input ref={inputRef2}
                value={currentInput}
                onChange={e => setCurrentInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); addTag(); }
                  if (e.key === "Backspace" && !currentInput && tags.filter(Boolean).length > 0) removeTag(tags.filter(Boolean).length - 1);
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); }
                }}
                placeholder={tags.filter(Boolean).length > 0 ? "继续添加提示词…" : "描述你想要的画面，Enter 添加…"}
                className="w-full bg-transparent text-base sm:text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-white/30 outline-none"
              />
              <div className="flex items-center justify-end pt-1">
                <IconTip label="把输入框里这句话用 AI 扩写成专业提示词">
                <button onClick={doPolish} disabled={polishing || !currentInput.trim()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {polishing ? "优化中…" : "AI 优化"}
                </button>
                </IconTip>
              </div>
            </div>
          </div>
        </div>

        {/* 示例提示 */}
        {tags.filter(Boolean).length === 0 && !currentInput && (
          <p className="mt-2 px-1 text-[11px] text-zinc-400 dark:text-white/40 leading-relaxed">
            试试：<span className="text-cyan-600/70 dark:text-cyan-400/70">夕阳下的海边小屋，水彩风格</span>
          </p>
        )}

        {/* ── 风格预设 ── */}
        {styles.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-zinc-900 dark:text-white tracking-wide">风格</span>
              {activeStyle && (
                <button onClick={() => setActiveStyle(null)} className="text-[10px] text-zinc-500 dark:text-white/50 hover:text-zinc-900 dark:hover:text-white transition-colors">清除</button>
              )}
            </div>
            <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-wrap gap-1.5">
              {styles.map(s => {
                const Icon = typeof s.icon === "string" ? resolveIcon(s.icon) : s.icon;
                const active = activeStyle === s.id;
                return (
                  <button key={s.id} onClick={() => { setActiveStyle(active ? null : s.id); inputRef2.current?.focus(); }} aria-pressed={active}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                      active ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.04] dark:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1]"
                    }`}>
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="whitespace-nowrap">{s.label}</span>
                  </button>
                );
              })}
            </div>
            {activeStyle && (
              <p className="text-[10px] text-zinc-400 dark:text-white/40 mt-1.5 leading-relaxed">
                {styles.find(s => s.id === activeStyle)?.desc} · 生成时自动追加风格提示词
              </p>
            )}
          </div>
        )}

        {/* ── 比例尺寸 ── */}
        <div className="mt-4">
          <span className="text-[11px] font-semibold text-zinc-900 dark:text-white tracking-wide block mb-2">比例 / 用途</span>
          <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 gap-1.5 mb-2">
            {SIZE_GROUPS.map((g, gi) => {
              const GIcon = g.icon;
              const on = sizeGroup === gi;
              return (
                <button key={g.group} onClick={() => setSizeGroup(gi)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                    on ? "bg-zinc-900/10 dark:bg-white/15 text-zinc-900 dark:text-white ring-1 ring-zinc-900/15 dark:ring-white/20" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.03] dark:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.06] dark:hover:bg-white/[0.08]"
                  }`}>
                  <GIcon className="w-3 h-3 shrink-0" />
                  <span className="whitespace-nowrap">{g.group}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-wrap gap-1.5">
            {refImages.length > 0 && (
              <IconTip label={refDim ? `跟随参考图 ${refDim.w}×${refDim.h}` : "跟随参考图比例"}>
              <button onClick={() => setSize("auto")}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                  size === "auto" ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.04] dark:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1]"
                }`}>
                <Maximize2 className="w-3 h-3" /><span>Auto</span>
              </button>
              </IconTip>
            )}
            {SIZE_GROUPS[sizeGroup].items.map(s => {
              const Icon = s.icon;
              const active = size === s.id;
              return (
                <IconTip key={`${s.label}-${s.id}`} label={`${s.desc} · ${s.ratio}`}>
                <button onClick={() => setSize(s.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                    active ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.04] dark:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1]"
                  }`}>
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="whitespace-nowrap">{s.label}</span>
                  <span className={`text-[9px] tabular-nums ${active ? "text-white/60 dark:text-zinc-900/60" : "text-zinc-400/60 dark:text-white/40"}`}>{s.ratio}</span>
                </button>
                </IconTip>
              );
            })}
          </div>
        </div>

        {/* ── 参考图 / 图生图 ── */}
        <div className="mt-4">
          <span className="text-[11px] font-semibold text-zinc-900 dark:text-white tracking-wide block mb-2">参考图（图生图）</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation ${
                refImages.length > 0 ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.04] dark:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1]"
              }`}>
              <ImageIcon className="w-3 h-3" />
              {refImages.length > 0 ? `已选 ${refImages.length} 张` : "上传图片"}
            </button>
            <IconTip label={fusionMode ? "融图已开启：可上传多张图片融合生成" : "开启后可上传多张图片融合"}>
            <button onClick={() => { const next = !fusionMode; setFusionMode(next); if (!next) setRefImages(prev => prev.slice(0, 1)); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation ${
                fusionMode ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "text-zinc-500 dark:text-white/55 bg-zinc-900/[0.04] dark:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1]"
              }`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${fusionMode ? "bg-emerald-400" : "bg-zinc-400/40 dark:bg-white/30"}`} />
              融图{fusionMode ? "已开" : ""}
            </button>
            </IconTip>
            {fusionMode && refImages.length > 1 && (
              <span className="text-[10px] text-zinc-500 dark:text-white/55 font-medium px-1.5 py-0.5 rounded-md bg-zinc-900/[0.05] dark:bg-white/[0.08]">融合 {refImages.length} 张</span>
            )}
          </div>
          {refImages.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {refImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img src={refImageSrc(img)} className="w-12 h-12 rounded-lg object-cover ring-1 ring-zinc-900/[0.08] dark:ring-white/10"
                    onLoad={idx === 0 ? (e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setRefDim({ w: im.naturalWidth, h: im.naturalHeight }); } : undefined} />
                  <button onClick={() => setRefImages(refImages.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center text-[8px] shadow-sm">×</button>
                </div>
              ))}
              {!fusionMode && (
                <>
                  <IconTip label="让 AI 看懂这张图，反推出可直接用于生图的中文提示词并填入输入框">
                  <button onClick={doDescribe} disabled={describing}
                    className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {describing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {describing ? "反推中…" : "反推提示词"}
                  </button>
                  </IconTip>
                  <IconTip label="AI 智能分析这张图的不足并重新创作出更精美的版本（会自行优化构图/光影/背景/氛围）">
                  <button onClick={doEnhance} disabled={enhancing || loading}
                    className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {enhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    {enhancing ? "增强中…" : "一键增强"}
                  </button>
                  </IconTip>
                </>
              )}
            </div>
          )}
          {!fusionMode && refImages.length > 0 && (
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-400 dark:text-white/40">
              「一键增强」由 AI 重新创作，会自行发挥优化构图、光影、背景与氛围，<span className="text-amber-600/80 dark:text-amber-400/80">结果会与原图有差异、并非像素级保留</span>，主体与主题会尽量保持。多生成几次可挑选满意的。
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/*,image/heic,image/heif" multiple={fusionMode} className="hidden"
            onChange={async e => {
              const files = e.target?.files;
              if (!files || files.length === 0) return;
              const opts = compressOptionsFromSettings(settings);
              const results: string[] = [];
              let savedBytes = 0, origBytes = 0;
              for (const file of Array.from(files)) {
                let imgFile = file;
                if (/\.heic$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif") {
                  try {
                    const { default: heic2any } = await import("heic2any");
                    const blob = await heic2any({ blob: file, toType: "image/jpeg" });
                    imgFile = new File([blob as Blob], file.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" });
                  } catch { toast.error("HEIC 转换失败"); continue; }
                }
                try {
                  origBytes += imgFile.size;
                  const { b64 } = await compressImage(imgFile, opts);
                  savedBytes += Math.round((b64.length * 3) / 4);
                  results.push(b64);
                } catch {
                  const raw = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(",")[1] || (reader.result as string));
                    reader.onerror = reject;
                    reader.readAsDataURL(imgFile);
                  });
                  results.push(raw);
                }
              }
              setRefImages(prev => fusionMode ? [...prev, ...results] : results.slice(-1));
              e.target.value = "";
              if (origBytes > 0 && savedBytes > 0 && savedBytes < origBytes * 0.8) {
                const pct = Math.round((1 - savedBytes / origBytes) * 100);
                toast.success(`已优化上传体积 -${pct}%`);
              }
            }} />
        </div>

        {/* ── 生成按钮 ── */}
        <button onClick={generate} disabled={loading || !currentInput.trim() && tags.filter(Boolean).length === 0}
          className={`group/btn relative w-full mt-5 inline-flex items-center justify-center h-11 rounded-full text-sm font-semibold overflow-hidden transition-all gap-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 ${loading || (!currentInput.trim() && tags.filter(Boolean).length === 0) ? "opacity-40 cursor-not-allowed" : "hover:-translate-y-0.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] dark:shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] hover:shadow-[0_16px_50px_-10px_rgba(0,0,0,0.6)]"}`}>
          {/* 生成中：底部流动进度光条（中性色） */}
          {loading && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/30 dark:bg-zinc-900/30 overflow-hidden">
              <span className="block h-full w-1/3 bg-white/90 dark:bg-zinc-900/90 animate-[shimmer_1.6s_ease-in-out_infinite]" style={{ backgroundSize: "200% 100%" }} />
            </span>
          )}
          {loading ? <Loader2 className="relative w-4 h-4 animate-spin" /> : <Sparkles className="relative w-4 h-4" />}
          <span className="relative">
            {loading ? (batchProgress ? `提交中 ${batchProgress.done}/${batchProgress.total}` : "生成中…") : (totalImages > 1 ? `生成 ${totalImages} 张` : "生成")}
          </span>
        </button>

        <p className="mt-2.5 text-[11px] text-zinc-400 dark:text-white/40 tracking-wide leading-relaxed">
          Ctrl+⏎ 发送 · Enter 添加提示词 · 点击标签可修改 · ± 调整份数
        </p>
      </div>
    </div>
  );
}
