// 创作页画廊数据 hook：封装生成记录的加载、轮询合并、分页/无限滚动、
// 响应式列数与稳定列分配（瀑布流）。把这套与「数据」相关的状态从页面里剥离出来。
import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

const PAGE_SIZE = 12;

export type Generation = any;

export function useGenerations() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState(4);

  const seenRef = useRef<Set<number>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const galleryRoRef = useRef<ResizeObserver | null>(null);
  const loadingMoreRef = useRef(false);
  // 稳定列分配：id→列号，首次分配后固定，避免增删使其它项换列重挂载（导致整体缩放）
  const colAssignRef = useRef<Map<number, number>>(new Map());
  const colAssignColsRef = useRef(0);

  // 标记一批项里「已可显示」的图片为已揭示
  const markRevealed = useCallback((items: Generation[]) => {
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
  }, []);

  // 首屏 / 重置加载第 1 页（替换列表）
  const loadInitial = useCallback(async () => {
    try {
      const r = await api<any>(`/api/generations?page=1&page_size=${PAGE_SIZE}`);
      const items = r.data?.items || [];
      setGenerations(items);
      setTotal(r.data?.total ?? items.length);
      setPage(1);
      seenRef.current = new Set(items.map((g: any) => g.id));
      markRevealed(items);
    } catch (e) { console.error("[loadInitial]", e); }
  }, [markRevealed]);

  // 滚动到底加载下一页（按 id 去重后 append）
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    setLoadingMore(true);
    loadingMoreRef.current = true;
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
  }, [page, total, markRevealed]);

  // 生成轮询：拉第 1 页，合并而非覆盖——更新已加载项状态、prepend 新项、刷新 total
  const pollUpdate = useCallback(async (): Promise<any[]> => {
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
  }, [total, markRevealed]);

  // 响应式列数：按画廊容器实际宽度算（分栏后右栏宽度 = 视口 − 左栏）。
  // 用回调 ref：容器挂载时建 ResizeObserver、卸载时断开。阈值 <720→2, <1100→3, ≥1100→4。
  const galleryRef = useCallback((node: HTMLDivElement | null) => {
    if (galleryRoRef.current) { galleryRoRef.current.disconnect(); galleryRoRef.current = null; }
    if (!node) return;
    const calc = (w: number) => setCols(w >= 1100 ? 4 : w >= 720 ? 3 : 2);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => { for (const e of entries) calc(e.contentRect.width); });
      ro.observe(node);
      galleryRoRef.current = ro;
      calc(node.clientWidth);
    } else {
      calc(node.clientWidth);
    }
  }, []);

  // 无限滚动：sentinel 进入视口且还有更多时加载下一页。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && generations.length < total && !loadingMoreRef.current) {
          loadMore();
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, total, generations.length, loadMore]);

  // 稳定列分配 buckets：每张图首次出现时放入当时最短列并记住，之后固定。
  // 列数变化时（断点切换）重置重排。给定 filtered 列表算出每列内容。
  const computeBuckets = useCallback((filtered: Generation[]): Generation[][] => {
    const buckets: Generation[][] = Array.from({ length: cols }, () => []);
    if (colAssignColsRef.current !== cols) {
      colAssignRef.current = new Map();
      colAssignColsRef.current = cols;
    }
    const assign = colAssignRef.current;
    const colHeights = new Array(cols).fill(0);
    for (const g of filtered) {
      let c = assign.get(g.id);
      if (c === undefined || c >= cols) {
        c = 0;
        for (let j = 1; j < cols; j++) if (colHeights[j] < colHeights[c]) c = j;
        assign.set(g.id, c);
      }
      buckets[c].push(g);
      colHeights[c]++;
    }
    return buckets;
  }, [cols]);

  return {
    generations, setGenerations, total, setTotal, loadingMore, revealedIds, setRevealedIds, cols,
    seenRef, sentinelRef, galleryRef, colAssignRef,
    markRevealed, loadInitial, loadMore, pollUpdate, computeBuckets,
    hasMore: generations.length < total,
  };
}

