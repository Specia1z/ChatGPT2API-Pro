"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api, BASE } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { imageProxyUrl } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { autoDim, resolveIcon, type StylePreset } from "./lib/helpers";
import { useGenerations } from "./lib/useGenerations";
import { PreviewDialog } from "./components/PreviewDialog";
import { GalleryGrid } from "./components/GalleryGrid";
import { PromptStudio } from "./components/PromptStudio";

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
  // 异常图片：status=completed 但浏览器 <img> 加载失败（URL 失效/对象被清/裂图）。
  // 服务端认为成功，只有前端渲染时才暴露，故由 GalleryGrid 的 onError 上报收集到此。
  const [brokenIds, setBrokenIds] = useState<Set<number>>(new Set());
  const [clearBrokenOpen, setClearBrokenOpen] = useState(false);
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

  // 标记一张图为「加载异常」（GalleryGrid 的 <img onError> 调用）。
  // 只收 completed 项——pending 还没出图、failed 本就有专门的「清除失败」。
  const markBroken = (id: number) => {
    setBrokenIds(prev => prev.has(id) ? prev : new Set(prev).add(id));
  };

  // 图片重新加载成功时撤销异常标记（处理瞬时网络失败后恢复的情况，避免误删）。
  const unmarkBroken = (id: number) => {
    setBrokenIds(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
  };

  // 批量清除异常图片：删 brokenIds 里仍存在的记录（复用单删接口循环）。
  const clearBroken = async () => {
    const ids = generations.filter(g => brokenIds.has(g.id)).map(g => g.id);
    for (const id of ids) {
      await api("/api/generations", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => {});
      colAssignRef.current.delete(id);
    }
    setGenerations(prev => prev.filter(g => !brokenIds.has(g.id)));
    setBrokenIds(new Set());
    setClearBrokenOpen(false);
    if (ids.length) toast.success(`已清除 ${ids.length} 张异常图片`);
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

  // 当前列表里仍存在的异常图片数（brokenIds 可能含已被删除的旧 id，需与现有列表取交集）
  const brokenCount = generations.reduce((n, g) => n + (brokenIds.has(g.id) ? 1 : 0), 0);

  const lineCount = tags.filter(Boolean).length;
  // 总张数 = 各提示词份数之和（含尚未提交的当前输入，按 1 份计）
  const totalImages = tags.filter(Boolean).reduce((sum, t) => sum + getTagCount(t), 0) + (currentInput.trim() ? 1 : 0);

  if (!user) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#fbfbfd] dark:bg-[#06070d] pb-16 md:pb-0">
        <Navbar />

        {/* 桌面端左右分栏；移动/平板(<lg)回落为上下单列 */}
        <div className="lg:flex lg:items-start lg:gap-6 max-w-[1600px] mx-auto lg:px-6 lg:pt-6">

        {/* ═══════════════ LEFT — Prompt Studio ═══════════════ */}
        <PromptStudio
          user={user} bucketTokens={bucketTokens}
          tags={tags} currentInput={currentInput} setCurrentInput={setCurrentInput} inputRef2={inputRef2}
          addTag={addTag} removeTag={removeTag} editTag={editTag} setTagCount={setTagCount} getTagCount={getTagCount}
          lineCount={lineCount} totalImages={totalImages}
          polishing={polishing} describing={describing} enhancing={enhancing}
          doPolish={doPolish} doDescribe={doDescribe} doEnhance={doEnhance}
          styles={styles} activeStyle={activeStyle} setActiveStyle={setActiveStyle}
          size={size} setSize={setSize} sizeGroup={sizeGroup} setSizeGroup={setSizeGroup}
          refImages={refImages} setRefImages={setRefImages} refDim={refDim} setRefDim={setRefDim}
          fusionMode={fusionMode} setFusionMode={setFusionMode} fileRef={fileRef} settings={settings}
          loading={loading} batchProgress={batchProgress} generate={generate}
        />

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
          brokenIds={brokenIds}
          brokenCount={brokenCount}
          markBroken={markBroken}
          unmarkBroken={unmarkBroken}
          onClearBroken={() => setClearBrokenOpen(true)}
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

        {/* ═══ Clear Broken Confirm ═══ */}
        <ConfirmDialog
          open={clearBrokenOpen}
          onOpenChange={setClearBrokenOpen}
          title="清除异常图片"
          description={`检测到 ${brokenCount} 张无法正常显示的图片（裂图 / 加载失败 / 已失效），确认全部删除？此操作不可撤销。`}
          confirmLabel="全部清除"
          variant="destructive"
          onConfirm={clearBroken}
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
