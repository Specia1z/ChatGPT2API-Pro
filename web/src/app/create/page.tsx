"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  ImageIcon, Loader2, Wand2, X, Download, Trash2,
  CheckCircle, AlertCircle, Clock, Filter, Share2,
  Square, Monitor, Smartphone, Camera, MonitorDown, Tv, FileText,
  Zap, Palette,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api, BASE } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { imageProxyUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";

/* ── Size presets ────────────────────── */

const SIZES = [
  { id: "1:1", label: "1:1", desc: "头像/Logo", icon: Square },
  { id: "4:3", label: "4:3", desc: "横版", icon: Monitor },
  { id: "3:4", label: "3:4", desc: "小红书封面", icon: Smartphone },
  { id: "16:9", label: "16:9", desc: "视频封面", icon: Monitor },
  { id: "9:16", label: "9:16", desc: "手机壁纸", icon: Smartphone },
  { id: "16:10", label: "16:10", desc: "宽屏", icon: Monitor },
  { id: "10:16", label: "10:16", desc: "竖幅海报", icon: Smartphone },
  { id: "21:9", label: "21:9", desc: "超宽电影", icon: Monitor },
  { id: "9:21", label: "9:21", desc: "超长竖屏", icon: Smartphone },
  { id: "2:3", label: "2:3", desc: "电商商品", icon: Camera },
  { id: "3:2", label: "3:2", desc: "标准照片", icon: Camera },
  { id: "4:5", label: "4:5", desc: "人像摄影", icon: Smartphone },
  { id: "5:4", label: "5:4", desc: "经典摄影", icon: Camera },
  { id: "HD", label: "HD", desc: "1280×720", icon: MonitorDown },
  { id: "2K", label: "2K", desc: "高清壁纸", icon: Monitor },
  { id: "4K", label: "4K", desc: "超高清", icon: Tv },
  { id: "A4", label: "A4", desc: "文档打印", icon: FileText },
];

const FILTER_TABS = [
  { key: "all" as const, label: "全部", icon: Filter },
  { key: "completed" as const, label: "已完成", icon: CheckCircle },
  { key: "pending" as const, label: "生成中", icon: Clock },
  { key: "failed" as const, label: "失败", icon: AlertCircle },
];

const ACCENTS = ["#06b6d4", "#f59e0b", "#8b5cf6", "#10b981", "#e11d48", "#3b82f6"];
const accent = (id: number) => ACCENTS[Math.abs(id) % ACCENTS.length];

/* ── Ref image src ────────────────────── */
// 从裸 base64 的 magic 前缀推断 MIME（FileReader 读出的 dataURL 已被剥掉前缀只剩 base64）
const b64Mime = (b64: string): string => {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
};
const refImageSrc = (img: string): string => {
  if (img.startsWith("data:")) return img;
  if (img.startsWith("http://") || img.startsWith("https://")) return img;
  // 仅服务端代理路径才当 URL；注意 JPEG 的 base64 以 "/9j/" 开头，不能用 startsWith("/") 判断
  if (img.startsWith("/api/")) return img;
  return `data:${b64Mime(img)};base64,${img}`;
};

export default function CreatePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generations, setGenerations] = useState<any[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [fusionMode, setFusionMode] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [size, setSize] = useState("1:1");
  const [hsFilter, setHsFilter] = useState<"all" | "completed" | "failed" | "pending">("all");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [settings, setSettings] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  // 分页 / 无限滚动
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false); // 防 observer 抖动重复触发
  // 响应式列数（瀑布流横向轮转分列用）
  const [cols, setCols] = useState(4);
  // 稳定列分配：id→列号，首次分配后固定，避免增删使其它项换列重挂载（导致整体缩放）
  const colAssignRef = useRef<Map<number, number>>(new Map());
  const colAssignColsRef = useRef(0); // 上次分配基于的列数，变化时重置
  const proxyUrl = mounted && generations.length > 0 ? imageProxyUrl(generations[0]) : "(not mounted)";

  useEffect(() => { setMounted(true); }, []);

  // 响应式列数：<768=2, 768–1024=3, ≥1024=4（与原 columns-2/md:3/lg:4 断点一致）
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setCols(w >= 1024 ? 4 : w >= 768 ? 3 : 2);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  // 无限滚动：sentinel 进入视口且还有更多时加载下一页。
  // 依赖 page/total/generations.length 变化时重建 observer，确保闭包捕获最新 loadMore。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && generations.length < total && !loadingMoreRef.current) {
          loadMore();
        }
      },
      { rootMargin: "400px" } // 提前 400px 预加载，滚动更顺滑
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, total, generations.length]);
  

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

  // 标记一批项里「已可显示」的图片为已揭示
  const markRevealed = (items: any[]) => {
    setRevealedIds(prev => {
      let next: Set<string> | null = null;
      for (const g of items) {
        if (g.status === "completed" && (g.image_b64?.length > 100 || g.image_url)) {
          const id = String(g.id);
          if (!prev.has(id)) { (next ||= new Set(prev)).add(id); }
        }
      }
      return next || prev;
    });
  };

  // 首屏 / 重置加载第 1 页（替换列表）
  const loadInitial = async () => {
    try {
      const r = await api<any>(`/api/generations?page=1&page_size=${PAGE_SIZE}`);
      const items = r.data?.items || [];
      setGenerations(items);
      setTotal(r.data?.total ?? items.length);
      setPage(1);
      seenRef.current = new Set(items.map((g: any) => g.id));
      markRevealed(items);
    } catch (e) { console.error("[loadInitial]", e); }
  };

  // 滚动到底加载下一页（按 id 去重后 append）
  const loadMore = async () => {
    if (loadingMoreRef.current) return;
    if (generations.length >= total) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const next = page + 1;
    try {
      const r = await api<any>(`/api/generations?page=${next}&page_size=${PAGE_SIZE}`);
      const items: any[] = r.data?.items || [];
      setTotal(r.data?.total ?? total);
      setGenerations(prev => {
        const have = new Set(prev.map((g: any) => g.id));
        const fresh = items.filter(g => !have.has(g.id));
        return [...prev, ...fresh];
      });
      items.forEach(g => seenRef.current.add(g.id));
      markRevealed(items);
      setPage(next);
    } catch (e) { console.error("[loadMore]", e); }
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  };

  // 生成轮询：拉第 1 页，合并而非覆盖——更新已加载项状态、prepend 新项、刷新 total
  const pollUpdate = async (): Promise<any[]> => {
    const r = await api<any>(`/api/generations?page=1&page_size=${PAGE_SIZE}`);
    const fresh: any[] = r.data?.items || [];
    setTotal(r.data?.total ?? total);
    markRevealed(fresh);
    setGenerations(prev => {
      const freshById = new Map(fresh.map(g => [g.id, g]));
      // 1) 更新已存在项（状态/图片可能变化）
      const merged = prev.map(g => freshById.get(g.id) || g);
      // 2) prepend 真正的新项（prev 里没有的），保持 id 倒序
      const haveIds = new Set(prev.map(g => g.id));
      const added = fresh.filter(g => !haveIds.has(g.id));
      return added.length ? [...added, ...merged] : merged;
    });
    fresh.forEach(g => seenRef.current.add(g.id));
    return fresh;
  };

  /* ── Generate ── */

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const lines = prompt.split("\n").map(s => s.trim()).filter(Boolean);
      // ref_images_b64 只接受裸 base64，过滤掉误入的 URL / 代理路径 / dataURL 前缀
      const refB64 = refImages
        .map(img => img.startsWith("data:") ? img.split(",")[1] || "" : img)
        .filter(img => img && !img.startsWith("/") && !img.startsWith("http"));
      const allIds: number[] = [];
      for (const p of lines) {
        try {
          const actualPrompt = !fusionMode && refB64.length > 0 ? "根据参考图，" + p : p;
          const body: any = { prompt: actualPrompt, model: "gpt-image-2", size, count: 1 };
          if (refB64.length > 0) body.ref_images_b64 = refB64;
          const res = await api<any>("/api/generations", { method: "POST", body: JSON.stringify(body) });
          allIds.push(...(res.data.ids || [res.data.id]));
        } catch (e: any) { toast.error(p.slice(0, 20) + "... " + e.message); }
      }
      setPrompt("");
      setHsFilter("all");
      if (allIds.length === 0) { setLoading(false); return; }
      pollUpdate().catch(() => {});
      const poll = setInterval(async () => {
        try {
          const gens = await pollUpdate();
          if (allIds.every(id => { const f = gens.find((g: any) => g.id === id); return f && f.status !== "pending"; })) {
            clearInterval(poll); setLoading(false);
          }
        } catch { clearInterval(poll); setLoading(false); }
      }, 3000);
    } catch { setLoading(false); }
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
    setPrompt(g.prompt);
    setSize(g.size || "1:1");
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
      if (b64) setRefImages([b64]);
    } catch {
      toast.error("载入参考图失败");
    }
  };

  const retryGen = (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    setPrompt(g.prompt); setSize(g.size || "1:1");
    api("/api/generations", { method: "DELETE", body: JSON.stringify({ id: g.id }) }).then(() => {
      colAssignRef.current.delete(g.id);
      setGenerations(prev => prev.filter(x => x.id !== g.id));
    }).catch(() => {});
  };

  const toggleShare = async (e: React.MouseEvent, g: any) => {
    e.stopPropagation();
    const v = !g.shared;
    try {
      await api("/api/generations/share", { method: "POST", body: JSON.stringify({ id: g.id, shared: v }) });
      setGenerations(prev => prev.map(x => x.id === g.id ? { ...x, shared: v } : x));
    } catch {}
  };

  /* ── Derived ── */

  const filtered = hsFilter === "all" ? generations : generations.filter(g => {
    if (hsFilter === "completed") return g.status === "completed";
    if (hsFilter === "failed") return g.status === "failed";
    if (hsFilter === "pending") return g.status === "pending";
    return true;
  });

  // 稳定列分配：每张图首次出现时放入当时最短的列并记住，之后固定。
  // 这样删/增某项不会让其它项换列重挂载（避免「删一张后面全部缩放」的级联）。
  // 列数变化时（窗口缩放断点切换）重置重排。
  const buckets: any[][] = Array.from({ length: cols }, () => []);
  if (colAssignColsRef.current !== cols) {
    colAssignRef.current = new Map();
    colAssignColsRef.current = cols;
  }
  const assign = colAssignRef.current;
  const colHeights = new Array(cols).fill(0); // 各列已分配项数
  for (const g of filtered) {
    let c = assign.get(g.id);
    if (c === undefined || c >= cols) {
      // 新项：放入当前最短列（项数最少，等价于初始轮转铺满）
      c = 0;
      for (let j = 1; j < cols; j++) if (colHeights[j] < colHeights[c]) c = j;
      assign.set(g.id, c);
    }
    buckets[c].push(g);
    colHeights[c]++;
  }

  const hasMore = generations.length < total;

  const counts = {
    all: generations.length,
    completed: generations.filter(g => g.status === "completed").length,
    pending: generations.filter(g => g.status === "pending").length,
    failed: generations.filter(g => g.status === "failed").length,
  };

  const lineCount = prompt.split("\n").filter(s => s.trim()).length;
  const capacity = (user as any)?.token_capacity || 50;
  const isPro = (user as any)?.plan_name && (user as any).plan_name !== "免费版";

  if (!user) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#f7f6f3] dark:bg-[#12120f]">
        <Navbar />

        {/* ═══════════════ TOP — Prompt Studio ═══════════════ */}
        <div className="border-b border-[#e8e7e2] dark:border-[#1f1f1b] bg-white dark:bg-[#181814]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-6">

            {/* Header row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#1a1a18] dark:bg-white flex items-center justify-center">
                  <Palette className="w-4 h-4 text-white dark:text-[#1a1a18]" />
                </div>
                <div>
                  <h1 className="text-sm font-semibold tracking-tight text-[#1a1a18] dark:text-white">创作</h1>
                  <p className="text-[11px] text-[#a09f9a] dark:text-[#6b6a66] tracking-wide">
                    {lineCount > 1 ? `${lineCount} 个提示词 · 每行一张` : "AI 图片生成"}
                  </p>
                </div>
              </div>

              {/* Token + Plan pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#f0efe8] dark:bg-[#252521] text-[10px]">
                <span className="px-1.5 py-px rounded-full bg-white/60 dark:bg-[#353530] text-[#6b6a66] dark:text-[#9e9d98] font-medium">
                  {isPro ? "Pro" : "Free"}
                </span>
                <span className="text-[#6b6a66] dark:text-[#9e9d98] font-mono tabular-nums">
                  <Zap className="w-2.5 h-2.5 inline -mt-px mr-0.5" />
                  {bucketTokens !== null ? `${Math.round(bucketTokens)}` : "—"}
                </span>
              </div>
            </div>

            {/* Prompt textarea — hero element */}
            <div className="relative">
              <div
                className={`absolute -inset-1 rounded-2xl blur-xl ${loading ? "opacity-60" : "opacity-20"}`}
                style={{
                  background: "linear-gradient(135deg, #06b6d4, #8b5cf6, #f59e0b, #06b6d4) 0% 50% / 200% 100%",
                  animation: loading ? "gradientFlow 3s ease-in-out infinite" : "none",
                  willChange: "transform",
                  transform: "translateZ(0)",
                }} />
              <div className="relative rounded-xl border border-[#e0dfd8] dark:border-[#2a2a25] bg-white dark:bg-[#1a1a18]
                transition-all duration-300 focus-within:border-[#c0bfb8] dark:focus-within:border-[#40403a] focus-within:shadow-lg">
                <textarea
                  ref={inputRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); } }}
                  placeholder="描述你脑海中的画面..."
                  rows={3}
                  className="w-full px-5 py-4 bg-transparent text-sm text-[#1a1a18] dark:text-white placeholder:text-[#c0bfb8] dark:placeholder:text-[#4a4a45] resize-none outline-none leading-relaxed"
                />
                {/* Bottom bar */}
                <div className="flex items-center justify-between px-4 pb-3 pt-1">
                  <div className="flex items-center gap-2">
                    {/* Size pills — common + more dropdown */}
                    <div className="flex items-center gap-1">
                      {SIZES.slice(0, 5).map(s => {
                        const Icon = s.icon;
                        return (
                        <button key={s.id} onClick={() => setSize(s.id)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                            size === s.id
                              ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] shadow-sm"
                              : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                          }`}>
                          <Icon className="w-2.5 h-2.5" />
                          {s.desc}
                        </button>
                      );})}
                      <div className="relative">
                        <button onClick={() => setSizeOpen(!sizeOpen)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                            !SIZES.slice(0, 5).find(s => s.id === size)
                              ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] shadow-sm"
                              : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                          }`}>
                          {(() => {
                            const cur = SIZES.find(s => s.id === size);
                            if (cur && !SIZES.slice(0, 5).includes(cur)) {
                              const Icon = cur.icon;
                              return <><Icon className="w-2.5 h-2.5" />{cur.desc}</>;
                            }
                            return "更多";
                          })()}
                        </button>
                        {sizeOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setSizeOpen(false)} />
                            <div className="absolute left-0 top-full mt-1 z-20 w-[220px] p-2 rounded-xl bg-white dark:bg-[#1a1a18] border border-[#e0dfd8] dark:border-[#2a2a25] shadow-xl grid grid-cols-2 gap-1">
                              {SIZES.slice(5).map(s => {
                                const Icon = s.icon;
                                const cur = size === s.id;
                                return (
                                <button key={s.id} onClick={() => { setSize(s.id); setSizeOpen(false); }}
                                  className={`flex items-center gap-2 px-2 py-2 rounded-lg text-[10px] font-medium transition-all text-left ${
                                    cur ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18]" : "text-[#6b6a66] dark:text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                                  }`}>
                                  <Icon className={`w-3.5 h-3.5 shrink-0 ${cur ? "text-white dark:text-[#1a1a18]" : ""}`} />
                                  <div className="min-w-0">
                                    <div className="font-medium">{s.desc}</div>
                                    <div className={`text-[10px] opacity-60 ${cur ? "text-white/70 dark:text-[#1a1a18]/70" : ""}`}>{s.label}</div>
                                  </div>
                                </button>
                              );})}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="w-px h-4 bg-[#e0dfd8] dark:bg-[#2a2a25]" />
                    {/* Ref image */}
                    <button onClick={() => fileRef.current?.click()}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                        refImages.length > 0 ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18]" : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                      }`}>
                      <ImageIcon className="w-2.5 h-2.5" />
                      {refImages.length > 0 ? `参考图(${refImages.length})` : (fusionMode ? "添加图片" : "参考图")}
                    </button>
                    {refImages.length > 0 && (
                      <div className="flex items-center gap-1">
                        {refImages.map((img, idx) => (
                          <div key={idx} className="relative">
                            <img src={refImageSrc(img)} className="w-6 h-6 rounded object-cover ring-1 ring-[#e0dfd8] dark:ring-[#2a2a25]" />
                            <button onClick={() => setRefImages(refImages.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#e11d48] text-white flex items-center justify-center text-[6px]">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {refImages.length > 0 && fusionMode && (
                      <span className="text-[10px] text-[#8b5cf6] font-medium px-1.5 py-0.5 rounded-md bg-[#8b5cf6]/10">融合</span>
                    )}
                    <button onClick={() => { setFusionMode(!fusionMode); setRefImages([]); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                        fusionMode ? "bg-[#8b5cf6] text-white" : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                      }`}>
                      <ImageIcon className="w-2.5 h-2.5" />
                      {fusionMode ? "融合" : "图生图"}
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={e => {
                        const file = e.target?.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const b64 = (reader.result as string).split(",")[1] || (reader.result as string);
                          setRefImages(prev => [...prev, b64]);
                        };
                        reader.readAsDataURL(file);
                      }} />
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Line count */}
                    {lineCount > 1 && (
                      <span className="text-[10px] text-[#9e9d98] dark:text-[#6b6a66] font-mono tabular-nums bg-[#f0efe8] dark:bg-[#252521] px-1.5 py-0.5 rounded-md">
                        {lineCount} 张
                      </span>
                    )}
                    <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45] font-mono tabular-nums">{prompt.length}</span>
                    <Button onClick={generate} disabled={loading || !prompt.trim()} size="sm"
                      className="h-7 px-3 rounded-lg text-[10px] font-semibold bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] hover:bg-[#333] dark:hover:bg-[#e0dfd8] disabled:opacity-40 shadow-sm transition-all gap-1.5">
                      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                      {loading ? "生成中..." : "生成"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Hint */}
            <p className="mt-2 text-[11px] text-[#c0bfb8] dark:text-[#4a4a45] tracking-wide">
              Ctrl+⏎ 发送 · 每行一个提示词 · 支持图生图与图片融合
            </p>
          </div>
        </div>

        {/* ═══════════════ GALLERY ═══════════════ */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

          {/* Gallery header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#1a1a18] dark:text-white tracking-tight">
                作品
              </h2>
              <span className="text-[10px] text-[#9e9d98] dark:text-[#6b6a66] font-mono">{total || generations.length}</span>
            </div>
            {generations.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#f0efe8] dark:bg-[#1f1f1b]">
                  {FILTER_TABS.map(tab => (
                    <button key={tab.key} onClick={() => setHsFilter(tab.key)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                        hsFilter === tab.key
                          ? "bg-white dark:bg-[#2a2a25] text-[#1a1a18] dark:text-white shadow-sm"
                          : "text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white"
                      }`}>
                      <tab.icon className="w-3 h-3" />
                      {tab.label}
                      <span className="text-[10px] font-mono opacity-60">{counts[tab.key]}</span>
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
            <div className="flex flex-col items-center py-24 text-[#9e9d98]">
              <div className="w-16 h-16 rounded-2xl bg-[#f0efe8] dark:bg-[#1f1f1b] flex items-center justify-center mb-4">
                <Palette className="w-7 h-7 text-[#c0bfb8] dark:text-[#4a4a45]" />
              </div>
              <p className="text-sm font-medium text-[#6b6a66] dark:text-[#9e9d98]">
                {hsFilter !== "all" ? "无匹配记录" : "开始创作"}
              </p>
              <p className="text-[11px] text-[#c0bfb8] dark:text-[#4a4a45] mt-1">
                {hsFilter !== "all" ? "切换筛选标签查看其他记录" : "输入提示词，按 ⏎ 生成"}
              </p>
            </div>
          ) : (
            /* Masonry — JS 横向轮转分列：外层 flex，每列 flex-col，视觉顺序左→右 */
            <div className="flex gap-3 items-start">
              {buckets.map((col, ci) => (
                <div key={ci} className="flex-1 min-w-0 flex flex-col gap-3">
                  <AnimatePresence>
                  {col.map((g) => {
                    const isRev = revealedIds.has(String(g.id));
                    const clr = g.id ? accent(g.id) : "#6366f1";

                    return (
                      <motion.div
                        key={g.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.25 } }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        style={{ willChange: "transform" }}
                        className="group relative rounded-xl overflow-hidden bg-white dark:bg-[#181814] border border-[#e8e7e2] dark:border-[#1f1f1b] cursor-pointer"
                        onClick={() => { const s = imageProxyUrl(g); if (s) setPreview(s); }}
                      >
                    {(g.image_url || (g.image_b64 && g.image_b64.length > 100)) ? (
                      <>
                        <div className="h-[2px]" style={{ backgroundColor: clr }} />
                        {mounted ? (
                          <img src={imageProxyUrl(g)} alt={g.prompt} className="w-full h-auto"
                            onLoad={() => setRevealedIds(prev => { if (prev.has(String(g.id))) return prev; return new Set(prev).add(String(g.id)); })} />
                        ) : (
                          <div className="w-full aspect-square bg-[#f0efe8] dark:bg-[#181814]" />
                        )}
                        {/* Loading shimmer — 显影效果 */}
                        {!isRev && (
                          <div className="absolute inset-0 overflow-hidden">
                            <div className="absolute inset-0 bg-[#f0efe8] dark:bg-[#181814]" />
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ddd] dark:via-[#333] to-transparent animate-[shimmer_2.5s_ease-in-out_infinite]"
                              style={{ backgroundSize: "200% 100%" }} />
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#e0dfd8] dark:bg-[#2a2a25] overflow-hidden">
                              <div className="h-full bg-[#1a1a18] dark:bg-white rounded-full animate-[developProgress_3s_ease-out_forwards]" />
                            </div>
                          </div>
                        )}
                        {/* 扫光渐出遮罩 — 与图片淡入重叠，防止生硬切换 */}
                        <div className={`absolute inset-0 bg-[#f0efe8] dark:bg-[#181814] transition-opacity duration-700 pointer-events-none ${isRev ? "opacity-0" : "opacity-100"}`} />
                        {/* Hover overlay */}
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-auto">
                            <p className="text-[11px] text-white/90 line-clamp-2 mb-2 leading-relaxed">{g.prompt}</p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {g.size && <span className="text-[10px] px-1 py-0.5 rounded bg-white/15 text-white/70 font-mono">{g.size}</span>}
                                <span className="text-[10px] text-white/40">{g.created_at?.slice(5, 16)}</span>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <Tooltip>
                                  <TooltipTrigger render={
                                    <button onClick={e => toggleShare(e, g)}
                                      className="p-1 rounded-lg transition-colors"
                                      style={{ backgroundColor: g.shared ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.15)" }}>
                                      <Share2 className="w-3 h-3 text-white" />
                                    </button>
                                  } />
                                  <TooltipContent>{g.shared ? "已分享到广场" : "分享到广场"}</TooltipContent>
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
                                    <button onClick={e => { e.stopPropagation(); deleteGen(e, g.id); }}
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
                      <div className="flex flex-col items-center justify-center gap-3 py-16 bg-[#faf9f6] dark:bg-[#181814]">
                        <div className="relative w-10 h-10">
                          <div className="absolute inset-0 rounded-full border-2 border-[#e0dfd8] dark:border-[#2a2a25]" />
                          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#1a1a18] dark:border-t-white animate-spin" />
                        </div>
                        <span className="text-[10px] text-[#9e9d98] dark:text-[#8a8985] font-medium tracking-wide">生成中</span>
                        <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45]">约 10-30 秒</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-16 bg-[#faf9f6] dark:bg-[#181814]">
                        <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] text-[#9e9d98] dark:text-[#8a8985] font-medium block">生成失败</span>
                          <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45] mt-0.5 block">{g.error_msg || g.prompt?.slice(0, 30)}</span>
                        </div>
                        <button onClick={e => retryGen(e, g)}
                          className="px-3 py-1 rounded-lg text-[10px] font-medium bg-[#f0efe8] dark:bg-[#252521] text-[#6b6a66] dark:text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white transition-colors">
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
                <div className="flex items-center gap-2 text-[11px] text-[#9e9d98] dark:text-[#6b6a66]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载中...
                </div>
              ) : hasMore ? (
                <span className="text-[11px] text-[#c0bfb8] dark:text-[#4a4a45]">下滑加载更多</span>
              ) : (
                <span className="text-[11px] text-[#c0bfb8] dark:text-[#4a4a45]">没有更多了</span>
              )}
            </div>
          )}
        </div>

        {/* ═══ Preview Dialog ═══ */}
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className="max-w-3xl p-0 bg-transparent border-0 shadow-none [&>button]:hidden">
            {preview && (
              <div className="relative">
                <button onClick={() => setPreview(null)}
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                  <X className="w-4 h-4" />
                </button>
                <img src={preview} className="w-full h-auto rounded-xl shadow-2xl" alt="" />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
