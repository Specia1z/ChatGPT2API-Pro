"use client";

import { useState, useRef, useEffect } from "react";
import { Outfit, DM_Mono } from "next/font/google";
import { Shapes, Sparkles, Download, Copy, Check, Loader2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { BASE, getToken, api } from "@/lib/api";
import { sanitizeSVG } from "@/lib/sanitize";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

// 从流式原文里尽量提取 <svg> 片段用于实时预览（未闭合时返回空）
function extractSVG(s: string): string {
  const lo = s.indexOf("<svg");
  const hi = s.lastIndexOf("</svg>");
  if (lo >= 0 && hi > lo) return s.slice(lo, hi + 6);
  return "";
}

type Task = {
  id: number;
  raw: string;          // 流式累积原文
  svg: string;          // 最终 SVG
  status: "pending" | "streaming" | "done" | "error";
  error?: string;
};

const COUNTS = [1, 2, 4, 6];

export default function VectorPage() {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null); // 放大查看的 SVG
  const abortRef = useRef<AbortController | null>(null);

  // ESC 关闭大图
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const loadHistory = async () => {
    try {
      const r = await api<any>("/api/vector?page=1&page_size=24");
      setHistory(r.data?.items || []);
    } catch {}
    setHistLoading(false);
  };
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const delHistory = async (id: number) => {
    try {
      await api("/api/vector", { method: "DELETE", body: JSON.stringify({ id }) });
      setHistory(prev => prev.filter(h => h.id !== id));
    } catch (e: any) { toast.error(e.message || "删除失败"); }
  };

  // 更新单个任务（按 id）
  const patchTask = (id: number, patch: Partial<Task>) =>
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));

  // 单个任务的 SSE 流式生成；429（令牌/并发不足）指数退避重试。
  const runOne = async (id: number, p: string, signal: AbortSignal) => {
    const maxRetry = 6;
    let delay = 1500;
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) return;
      try {
        const res = await fetch(`${BASE}/api/vector`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
          body: JSON.stringify({ prompt: p }),
          signal,
        });
        if (res.status === 429 && attempt < maxRetry) {
          await new Promise(r => setTimeout(r, delay));
          delay = Math.min(delay * 1.6, 8000);
          continue;
        }
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.message || `HTTP ${res.status}`);
        }
        patchTask(id, { status: "streaming" });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "", acc = "";
        const handle = (block: string) => {
          const ev = /event: (\w+)/.exec(block)?.[1];
          const dataLine = block.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) return;
          const payload = JSON.parse(dataLine.slice(6));
          if (ev === "delta") { acc += payload.text || ""; patchTask(id, { raw: acc }); }
          else if (ev === "done") { patchTask(id, { svg: payload.svg || "", raw: payload.raw || acc, status: "done" }); }
          else if (ev === "error") { throw new Error(payload.message || "生成失败"); }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() || "";
          for (const b of blocks) handle(b);
        }
        if (buf.trim()) handle(buf);
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return;
        patchTask(id, { status: "error", error: e.message || "生成失败" });
        return;
      }
    }
  };

  const generate = async () => {
    const p = prompt.trim();
    if (!p || loading) return;
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const init: Task[] = Array.from({ length: count }, (_, i) => ({ id: Date.now() + i, raw: "", svg: "", status: "pending" }));
    setTasks(init);
    // 并发跑所有任务（各自独立扣令牌/占调度位，429 由 runOne 退避兜底）
    await Promise.all(init.map(t => runOne(t.id, p, ctrl.signal)));
    setLoading(false);
    loadHistory(); // 生成完刷新历史
  };

  const cancel = () => { abortRef.current?.abort(); setLoading(false); };

  const svgOf = (t: Task) => t.svg || extractSVG(t.raw);
  const copySvg = (t: Task) => {
    navigator.clipboard.writeText(svgOf(t));
    setCopiedId(t.id); setTimeout(() => setCopiedId(null), 1500);
  };
  const downloadSvg = (t: Task) => {
    const blob = new Blob([svgOf(t)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vector-${t.id}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const gridCols = tasks.length <= 1 ? "grid-cols-1" : tasks.length <= 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`${heading.variable} ${mono.variable} min-h-screen bg-background`}>
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-2xl bg-fuchsia-500/10 flex items-center justify-center">
            <Shapes className="size-5 text-fuchsia-500" />
          </div>
          <div>
            <h1 className={`${heading.className} text-xl font-bold tracking-tight`}>AI 矢量图生成</h1>
            <p className="text-xs text-muted-foreground mt-0.5">描述图形，AI 生成可缩放的 SVG 矢量代码，支持并发批量</p>
          </div>
        </div>

        {/* 输入区 */}
        <div className="space-y-3 mb-6">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="例如：一个简约的蓝色火箭图标，扁平风格"
            rows={3}
            maxLength={2000}
            className="w-full rounded-xl border bg-card px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-fuchsia-500/20"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">生成数量</span>
              {COUNTS.map(c => (
                <button key={c} onClick={() => setCount(c)} disabled={loading}
                  className={`size-8 rounded-lg text-xs font-medium border transition-colors ${count === c ? "bg-fuchsia-500/10 border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-400" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {loading
              ? <Button onClick={cancel} variant="outline" className="h-10 gap-2"><X className="size-4" /> 取消</Button>
              : <Button onClick={generate} disabled={!prompt.trim()} className="h-10 gap-2 px-6 bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:brightness-110">
                  <Sparkles className="size-4" /> 生成矢量图
                </Button>}
          </div>
          <p className="text-[10px] text-muted-foreground">每张消耗与生图相同的令牌；并发数受套餐并发上限约束，超出部分自动排队重试。</p>
        </div>

        {/* 结果网格 */}
        {tasks.length > 0 && (
          <div className={`grid ${gridCols} gap-4`}>
            {tasks.map(t => {
              const svg = svgOf(t);
              return (
                <div key={t.id} className="rounded-xl border bg-card overflow-hidden flex flex-col">
                  {/* 预览 */}
                  <div className="relative h-56 flex items-center justify-center p-4 overflow-hidden border-b">
                    <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle,currentColor_1px,transparent_1px)] [background-size:16px_16px]" />
                    {svg ? (
                      <div onClick={() => setLightbox(svg)} title="点击放大" className="relative w-full h-full cursor-zoom-in [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full" dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }} />
                    ) : t.status === "error" ? (
                      <div className="text-center text-red-500"><AlertCircle className="size-6 mx-auto mb-1.5" /><p className="text-[11px] px-3">{t.error}</p></div>
                    ) : (
                      <div className="text-center text-muted-foreground"><Loader2 className="size-5 animate-spin mx-auto mb-1.5" /><p className="text-[11px]">{t.status === "pending" ? "排队中…" : "AI 绘制中…"}</p></div>
                    )}
                  </div>
                  {/* 操作 */}
                  {svg && (
                    <div className="flex items-center justify-end gap-1 px-2 py-1.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => copySvg(t)} title="复制源码">{copiedId === t.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => downloadSvg(t)} title="下载 SVG"><Download className="size-3.5" /></Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 我的矢量历史 */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className={`${heading.className} text-sm font-semibold`}>我的矢量历史</h2>
            {history.length > 0 && <span className="text-[11px] text-muted-foreground">{history.length} 条</span>}
          </div>
          {histLoading ? (
            <div className="py-10 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin mx-auto" /></div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground/50 text-xs">还没有生成记录</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {history.map(h => {
                const svg = h.image_b64 || "";
                const ok = h.status === "completed" && svg.includes("<svg");
                return (
                  <div key={h.id} className="group rounded-xl border bg-card overflow-hidden flex flex-col">
                    <div className="relative h-40 flex items-center justify-center p-3 overflow-hidden border-b bg-muted/20">
                      {ok ? (
                        <div onClick={() => setLightbox(svg)} title="点击放大" className="relative w-full h-full cursor-zoom-in [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full" dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }} />
                      ) : (
                        <div className="text-center text-muted-foreground/50"><AlertCircle className="size-5 mx-auto mb-1" /><p className="text-[10px]">{h.status === "failed" ? "生成失败" : "无效"}</p></div>
                      )}
                      {/* hover 操作 */}
                      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {ok && (
                          <>
                            <button onClick={() => { navigator.clipboard.writeText(svg); setCopiedId(h.id); setTimeout(() => setCopiedId(null), 1500); }} className="size-6 rounded-md bg-background/90 border flex items-center justify-center hover:text-fuchsia-500" title="复制">{copiedId === h.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}</button>
                            <button onClick={() => { const b = new Blob([svg], { type: "image/svg+xml" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `vector-${h.id}.svg`; a.click(); URL.revokeObjectURL(u); }} className="size-6 rounded-md bg-background/90 border flex items-center justify-center hover:text-fuchsia-500" title="下载"><Download className="size-3" /></button>
                          </>
                        )}
                        <button onClick={() => delHistory(h.id)} className="size-6 rounded-md bg-background/90 border flex items-center justify-center hover:text-red-500" title="删除"><X className="size-3" /></button>
                      </div>
                    </div>
                    <p className="px-2.5 py-2 text-[11px] text-muted-foreground line-clamp-2" title={h.prompt}>{h.prompt}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 大图查看（灯箱） */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 sm:p-12">
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" title="关闭 (Esc)"><X className="size-5" /></button>
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-8 shadow-2xl w-[min(86vw,86vh)] h-[min(86vw,86vh)] flex items-center justify-center [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full"
            dangerouslySetInnerHTML={{ __html: sanitizeSVG(lightbox) }}
          />
        </div>
      )}
    </div>
  );
}
