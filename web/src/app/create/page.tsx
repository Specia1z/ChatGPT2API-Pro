"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { useRouter } from "next/navigation";
import * as LucideIcons from "lucide-react";
const {
  ImageIcon, Loader2, Wand2, X, Download, Trash2,
  CheckCircle, AlertCircle, Clock, Filter, Share2,
  Square, Monitor, Smartphone, Camera,
  Zap, Palette, Sparkles, Maximize2,
} = LucideIcons;
import { useAuth } from "@/lib/auth";
import { api, BASE } from "@/lib/api";
import { compressImage, compressOptionsFromSettings } from "@/lib/imageCompress";
import { Navbar } from "@/components/navbar";
import { imageProxyUrl, formatShort } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { IconTip } from "@/components/ui/icon-tip";
import { toast } from "sonner";
import { SIZE_GROUPS, FILTER_TABS, stagger, fadeUp } from "./lib/constants";
import { resolveIcon, refImageSrc, sizeLabel, sizeTitle, autoDim, shareState, type StylePreset } from "./lib/helpers";
import { useGenerations } from "./lib/useGenerations";
import { PreviewDialog } from "./components/PreviewDialog";
import { GalleryGrid } from "./components/GalleryGrid";

// 与 /user、/admin/stats 对齐的字体（Outfit 标题 + DM_Mono 数字）
const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const monoFont = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export default function CreatePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tags, setTags] = useState<string[]>([""]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({}); // 提示词文本 → 份数（默认 1）
  const [currentInput, setCurrentInput] = useState("");
  const inputRef2 = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewGen, setPreviewGen] = useState<any>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refDim, setRefDim] = useState<{ w: number; h: number } | null>(null); // 首张参考图真实尺寸（Auto 用）
  const [fusionMode, setFusionMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [size, setSize] = useState("1:1");
  const [sizeGroup, setSizeGroup] = useState(0); // 当前展开的尺寸分组索引
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [hsFilter, setHsFilter] = useState<"all" | "completed" | "failed" | "pending">("all");
  // AI 润色：只作用于「当前正在输入的这句」(currentInput)，不碰已添加的 tag——
  // tag 是用户已确定的独立提示词，批量场景下不应被擅自改写。润色后填回输入框，用户确认再回车成 tag。
  const doPolish = async () => {
    const src = currentInput.trim();
    if (!src || polishing) return;
    setPolishing(true);
    try {
      const styleLabel = activeStyle ? (styles.find(s => s.id === activeStyle)?.label || "") : "";
      const r = await api("/api/user/prompt/polish", { method: "POST", body: JSON.stringify({ prompt: src, style: styleLabel }) });
      const polished = r.data?.prompt?.trim();
      if (polished) {
        setCurrentInput(polished);
        inputRef2.current?.focus();
        const cost = r.data?.cost || 0;
        toast.success(cost > 0 ? `已优化（消耗 ${cost} 令牌）` : "已优化");
      } else {
        toast.error("优化失败，请重试");
      }
    } catch (e: any) {
      toast.error(e.message || "优化失败");
    } finally {
      setPolishing(false);
    }
  };

  // 图生文（反推提示词）：取第一张参考图，用 AI 反推出中文提示词，填回输入框。
  const doDescribe = async () => {
    const img = refImages[0];
    if (!img || describing) return;
    // refImages 已是裸 base64（上传时压缩处理）；兼容 dataURL/代理路径
    const b64 = img.startsWith("data:") ? (img.split(",")[1] || "") : img;
    if (!b64 || b64.startsWith("/api/") || b64.startsWith("http")) {
      toast.error("请先上传一张图片");
      return;
    }
    setDescribing(true);
    try {
      const r = await api("/api/user/image-to-text", { method: "POST", body: JSON.stringify({ image_b64: b64 }) });
      const prompt = r.data?.prompt?.trim();
      if (prompt) {
        setCurrentInput(prompt);
        inputRef2.current?.focus();
        const cost = r.data?.cost || 0;
        toast.success(cost > 0 ? `已反推提示词（消耗 ${cost} 令牌）` : "已反推提示词");
      } else {
        toast.error("反推失败，请重试");
      }
    } catch (e: any) {
      toast.error(e.message || "反推失败");
    } finally {
      setDescribing(false);
    }
  };

  // 一键智能增强（两步法）：先让 AI 看图诊断不足、生成针对性重构提示词，再据此图生图出增强版。
  const doEnhance = async () => {
    const img = refImages[0];
    if (!img || loading || enhancing) return;
    const b64 = img.startsWith("data:") ? (img.split(",")[1] || "") : img;
    if (!b64 || b64.startsWith("/api/") || b64.startsWith("http")) {
      toast.error("请先上传一张图片");
      return;
    }
    setEnhancing(true);
    try {
      // 第一步：AI 看图诊断 → 针对性重构提示词
      const diag = await api<any>("/api/user/image-enhance", { method: "POST", body: JSON.stringify({ image_b64: b64 }) });
      const enhancePrompt = diag.data?.prompt?.trim();
      if (!enhancePrompt) { toast.error("智能诊断失败，请重试"); setEnhancing(false); return; }
      // 第二步：拿诊断结果 + 原图走图生图
      setLoading(true);
      const ids = await submitOne(enhancePrompt, [b64]);
      if (ids.length === 0) { toast.error("增强提交失败"); setLoading(false); setEnhancing(false); return; }
      setHsFilter("all");
      toast.success("AI 已分析并提交智能增强，生成中…");
      pollUpdate().catch(() => {});
      const poll = setInterval(async () => {
        try {
          const gens = await pollUpdate();
          if (ids.every(id => { const f = gens.find((g: any) => g.id === id); return f && f.status !== "pending"; })) {
            clearInterval(poll); setLoading(false);
          }
        } catch { clearInterval(poll); setLoading(false); }
      }, 3000);
    } catch (e: any) {
      toast.error(e.message || "增强失败");
      setLoading(false);
    } finally {
      setEnhancing(false);
    }
  };

  const addTag = () => {
    const v = currentInput.trim();
    if (!v) return;
    const existing = tags.filter(Boolean);
    // 重复提示词：合并为份数 +1（避免重复标签与按文本索引的份数表错乱）
    if (existing.includes(v)) {
      setTagCount(v, getTagCount(v) + 1);
      toast.message(`「${v.slice(0, 12)}…」份数 +1`);
    } else {
      setTags([...existing, v]);
    }
    setCurrentInput('');
    setTimeout(() => inputRef2.current?.focus(), 0);
  };
  const removeTag = (idx: number) => {
    setTags(prev => {
      const removed = prev.filter(Boolean)[idx];
      if (removed) setTagCounts(c => { const n = { ...c }; delete n[removed]; return n; });
      const n = prev.filter((_, i) => i !== idx);
      return n.length === 0 ? [''] : n;
    });
  };
  const editTag = (idx: number) => {
    const t = tags[idx];
    if (!t) return;
    setCurrentInput(t);
    removeTag(idx);
  };
  // 调整某个提示词的份数（1–10）
  const setTagCount = (tag: string, n: number) => {
    const v = Math.max(1, Math.min(10, n));
    setTagCounts(c => ({ ...c, [tag]: v }));
  };
  const getTagCount = (tag: string) => tagCounts[tag] || 1;

  // 画廊数据（加载/轮询/分页/无限滚动/列分配）由 useGenerations 统一管理
  const {
    generations, setGenerations, total, loadingMore, revealedIds, setRevealedIds, cols,
    seenRef, sentinelRef, galleryRef, colAssignRef,
    markRevealed, loadInitial, pollUpdate, computeBuckets, hasMore,
  } = useGenerations();

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [settings, setSettings] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const proxyUrl = mounted && generations.length > 0 ? imageProxyUrl(generations[0]) : "(not mounted)";

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => {
      if (d.data) { setSettings(d.data); document.title = d.data.site_title || "ChatGPT2API Pro"; }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch(`${BASE}/api/user/tokens`, { headers: { Authorization: `Bearer ${localStorage.getItem("auth-token") || ""}` } })
      .then(r => r.json()).then(d => { if (d.data?.tokens !== undefined) setBucketTokens(d.data.tokens); }).catch(() => {});
  }, [user]);

  const [bucketTokens, setBucketTokens] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }
    inputRef.current?.focus();
    loadInitial();
  }, [user, authLoading]);

  // 从 API 加载风格预设（唯一真相源；空数组即「无风格」，尊重管理员配置）
  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then(r => r.json())
      .then(d => {
        const raw = d.data?.style_presets;
        if (!raw) return;
        try {
          const list = JSON.parse(raw)
            .filter((s: any) => s.enabled !== false)
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
            .map((s: any) => ({ id: s.id, label: s.label, desc: s.desc, hint: s.hint, icon: resolveIcon(s.icon) }));
          setStyles(list);
        } catch {}
      })
      .catch(() => {});
  }, []);

  // 参考图清空时：重置首图尺寸；若当前选了 Auto 则回退 1:1（Auto 仅在有参考图时有意义）
  useEffect(() => {
    if (refImages.length === 0) {
      setRefDim(null);
      setSize(s => (s === "auto" ? "1:1" : s));
    }
  }, [refImages.length]);

  /* ── Generate ── */

  // 提交单个生图请求；遇 429（令牌/并发不足）指数退避重试，其余错误直接抛出。
  const submitOne = async (prompt: string, refB64: string[], signal?: { canceled: boolean }): Promise<number[]> => {
    const maxRetry = 6;
    let delay = 1500;
    for (let attempt = 0; ; attempt++) {
      if (signal?.canceled) return [];
      try {
        // Auto：存复合值 "auto:宽x高"（展示层显示 Auto，后端按像素引导原图比例）；无尺寸则回退 1:1
        const effSize = size === "auto" ? (refDim ? `auto:${refDim.w}x${refDim.h}` : "1:1") : size;
        const body: any = { prompt, model: "gpt-image-2", size: effSize, count: 1 };
        if (refB64.length > 0) body.ref_images_b64 = refB64;
        const res = await api<any>("/api/generations", { method: "POST", body: JSON.stringify(body) });
        return res.data.ids || [res.data.id];
      } catch (e: any) {
        // 429 = 令牌不足/并发已满，退避后重试；超过上限或非 429 则放弃
        if (e?.status === 429 && attempt < maxRetry) {
          await new Promise(r => setTimeout(r, delay));
          delay = Math.min(delay * 1.6, 8000);
          continue;
        }
        throw e;
      }
    }
  };

  const generate = async () => {
    // 把当前未提交的输入也并入提示词列表
    const pending = currentInput.trim();
    const lines = [...tags.filter(Boolean), ...(pending ? [pending] : [])];
    if (lines.length === 0 || loading) return;
    setLoading(true);

    // ref_images_b64 只接受裸 base64，过滤掉误入的 URL / 代理路径 / dataURL 前缀
    const refB64 = refImages
      .map(img => img.startsWith("data:") ? img.split(",")[1] || "" : img)
      .filter(img => img && !img.startsWith("/api/") && !img.startsWith("http"));

    // 展开任务：每个提示词按份数生成 N 个独立请求
    // 选中风格时，把其 hint 统一追加到每条 prompt（批量里每条都生效，且不污染输入框文本）
    const styleHint = activeStyle ? (styles.find(s => s.id === activeStyle)?.hint || "").trim() : "";
    const tasks: string[] = [];
    for (const p of lines) {
      const n = getTagCount(p);
      const withStyle = styleHint ? `${p}, ${styleHint}` : p;
      const actualPrompt = !fusionMode && refB64.length > 0 ? "根据参考图，" + withStyle : withStyle;
      for (let i = 0; i < n; i++) tasks.push(actualPrompt);
    }

    // 提交并发精确匹配用户套餐的生图并发（后台动态配置，过期/免费回退为 1）。
    // 这样"前端发多少、后端就能接多少"，几乎不触发 CheckCapacity 的 429，体感最连贯；
    // 全局并发满或令牌不足等边界情况，仍由 submitOne 的 429 退避兜底。
    const planConcurrency = Math.max(1, (user as any)?.plan_concurrency || 1);
    const concurrency = Math.max(1, Math.min(planConcurrency, tasks.length));
    setBatchProgress({ done: 0, total: tasks.length });

    const allIds: number[] = [];
    let cursor = 0;
    let failed = 0;
    // 简单并发池：同时最多 concurrency 个 in-flight，完成一个补一个
    const worker = async () => {
      while (cursor < tasks.length) {
        const my = cursor++;
        try {
          const ids = await submitOne(tasks[my], refB64);
          allIds.push(...ids);
        } catch (e: any) {
          failed++;
          toast.error(`${tasks[my].slice(0, 16)}… ${e?.message || "提交失败"}`);
        }
        setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      setBatchProgress(null);
    }

    setCurrentInput(""); setTags([""]); setTagCounts({});
    setHsFilter("all");
    if (allIds.length === 0) { setLoading(false); return; }
    if (failed > 0) toast.message(`${allIds.length} 个已提交，${failed} 个失败`);

    pollUpdate().catch(() => {});
    const poll = setInterval(async () => {
      try {
        const gens = await pollUpdate();
        if (allIds.every(id => { const f = gens.find((g: any) => g.id === id); return f && f.status !== "pending"; })) {
          clearInterval(poll); setLoading(false);
        }
      } catch { clearInterval(poll); setLoading(false); }
    }, 3000);
  };

  /* ── Actions ── */

  const downloadImg = (src: string, i: number) => {
    const a = document.createElement("a");
    a.download = `gen-${i}.png`;
    if (src.startsWith("data:")) {
      a.href = src; a.click();
    } else {
      fetch(src).then(r => r.blob()).then(blob => {
        a.href = URL.createObjectURL(blob); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }).catch(() => {});
    }
  };

  const deleteGen = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await api("/api/generations", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => {});
    colAssignRef.current.delete(id);
    setGenerations(prev => prev.filter(g => g.id !== id));
  };

  const clearFailed = async () => {
    const failed = generations.filter(g => g.status === "failed");
    for (const g of failed) {
      await api("/api/generations", { method: "DELETE", body: JSON.stringify({ id: g.id }) }).catch(() => {});
      colAssignRef.current.delete(g.id);
    }
    setGenerations(prev => prev.filter(g => g.status !== "failed"));
  };

  const editGen = async (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    setCurrentInput(g.prompt); setTags([""]); setTagCounts({}); setActiveStyle(null);

    // Auto 复合值（auto:宽x高）：size 留待参考图载入后再设为 "auto"（否则会被空参考图的回退逻辑打回 1:1）
    const dim = autoDim(g.size || "");
    setSize(dim ? "1:1" : (g.size || "1:1"));
    setFusionMode(false);
    inputRef.current?.focus();
    // 将已有作品作为参考图：必须取回真实图片数据转成裸 base64，
    // 不能直接把代理 URL (/api/images/{id}) 塞进 ref_images_b64，否则后端按 base64 解码会报错
    try {
      const res = await fetch(imageProxyUrl(g), { headers: { Authorization: `Bearer ${localStorage.getItem("auth-token") || ""}` } });
      const blob = await res.blob();
      const b64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (b64) {
        setRefImages([b64]);
        // 参考图就位后再恢复 Auto，并直接用复合值里的真实像素填 refDim
        if (dim) { setRefDim(dim); setSize("auto"); }
      }
    } catch {
      toast.error("载入参考图失败");
    }
  };

  const retryGen = (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    setCurrentInput(g.prompt); setTags([""]); setTagCounts({}); setActiveStyle(null);
    api("/api/generations", { method: "DELETE", body: JSON.stringify({ id: g.id }) }).then(() => {
      colAssignRef.current.delete(g.id);
      setGenerations(prev => prev.filter(x => x.id !== g.id));
    }).catch(() => {});
  };

  const toggleShare = async (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    // 先审后发：pending/approved 视为"已分享"，再点为撤回；none/rejected 为"未分享"，点击提交审核
    const ss = g.share_status || (g.shared ? "approved" : "none");
    const isActive = ss === "pending" || ss === "approved";
    const turnOn = !isActive;
    try {
      await api("/api/generations/share", { method: "POST", body: JSON.stringify({ id: g.id, shared: turnOn }) });
      const nextStatus = turnOn ? "pending" : "none";
      setGenerations(prev => prev.map(x => x.id === g.id ? { ...x, share_status: nextStatus, shared: turnOn ? x.shared : false } : x));
      toast.success(turnOn ? "已提交审核，通过后将展示到广场" : "已取消分享");
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  /* ── Derived ── */

  const filtered = hsFilter === "all" ? generations : generations.filter(g => {
    if (hsFilter === "completed") return g.status === "completed";
    if (hsFilter === "failed") return g.status === "failed";
    if (hsFilter === "pending") return g.status === "pending";
    return true;
  });

  // 稳定列分配（瀑布流横向轮转分列）由 hook 提供
  const buckets = computeBuckets(filtered);

  const counts = {
    all: generations.length,
    completed: generations.filter(g => g.status === "completed").length,
    pending: generations.filter(g => g.status === "pending").length,
    failed: generations.filter(g => g.status === "failed").length,
  };

  const lineCount = tags.filter(Boolean).length;
  // 总张数 = 各提示词份数之和（含尚未提交的当前输入，按 1 份计）
  const totalImages = tags.filter(Boolean).reduce((sum, t) => sum + getTagCount(t), 0) + (currentInput.trim() ? 1 : 0);

  if (!user) return null;

  return (
    <TooltipProvider>
      <div className={`${heading.variable} ${monoFont.variable} min-h-screen bg-background pb-16 md:pb-0`}>
        <Navbar />

        {/* 桌面端左右分栏；移动/平板(<lg)回落为上下单列 */}
        <div className="lg:flex lg:items-start lg:gap-6 max-w-[1600px] mx-auto lg:px-6 lg:pt-6">

        {/* ═══════════════ LEFT — Prompt Studio（桌面 sticky 固定栏） ═══════════════ */}
        <div className="border-b lg:border-0 bg-card lg:w-[400px] lg:shrink-0 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto scrollbar-thin lg:rounded-2xl lg:ring-1 lg:ring-foreground/10 lg:shadow-sm">
          <div className="px-4 sm:px-6 py-5 sm:py-6">
            {/* Header row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center shadow-sm" style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1 55%,#e879f9)" }}>
                  <Palette className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className={`${heading.className} text-sm font-semibold tracking-tight text-foreground`}>创作</h1>
                  <p className="text-[11px] text-muted-foreground tracking-wide">
                    {totalImages > 1 ? `${lineCount} 个提示词 · 共 ${totalImages} 张` : "AI 图片生成"}
                  </p>
                </div>
              </div>

              {/* Token + Plan pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-muted text-[10px]">
                <span className="px-1.5 py-px rounded-full bg-background/60 text-muted-foreground font-medium">
                  {(user as any)?.plan_name || "免费版"}
                </span>
                <span className={`${monoFont.className} text-muted-foreground tabular-nums`}>
                  <Zap className="w-2.5 h-2.5 inline -mt-px mr-0.5" />
                  {bucketTokens !== null ? `${Math.round(bucketTokens)}` : "—"}
                </span>
              </div>
            </div>

            {/* Prompt textarea — hero element */}
            <div className="relative">
              <div
                className={`absolute -inset-1 rounded-2xl blur-xl transition-all duration-500 ${loading ? "opacity-70" : "opacity-0 group-focus-within:opacity-40"}`}
                style={{
                  background: "linear-gradient(135deg, #22d3ee, #6366f1 55%, #e879f9) 0% 50% / 200% 100%",
                  animation: loading ? "gradientFlow 3s ease-in-out infinite" : "none",
                  willChange: "transform",
                  transform: "translateZ(0)",
                }} />
              <div className="group relative rounded-2xl border border-border bg-card
                transition-all duration-300 focus-within:border-transparent focus-within:shadow-lg focus-within:ring-2 focus-within:ring-primary/30">
                <div className="px-3.5 py-3.5 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {tags.filter(Boolean).map((tag, i) => (
                      <span key={i}
                        className="group inline-flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-lg bg-muted
                          text-xs sm:text-[11px] text-foreground max-w-full">
                        <IconTip label="点击修改"><span onClick={() => editTag(i)} className="truncate max-w-[200px] sm:max-w-xs cursor-pointer">{tag}</span></IconTip>
                        {/* 份数控制：×N，可增减（1–10） */}
                        <span className="inline-flex items-center gap-0.5 ml-0.5 px-1 rounded-md bg-background/60 shrink-0">
                          <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) - 1); }}
                            className="size-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={getTagCount(tag) <= 1}>
                            <svg className="size-2" viewBox="0 0 10 2" fill="none"><path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                          <span className={`${monoFont.className} text-[10px] tabular-nums w-3 text-center text-muted-foreground`}>{getTagCount(tag)}</span>
                          <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) + 1); }}
                            className="size-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={getTagCount(tag) >= 10}>
                            <svg className="size-2" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                        </span>
                        <button onClick={e => { e.stopPropagation(); removeTag(i); }}
                          className="size-3.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 transition-colors">
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
                      if (e.key === "Backspace" && !currentInput && tags.filter(Boolean).length > 0) {
                        removeTag(tags.filter(Boolean).length - 1);
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); }
                    }}
                    placeholder={tags.filter(Boolean).length > 0 ? "继续添加提示词…" : "描述你想要的画面，Enter 添加…"}
                    className="w-full bg-transparent text-base sm:text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
                  />
                  {/* 工具行：AI 优化 */}
                  <div className="flex items-center justify-end pt-1">
                    <IconTip label="把输入框里这句话用 AI 扩写成专业提示词">
                    <button onClick={doPolish}
                      disabled={polishing || !currentInput.trim()}
                      className="group/p inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {polishing ? "优化中…" : "AI 优化"}
                    </button>
                    </IconTip>
                  </div>
                </div>
              </div>
            </div>

            {/* 示例提示：放在卡片外，避免点击误触输入框 */}
            {tags.filter(Boolean).length === 0 && !currentInput && (
              <p className="mt-2 px-1 text-[11px] text-muted-foreground/60 leading-relaxed">
                试试：<span className="text-cyan-600/70 dark:text-cyan-400/70">夕阳下的海边小屋，水彩风格</span>
              </p>
            )}

            {/* ── 风格预设：全部平铺，纵向不藏 ── */}
            {styles.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`${heading.className} text-[11px] font-semibold text-foreground tracking-wide`}>风格</span>
                  {activeStyle && (
                    <button onClick={() => setActiveStyle(null)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">清除</button>
                  )}
                </div>
                <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-wrap gap-1.5">
                  {styles.map(s => {
                    const Icon = typeof s.icon === "string" ? resolveIcon(s.icon) : s.icon;
                    const active = activeStyle === s.id;
                    return (
                      <button key={s.id} onClick={() => { setActiveStyle(active ? null : s.id); inputRef2.current?.focus(); }}
                        aria-pressed={active}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                          active
                            ? "bg-foreground text-primary-foreground shadow-sm"
                            : "text-muted-foreground bg-muted/60 hover:text-foreground hover:bg-muted"
                        }`}>
                        <Icon className="w-3 h-3 shrink-0" />
                        <span className="whitespace-nowrap">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
                {activeStyle && (
                  <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-relaxed">
                    {styles.find(s => s.id === activeStyle)?.desc} · 生成时自动追加风格提示词
                  </p>
                )}
              </div>
            )}

            {/* ── 比例尺寸：分组 chip + 展开该组预设 ── */}
            <div className="mt-4">
              <span className={`${heading.className} text-[11px] font-semibold text-foreground tracking-wide block mb-2`}>比例 / 用途</span>
              {/* 分组切换 chip */}
              <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 gap-1.5 mb-2">
                {SIZE_GROUPS.map((g, gi) => {
                  const GIcon = g.icon;
                  const on = sizeGroup === gi;
                  return (
                    <button key={g.group} onClick={() => setSizeGroup(gi)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                        on ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground bg-muted/40 hover:text-foreground hover:bg-muted"
                      }`}>
                      <GIcon className="w-3 h-3 shrink-0" />
                      <span className="whitespace-nowrap">{g.group}</span>
                    </button>
                  );
                })}
              </div>
              {/* 当前组的预设 */}
              <div className="flex flex-nowrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-wrap gap-1.5">
                {/* Auto：仅有参考图时 */}
                {refImages.length > 0 && (
                  <IconTip label={refDim ? `跟随参考图 ${refDim.w}×${refDim.h}` : "跟随参考图比例"}>
                  <button onClick={() => setSize("auto")}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 touch-manipulation ${
                      size === "auto" ? "bg-foreground text-primary-foreground shadow-sm" : "text-muted-foreground bg-muted/60 hover:text-foreground hover:bg-muted"
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
                        active ? "bg-foreground text-primary-foreground shadow-sm" : "text-muted-foreground bg-muted/60 hover:text-foreground hover:bg-muted"
                      }`}>
                      <Icon className="w-3 h-3 shrink-0" />
                      <span className="whitespace-nowrap">{s.label}</span>
                      <span className={`${monoFont.className} text-[9px] tabular-nums ${active ? "text-primary-foreground/60" : "text-muted-foreground/50"}`}>{s.ratio}</span>
                    </button>
                    </IconTip>
                  );
                })}
              </div>
            </div>

            {/* ── 参考图 / 图生图 ── */}
            <div className="mt-4">
              <span className={`${heading.className} text-[11px] font-semibold text-foreground tracking-wide block mb-2`}>参考图（图生图）</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => fileRef.current?.click()}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation ${
                    refImages.length > 0 ? "bg-foreground text-primary-foreground" : "text-muted-foreground bg-muted/60 hover:text-foreground hover:bg-muted"
                  }`}>
                  <ImageIcon className="w-3 h-3" />
                  {refImages.length > 0 ? `已选 ${refImages.length} 张` : "上传图片"}
                </button>
                {/* 融图开关：开启后允许上传多张图融合 */}
                <IconTip label={fusionMode ? "融图已开启：可上传多张图片融合生成" : "开启后可上传多张图片融合"}>
                <button onClick={() => {
                    const next = !fusionMode;
                    setFusionMode(next);
                    // 关闭融图时若已有多张，只保留第一张
                    if (!next) setRefImages(prev => prev.slice(0, 1));
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation ${
                    fusionMode ? "bg-foreground text-primary-foreground" : "text-muted-foreground bg-muted/60 hover:text-foreground hover:bg-muted"
                  }`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${fusionMode ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                  融图{fusionMode ? "已开" : ""}
                </button>
                </IconTip>
                {fusionMode && refImages.length > 1 && (
                  <span className="text-[10px] text-muted-foreground font-medium px-1.5 py-0.5 rounded-md bg-muted">融合 {refImages.length} 张</span>
                )}
              </div>
              {refImages.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {refImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={refImageSrc(img)} className="w-12 h-12 rounded-lg object-cover ring-1 ring-border"
                        onLoad={idx === 0 ? (e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setRefDim({ w: im.naturalWidth, h: im.naturalHeight }); } : undefined} />
                      <button onClick={() => setRefImages(refImages.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-foreground text-primary-foreground flex items-center justify-center text-[8px] shadow-sm">×</button>
                    </div>
                  ))}
                  {/* 反推提示词 / 一键增强：仅单图参考时显示（融图模式下针对单图的操作无意义） */}
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
              {/* 一键增强注意提醒：仅单图参考时显示 */}
              {!fusionMode && refImages.length > 0 && (
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
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
                    // HEIC/HEIF 先转 JPEG（浏览器原生无法解码 HEIC）
                    if (/\.heic$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif") {
                      try {
                        const { default: heic2any } = await import("heic2any");
                        const blob = await heic2any({ blob: file, toType: "image/jpeg" });
                        imgFile = new File([blob as Blob], file.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" });
                      } catch { toast.error("HEIC 转换失败"); continue; }
                    }
                    // 浏览器内压缩 + 降采样（上游只用 ~1.5MP，对画质无损）
                    try {
                      origBytes += imgFile.size;
                      const { b64 } = await compressImage(imgFile, opts);
                      savedBytes += Math.round((b64.length * 3) / 4); // base64 → 原字节估算
                      results.push(b64);
                    } catch {
                      // 压缩失败兜底：原图直传
                      const raw = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve((reader.result as string).split(",")[1] || (reader.result as string));
                        reader.onerror = reject;
                        reader.readAsDataURL(imgFile);
                      });
                      results.push(raw);
                    }
                  }
                  // 融图模式：追加多张；单图模式：只保留最新一张（替换）
                  setRefImages(prev => fusionMode ? [...prev, ...results] : results.slice(-1));
                  e.target.value = "";
                  // 压缩生效时给个轻提示（仅当确实显著减小）
                  if (origBytes > 0 && savedBytes > 0 && savedBytes < origBytes * 0.8) {
                    const pct = Math.round((1 - savedBytes / origBytes) * 100);
                    toast.success(`已优化上传体积 -${pct}%`);
                  }
                }} />
            </div>

            {/* ── 生成按钮：整行大 CTA（生成中渐变流动） ── */}
            <button onClick={generate} disabled={loading || !currentInput.trim() && tags.filter(Boolean).length === 0}
              className="group/btn relative w-full mt-5 inline-flex items-center justify-center h-11 rounded-xl text-sm font-semibold text-white overflow-hidden disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md transition-all gap-2"
              style={{
                background: "linear-gradient(135deg,#22d3ee,#6366f1 40%,#e879f9 70%,#22d3ee) 0% 50% / 250% 100%",
                animation: loading ? "gradientFlow 2.5s ease-in-out infinite" : "none",
              }}>
              <span className="absolute inset-0 bg-white/0 group-hover/btn:bg-white/10 transition-colors" />
              {/* 生成中：底部流动进度光条 */}
              {loading && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/40 overflow-hidden">
                  <span className="block h-full w-1/3 bg-white/90 animate-[shimmer_1.6s_ease-in-out_infinite]" style={{ backgroundSize: "200% 100%" }} />
                </span>
              )}
              {loading ? <Loader2 className="relative w-4 h-4 animate-spin" /> : <Sparkles className="relative w-4 h-4" />}
              <span className="relative">
                {loading
                  ? (batchProgress ? `提交中 ${batchProgress.done}/${batchProgress.total}` : "生成中…")
                  : (totalImages > 1 ? `生成 ${totalImages} 张` : "生成")}
              </span>
            </button>

            {/* Hint */}
            <p className="mt-2.5 text-[11px] text-muted-foreground/70 tracking-wide leading-relaxed">
              Ctrl+⏎ 发送 · Enter 添加提示词 · 点击标签可修改 · ± 调整份数
            </p>
          </div>
        </div>

        {/* ═══════════════ RIGHT — GALLERY ═══════════════ */}
        <GalleryGrid
          buckets={buckets}
          filtered={filtered}
          generations={generations}
          total={total}
          revealedIds={revealedIds}
          setRevealedIds={setRevealedIds}
          mounted={mounted}
          hsFilter={hsFilter}
          setHsFilter={setHsFilter}
          counts={counts}
          clearFailed={clearFailed}
          hasMore={hasMore}
          loadingMore={loadingMore}
          galleryRef={galleryRef}
          sentinelRef={sentinelRef}
          setPreviewGen={setPreviewGen}
          toggleShare={toggleShare}
          editGen={editGen}
          downloadImg={downloadImg}
          setDeleteTarget={setDeleteTarget}
          retryGen={retryGen}
        />

        {/* 关闭左右分栏容器 */}
        </div>

        {/* ═══ Delete Confirm ═══ */}
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="删除作品"
          description="确认删除这张图片？此操作不可撤销。"
          confirmLabel="删除"
          variant="destructive"
          onConfirm={async () => {
            if (deleteTarget === null) return;
            await api("/api/generations", { method: "DELETE", body: JSON.stringify({ id: deleteTarget }) }).catch(() => {});
            colAssignRef.current.delete(deleteTarget);
            setGenerations((prev) => prev.filter((g) => g.id !== deleteTarget));
            setDeleteTarget(null);
            setPreviewGen(null);
          }}
        />

        {/* ═══ Preview Dialog ═══ */}
        <PreviewDialog
          previewGen={previewGen}
          setPreviewGen={setPreviewGen}
          toggleShare={toggleShare}
          editGen={editGen}
          downloadImg={downloadImg}
          setDeleteTarget={setDeleteTarget}
        />
      </div>
    </TooltipProvider>
  );
}
