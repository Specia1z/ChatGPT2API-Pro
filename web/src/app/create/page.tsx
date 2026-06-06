"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import * as LucideIcons from "lucide-react";
const {
  ImageIcon, Loader2, Wand2, X, Download, Trash2,
  CheckCircle, AlertCircle, Clock, Filter, Share2,
  Square, Monitor, Smartphone, Camera, MonitorDown, Tv, FileText,
  Zap, Palette, Sparkles, Maximize2,
} = LucideIcons;
import { useAuth } from "@/lib/auth";
import { api, BASE } from "@/lib/api";
import { Navbar } from "@/components/navbar";
import { imageProxyUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

/* ── 图标名称 → 组件映射 ──────────────── */
const resolveIcon = (name: string) => (LucideIcons as any)[name] || Palette;

/* 风格预设统一以后台 /api/settings 的 style_presets 为准（后端首次安装已 seed 内置风格）。
   前端不再各持一份硬编码副本，避免与库中数据割裂；加载完成前 styles 为空。 */
type StylePreset = { id: string; label: string; icon: any; desc: string; hint: string };

const FILTER_TABS = [
  { key: "all" as const, label: "全部", icon: Filter },
  { key: "completed" as const, label: "已完成", icon: CheckCircle },
  { key: "pending" as const, label: "生成中", icon: Clock },
  { key: "failed" as const, label: "失败", icon: AlertCircle },
];

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
// size 展示：Auto 出图存为复合值 "auto:宽x高"。角标只显「Auto」，详情可显「Auto · 宽×高」。
const sizeLabel = (size: string, withDim = false): string => {
  if (size.startsWith("auto:")) {
    const dim = size.slice(5).replace(/[xX*]/, "×");
    return withDim && dim ? `Auto · ${dim}` : "Auto";
  }
  return size;
};
// hover 提示：复合值返回精确像素（宽×高），其余返回空串（无需 title）。
const sizeTitle = (size: string): string => {
  if (size.startsWith("auto:")) return size.slice(5).replace(/[xX*]/, "×");
  return "";
};
// 解析 Auto 复合值 "auto:宽x高" 的像素；非 Auto 或解析失败返回 null。
const autoDim = (size: string): { w: number; h: number } | null => {
  if (!size.startsWith("auto:")) return null;
  const m = size.slice(5).match(/^(\d+)[xX*](\d+)$/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
};

// 分享审核状态 → UI 语义（先审后发）。兼容无 share_status 的老数据（用 shared 推断）。
type ShareUI = { key: "none" | "pending" | "approved" | "rejected"; label: string; active: boolean };
const shareState = (g: any): ShareUI => {
  const ss = g.share_status || (g.shared ? "approved" : "none");
  switch (ss) {
    case "pending":  return { key: "pending",  label: "审核中",   active: true };
    case "approved": return { key: "approved", label: "已展示",   active: true };
    case "rejected": return { key: "rejected", label: "未通过",   active: false };
    default:          return { key: "none",     label: "分享到广场", active: false };
  }
};

export default function CreatePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tags, setTags] = useState<string[]>([""]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({}); // 提示词文本 → 份数（默认 1）
  const [currentInput, setCurrentInput] = useState("");
  const inputRef2 = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [generations, setGenerations] = useState<any[]>([]);
  const [previewGen, setPreviewGen] = useState<any>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refDim, setRefDim] = useState<{ w: number; h: number } | null>(null); // 首张参考图真实尺寸（Auto 用）
  const [fusionMode, setFusionMode] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const [sizeMenuPos, setSizeMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [size, setSize] = useState("1:1");
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [hsFilter, setHsFilter] = useState<"all" | "completed" | "failed" | "pending">("all");
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

  // 尺寸「更多」菜单：用 fixed 定位避开横向滚动容器的 overflow 裁剪，按触发按钮位置动态计算坐标
  const toggleSizeMenu = () => {
    if (sizeOpen) { setSizeOpen(false); return; }
    const rect = sizeBtnRef.current?.getBoundingClientRect();
    if (rect) {
      const MENU_W = 220, MENU_H = 200, GAP = 4;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8));
      // 下方空间不足则向上翻转
      const top = rect.bottom + MENU_H + GAP > window.innerHeight && rect.top - MENU_H - GAP > 0
        ? rect.top - MENU_H - GAP
        : rect.bottom + GAP;
      setSizeMenuPos({ left, top });
    }
    setSizeOpen(true);
  };

  // fixed 菜单坐标在打开瞬间算定，页面滚动/缩放后会错位，故此时直接关闭
  useEffect(() => {
    if (!sizeOpen) return;
    const close = () => setSizeOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [sizeOpen]);


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

  const lineCount = tags.filter(Boolean).length;
  // 总张数 = 各提示词份数之和（含尚未提交的当前输入，按 1 份计）
  const totalImages = tags.filter(Boolean).reduce((sum, t) => sum + getTagCount(t), 0) + (currentInput.trim() ? 1 : 0);

  if (!user) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#f7f6f3] dark:bg-[#12120f] pb-16 md:pb-0">
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
                    {totalImages > 1 ? `${lineCount} 个提示词 · 共 ${totalImages} 张` : "AI 图片生成"}
                  </p>
                </div>
              </div>

              {/* Token + Plan pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#f0efe8] dark:bg-[#252521] text-[10px]">
                <span className="px-1.5 py-px rounded-full bg-white/60 dark:bg-[#353530] text-[#6b6a66] dark:text-[#9e9d98] font-medium">
                  {(user as any)?.plan_name || "免费版"}
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
                className={`absolute -inset-1 rounded-2xl blur-xl transition-all duration-500 ${loading ? "opacity-60" : "opacity-20"}`}
                style={{
                  background: "linear-gradient(135deg, #1a1a18, #9e9d98, #c0bfb8, #1a1a18) 0% 50% / 200% 100%",
                  animation: loading ? "gradientFlow 3s ease-in-out infinite" : "none",
                  willChange: "transform",
                  transform: "translateZ(0)",
                }} />
              <div className="relative rounded-xl border border-[#e0dfd8] dark:border-[#2a2a25] bg-white dark:bg-[#1a1a18]
                transition-all duration-300 focus-within:border-[#c0bfb8] dark:focus-within:border-[#40403a] focus-within:shadow-lg">
                <div className="px-3 py-3 space-y-2 min-h-[72px] sm:min-h-0 max-h-40 overflow-y-auto scrollbar-thin">
                  {tags.filter(Boolean).length === 0 && !currentInput && (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-base sm:text-sm text-[#c0bfb8] dark:text-[#4a4a45]">
                      <span>描述你想要的画面，例如「夕阳下的海边小屋，水彩风格」</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {tags.filter(Boolean).map((tag, i) => (
                      <span key={i}
                        className="group inline-flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-lg bg-[#f0efe8] dark:bg-[#252521]
                          text-xs sm:text-[11px] text-[#1a1a18] dark:text-white max-w-full">
                        <span onClick={() => editTag(i)} className="truncate max-w-[200px] sm:max-w-xs cursor-pointer" title="点击修改">{tag}</span>
                        {/* 份数控制：×N，可增减（1–10） */}
                        <span className="inline-flex items-center gap-0.5 ml-0.5 px-1 rounded-md bg-white/60 dark:bg-[#1a1a18]/50 shrink-0">
                          <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) - 1); }}
                            className="size-3.5 flex items-center justify-center text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white disabled:opacity-30"
                            disabled={getTagCount(tag) <= 1}>
                            <svg className="size-2" viewBox="0 0 10 2" fill="none"><path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                          <span className="text-[10px] font-mono tabular-nums w-3 text-center text-[#6b6a66] dark:text-[#9e9d98]">{getTagCount(tag)}</span>
                          <button onClick={e => { e.stopPropagation(); setTagCount(tag, getTagCount(tag) + 1); }}
                            className="size-3.5 flex items-center justify-center text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white disabled:opacity-30"
                            disabled={getTagCount(tag) >= 10}>
                            <svg className="size-2" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                        </span>
                        <button onClick={e => { e.stopPropagation(); removeTag(i); }}
                          className="size-3.5 rounded-full flex items-center justify-center text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#d0cfc8] dark:hover:bg-[#3a3a35] shrink-0 transition-colors">
                          <svg className="size-2.5" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
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
                      placeholder="输入提示词，Enter 添加..."
                      className="flex-1 bg-transparent text-base sm:text-sm text-[#1a1a18] dark:text-white placeholder:text-[#c0bfb8] dark:placeholder:text-[#4a4a45] outline-none"
                    />
                  </div>
                </div>
                {/* 风格模板：始终展示列表，高亮选中项，再点取消；hint 在生成时统一拼接，不污染输入框 */}
                {styles.length > 0 && (
                  <div className="px-3 sm:px-4 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45] font-medium shrink-0">风格</span>
                      <div className="relative min-w-0 flex-1">
                        {/* 右侧渐变遮罩提示可横向滚动 */}
                        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white dark:from-[#1a1a18] to-transparent z-10" />
                        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide overscroll-x-contain pr-6 py-0.5">
                          {styles.map(s => {
                            const Icon = typeof s.icon === "string" ? resolveIcon(s.icon) : s.icon;
                            const active = activeStyle === s.id;
                            return (
                              <button key={s.id} onClick={() => {
                                setActiveStyle(active ? null : s.id);
                                inputRef2.current?.focus();
                              }}
                                aria-pressed={active}
                                className={`flex items-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-lg text-[11px] sm:text-[10px] font-medium transition-colors shrink-0 border touch-manipulation ${
                                  active
                                    ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] border-transparent"
                                    : "text-[#9e9d98] dark:text-[#6b6a66] border-transparent hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521] hover:border-[#e0dfd8] dark:hover:border-[#2a2a25]"
                                }`}>
                                <Icon className="w-3.5 h-3.5 sm:w-3 sm:h-3 shrink-0" />
                                <span className="whitespace-nowrap">{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {activeStyle && (
                      <p className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45] mt-1 truncate">
                        已选「{styles.find(s => s.id === activeStyle)?.label}」· {styles.find(s => s.id === activeStyle)?.desc} · 生成时自动追加风格提示词
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 pb-3 pt-1">
                  <div className="flex items-center gap-1 sm:gap-2 sm:flex-wrap overflow-x-auto scrollbar-hide overscroll-x-contain -mx-1 px-1 py-0.5">
                    {/* Size pills — common + more dropdown */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Auto：跟随参考图比例，仅图生图/有参考图时可选 */}
                      {refImages.length > 0 && (
                        <button onClick={() => setSize("auto")} title={refDim ? `跟随参考图 ${refDim.w}×${refDim.h}` : "跟随参考图比例"}
                          className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-[11px] sm:text-[10px] font-medium transition-colors shrink-0 touch-manipulation ${
                            size === "auto"
                              ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] shadow-sm"
                              : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                          }`}>
                          <Maximize2 className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
                          <span>Auto</span>
                        </button>
                      )}
                      {SIZES.slice(0, 5).map(s => {
                        const Icon = s.icon;
                        return (
                        <button key={s.id} onClick={() => setSize(s.id)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-[11px] sm:text-[10px] font-medium transition-colors shrink-0 touch-manipulation ${
                            size === s.id
                              ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] shadow-sm"
                              : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                          }`}>
                          <Icon className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
                          <span className="hidden sm:inline">{s.desc}</span>
                        </button>
                      );})}
                      <div className="relative shrink-0">
                        <button ref={sizeBtnRef} onClick={toggleSizeMenu}
                          className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-[11px] sm:text-[10px] font-medium transition-colors touch-manipulation ${
                            size !== "auto" && !SIZES.slice(0, 5).find(s => s.id === size)
                              ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] shadow-sm"
                              : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                          }`}>
                          {(() => {
                            const cur = SIZES.find(s => s.id === size);
                            if (cur && !SIZES.slice(0, 5).includes(cur)) {
                              const Icon = cur.icon;
                              return <><Icon className="w-3 h-3 sm:w-2.5 sm:h-2.5" />{cur.desc}</>;
                            }
                            return "更多";
                          })()}
                        </button>
                        {sizeOpen && sizeMenuPos && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setSizeOpen(false)} />
                            <div style={{ left: sizeMenuPos.left, top: sizeMenuPos.top }}
                              className="fixed z-50 w-[220px] p-2 rounded-xl bg-white dark:bg-[#1a1a18] border border-[#e0dfd8] dark:border-[#2a2a25] shadow-xl grid grid-cols-2 gap-1">
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
                    <span className="w-px h-4 bg-[#e0dfd8] dark:bg-[#2a2a25] shrink-0" />
                    {/* Ref image */}
                    <button onClick={() => fileRef.current?.click()}
                      className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-[11px] sm:text-[10px] font-medium transition-colors shrink-0 touch-manipulation ${
                        refImages.length > 0 ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18]" : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                      }`}>
                      <ImageIcon className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
                      {refImages.length > 0 ? `参考图(${refImages.length})` : (fusionMode ? "添加图片" : "参考图")}
                    </button>
                    {refImages.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        {refImages.map((img, idx) => (
                          <div key={idx} className="relative">
                            <img src={refImageSrc(img)} className="w-6 h-6 rounded object-cover ring-1 ring-[#e0dfd8] dark:ring-[#2a2a25]"
                              onLoad={idx === 0 ? (e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setRefDim({ w: im.naturalWidth, h: im.naturalHeight }); } : undefined} />
                            <button onClick={() => setRefImages(refImages.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] flex items-center justify-center text-[6px]">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {refImages.length > 0 && fusionMode && (
                      <span className="text-[10px] text-[#6b6a66] dark:text-[#9e9d98] font-medium px-1.5 py-0.5 rounded-md bg-[#f0efe8] dark:bg-[#252521] shrink-0">融合</span>
                    )}
                    <button onClick={() => { const next = !fusionMode; setFusionMode(next); setRefImages([]); if (next) fileRef.current?.click(); }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-[11px] sm:text-[10px] font-medium transition-colors shrink-0 touch-manipulation ${
                        fusionMode ? "bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18]" : "text-[#9e9d98] dark:text-[#6b6a66] hover:text-[#1a1a18] dark:hover:text-white hover:bg-[#f0efe8] dark:hover:bg-[#252521]"
                      }`}>
                      <ImageIcon className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
                      {fusionMode ? "融合" : "图生图"}
                    </button>
                    <input ref={fileRef} type="file" accept="image/*,image/heic,image/heif" multiple className="hidden"
                      onChange={async e => {
                        const files = e.target?.files;
                        if (!files || files.length === 0) return;
                        const results: string[] = [];
                        for (const file of Array.from(files)) {
                          let imgFile = file;
                          if (/\.heic$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif") {
                            try {
                              const { default: heic2any } = await import("heic2any");
                              const blob = await heic2any({ blob: file, toType: "image/jpeg" });
                              imgFile = new File([blob as Blob], file.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" });
                            } catch { toast.error("HEIC 转换失败"); continue; }
                          }
                          const raw = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve((reader.result as string).split(",")[1] || (reader.result as string));
                            reader.onerror = reject;
                            reader.readAsDataURL(imgFile);
                          });
                          results.push(raw);
                        }
                        setRefImages(prev => [...prev, ...results]);
                        e.target.value = "";
                      }} />
                  </div>

                  <div className="flex items-center justify-end gap-2 shrink-0">
                    {/* 总张数指示 */}
                    {totalImages > 1 && (
                      <span className="text-[10px] text-[#9e9d98] dark:text-[#6b6a66] font-mono tabular-nums bg-[#f0efe8] dark:bg-[#252521] px-1.5 py-0.5 rounded-md">
                        {totalImages} 张
                      </span>
                    )}
                    <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45] font-mono tabular-nums">{currentInput.length || tags.filter(Boolean).length}</span>
                    <Button onClick={generate} disabled={loading || !currentInput.trim() && tags.filter(Boolean).length === 0} size="sm"
                      className="flex-1 sm:flex-none h-10 sm:h-7 px-3 rounded-lg text-sm sm:text-[10px] font-semibold bg-[#1a1a18] dark:bg-white text-white dark:text-[#1a1a18] hover:bg-[#333] dark:hover:bg-[#e0dfd8] disabled:opacity-40 shadow-sm transition-all gap-1.5">
                      {loading ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" /> : <Wand2 className="w-4 h-4 sm:w-3 sm:h-3" />}
                      {loading
                        ? (batchProgress ? `提交中 ${batchProgress.done}/${batchProgress.total}` : "生成中...")
                        : (totalImages > 1 ? `生成 ${totalImages} 张` : "生成")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Hint */}
            <p className="mt-2 text-[11px] text-[#c0bfb8] dark:text-[#4a4a45] tracking-wide">
              Ctrl+⏎ 发送 · Enter 添加提示词 · 点击标签可修改 · ±调整份数 · 多张自动按套餐并发排队
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
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-nowrap max-w-full -mx-2 sm:mx-0 px-2 sm:px-0">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#f0efe8] dark:bg-[#1f1f1b] shrink-0">
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
                {hsFilter !== "all" ? "切换筛选标签查看其他记录" : "输入提示词，Enter 添加多个"}
              </p>
            </div>
          ) : (
            /* Masonry — JS 横向轮转分列：外层 flex，每列 flex-col，视觉顺序左→右 */
            <div className="flex gap-2 sm:gap-3 items-start">
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
                        className="group relative rounded-xl overflow-hidden bg-white dark:bg-[#181814] border border-[#e8e7e2] dark:border-[#1f1f1b] cursor-pointer"
                        onClick={() => { if (imageProxyUrl(g)) setPreviewGen(g); }}
                      >
                    {(g.image_url || (g.image_b64 && g.image_b64.length > 100)) ? (
                      <>
                        <div className="h-[2px] bg-[#e0dfd8] dark:bg-[#2a2a25]" />
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
                        {/* 分享状态角标 — 仅移动端常驻：审核中(琥珀) / 已展示(翠绿) */}
                        {isRev && shareState(g).active && (
                          <span className={`sm:hidden absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full shadow-sm pointer-events-none ${shareState(g).key === "pending" ? "bg-amber-500/90" : "bg-emerald-500/90"}`}>
                            {shareState(g).key === "pending"
                              ? <Clock className="w-2.5 h-2.5 text-white" />
                              : <Share2 className="w-2.5 h-2.5 text-white" />}
                          </span>
                        )}
                        {/* Hover overlay — 仅桌面端；移动端点击直接开预览，操作在预览弹窗内完成 */}
                        <div className="hidden sm:block absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-auto">
                            <p className="text-[11px] text-white/90 line-clamp-2 mb-2 leading-relaxed">{g.prompt}</p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {g.size && <span title={sizeTitle(g.size)} className="text-[10px] px-1 py-0.5 rounded bg-white/15 text-white/70 font-mono">{sizeLabel(g.size)}</span>}
                                <span className="text-[10px] text-white/40">{g.created_at?.slice(5, 16)}</span>
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
                      <div className="ai-creating-border relative flex flex-col items-center justify-center gap-4 py-12 sm:py-16 bg-[#faf9f6] dark:bg-[#181814] overflow-hidden">
                        {/* 光谱柔光呼吸底 */}
                        <div aria-hidden className="absolute left-1/2 top-1/2 w-32 h-32 rounded-full blur-3xl bg-[radial-gradient(circle,rgba(34,211,238,0.35),rgba(99,102,241,0.2)_50%,transparent_70%)]"
                          style={{ animation: "aiGlowBreathe 2.8s ease-in-out infinite" }} />

                        {/* 棱镜光球：旋转光谱光轮 + 中心亮点 */}
                        <div className="relative w-11 h-11">
                          <div aria-hidden className="absolute inset-0 rounded-full blur-[1px]"
                            style={{ background: "conic-gradient(from 0deg,#22d3ee,#6366f1,#e879f9,#fbbf24,#22d3ee)", animation: "aiPrismSpin 2s linear infinite" }} />
                          <div aria-hidden className="absolute inset-[3px] rounded-full bg-[#faf9f6] dark:bg-[#181814]" />
                          <div aria-hidden className="absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_10px_2px_rgba(34,211,238,0.7)]"
                            style={{ animation: "aiDotPulse 1.6s ease-in-out infinite" }} />
                        </div>

                        {/* 文案 + 思考三点 */}
                        <div className="relative flex flex-col items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-[#6b6a66] dark:text-[#9e9d98] font-medium tracking-wide">AI 创作中</span>
                            <span className="flex items-center gap-0.5">
                              {[0, 1, 2].map(i => (
                                <span key={i} className="w-1 h-1 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500"
                                  style={{ animation: `aiThinkDot 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                              ))}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45]">约 10-30 秒</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 sm:py-16 bg-[#faf9f6] dark:bg-[#181814]">
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
        <Dialog open={!!previewGen} onOpenChange={() => setPreviewGen(null)}>
          <DialogContent className="max-w-3xl p-0 px-3 sm:px-0 bg-transparent border-0 shadow-none [&>button]:hidden">
            {previewGen && (
              <div className="bg-white dark:bg-[#181814] rounded-xl overflow-hidden shadow-2xl">
                {/* Close */}
                <div className="relative">
                  <button onClick={() => setPreviewGen(null)}
                    className="absolute top-3 right-3 md:top-4 md:right-4 z-10 w-9 h-9 md:w-8 md:h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                  <img src={imageProxyUrl(previewGen)} className="w-full h-auto" alt={previewGen.prompt} />
                </div>
                {/* Info + Actions */}
                <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                  <p className="text-xs sm:text-sm text-[#1a1a18] dark:text-white leading-relaxed line-clamp-2 sm:line-clamp-3">{previewGen.prompt}</p>
                  <div className="flex items-center gap-2">
                    {previewGen.size && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0efe8] dark:bg-[#252521] text-[#6b6a66] dark:text-[#9e9d98] font-mono">{sizeLabel(previewGen.size, true)}</span>}
                    <span className="text-[10px] text-[#c0bfb8] dark:text-[#4a4a45]">{previewGen.created_at?.slice(5, 16)}</span>
                  </div>
                  {/* Action buttons — mobile: icons only, desktop: icon + label */}
                  <div className="flex items-center gap-1 sm:gap-2 pt-2 sm:pt-3 border-t border-[#e8e7e2] dark:border-[#1f1f1b]">
                    <button onClick={async (e) => {
                        const cur = shareState(previewGen);
                        await toggleShare(e, previewGen);
                        setPreviewGen({ ...previewGen, share_status: cur.active ? "none" : "pending", shared: cur.active ? false : previewGen.shared });
                      }}
                      className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-[#f0efe8] dark:bg-[#252521] text-[#6b6a66] dark:text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white transition-colors">
                      {shareState(previewGen).key === "pending"
                        ? <Clock className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                        : <Share2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />}
                      <span className="hidden sm:inline">{shareState(previewGen).label}</span>
                    </button>
                    <button onClick={(e) => { editGen(e, previewGen); setPreviewGen(null); }}
                      className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-[#f0efe8] dark:bg-[#252521] text-[#6b6a66] dark:text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white transition-colors">
                      <ImageIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="hidden sm:inline">编辑</span>
                    </button>
                    <button onClick={() => { downloadImg(imageProxyUrl(previewGen), previewGen.id); }}
                      className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-[#f0efe8] dark:bg-[#252521] text-[#6b6a66] dark:text-[#9e9d98] hover:text-[#1a1a18] dark:hover:text-white transition-colors">
                      <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="hidden sm:inline">下载</span>
                    </button>
                    <button onClick={() => { setDeleteTarget(previewGen.id); }}
                      className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors ml-auto">
                      <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="hidden sm:inline">删除</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
