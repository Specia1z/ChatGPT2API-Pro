"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Download, Copy, Check, Loader2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { BASE, getToken, api } from "@/lib/api";
import { sanitizeSVG } from "@/lib/sanitize";
import { formatTime } from "@/lib/utils";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";

// 从流式原文里尽量提取 <svg> 片段用于实时预览（未闭合时返回空）
function extractSVG(s: string): string {
  const lo = s.indexOf("<svg");
  const hi = s.lastIndexOf("</svg>");
  if (lo >= 0 && hi > lo) return s.slice(lo, hi + 6);
  return "";
}

type Task = {
  id: number;
  prompt: string;       // 本次任务的提示词（多张并发时区分）
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
    const init: Task[] = Array.from({ length: count }, (_, i) => ({ id: Date.now() + i, prompt: p, raw: "", svg: "", status: "pending" }));
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
    <div className="min-h-screen bg-[#fbfbfd] dark:bg-[#06070d] pb-16 md:pb-0">
      <Navbar />

      {/* ════ 流体头部：与主页/灵感广场同一套视觉语言 ════ */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-6%] w-[42vw] h-[42vw] rounded-full blur-[110px] opacity-45 dark:opacity-50 mix-blend-multiply dark:mix-blend-screen bg-[#e879f9] [will-change:transform]" style={{ animation: "fluidC 18s ease-in-out infinite" }} />
          <div className="absolute top-[-6%] right-[-4%] w-[38vw] h-[38vw] rounded-full blur-[110px] opacity-40 dark:opacity-45 mix-blend-multiply dark:mix-blend-screen bg-[#6366f1] [will-change:transform]" style={{ animation: "fluidB 20s ease-in-out infinite" }} />
          <div className="absolute top-[8%] left-1/3 w-[36vw] h-[36vw] rounded-full blur-[110px] opacity-35 dark:opacity-40 mix-blend-multiply dark:mix-blend-screen bg-[#22d3ee] [will-change:transform]" style={{ animation: "fluidA 22s ease-in-out infinite" }} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[#fbfbfd] dark:to-[#06070d]" />
        </div>
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

        <div className="relative max-w-3xl mx-auto px-6 pt-16 sm:pt-20 pb-8 text-center">
          <span style={{ animationDelay: "0.05s" }} className="fade-up-anim inline-flex items-center gap-2 rounded-full border border-zinc-900/10 dark:border-white/15 bg-white/50 dark:bg-white/[0.06] px-4 py-1.5 backdrop-blur-md text-[11px] font-medium text-zinc-600 dark:text-white/70 tracking-[0.14em] uppercase mb-6">
            <Sparkles className="w-3 h-3" />
            AI Vector
          </span>
          <h1 style={{ animationDelay: "0.15s" }} className="fade-up-anim text-4xl sm:text-5xl md:text-[3.5rem] font-bold tracking-[-0.03em] leading-[1.05] text-zinc-900 dark:text-white mb-4 [text-wrap:balance]">
            AI 矢量图生成
          </h1>
          <p style={{ animationDelay: "0.25s" }} className="fade-up-anim text-base sm:text-lg text-zinc-500 dark:text-white/55 leading-relaxed max-w-xl mx-auto">
            描述图形，AI 生成可缩放的 SVG 矢量代码，支持并发批量
          </p>
        </div>
      </div>

      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        {/* 输入区 — 玻璃拟态卡 */}
        <div style={{ animationDelay: "0.35s" }} className="fade-up-anim rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl p-4 sm:p-5 space-y-3 mb-8">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="例如：一个简约的蓝色火箭图标，扁平风格"
            rows={3}
            maxLength={2000}
            className="w-full rounded-xl border border-zinc-900/[0.08] dark:border-white/10 bg-white/60 dark:bg-white/[0.04] px-4 py-3 text-sm outline-none resize-none transition-all focus:border-zinc-900/20 dark:focus:border-white/25 focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-white/10 placeholder:text-zinc-400 dark:placeholder:text-white/30"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500 dark:text-white/50">生成数量</span>
              {COUNTS.map(c => (
                <button key={c} onClick={() => setCount(c)} disabled={loading}
                  className={`size-8 rounded-lg text-xs font-semibold border transition-all ${count === c ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent" : "border-zinc-900/10 dark:border-white/15 text-zinc-500 dark:text-white/55 hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.06]"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {loading
              ? <Button onClick={cancel} variant="outline" className="h-11 gap-2 rounded-full"><X className="size-4" /> 取消</Button>
              : <Button onClick={generate} disabled={!prompt.trim()} className="h-11 gap-2 px-7 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50">
                  <Sparkles className="size-4" /> 生成矢量图
                </Button>}
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-white/35">每张消耗与生图相同的令牌；并发数受套餐并发上限约束，超出部分自动排队重试。</p>
        </div>

        {/* 结果网格 */}
        {tasks.length > 0 && (
          <div className={`grid ${gridCols} gap-4`}>
            {tasks.map((t, i) => {
              const svg = svgOf(t);
              return (
                <div key={t.id} className="fade-up-anim rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl overflow-hidden flex flex-col" style={{ animationDelay: `${i * 60}ms` }}>
                  {/* 预览 */}
                  <div className="relative h-56 flex items-center justify-center p-4 overflow-hidden border-b border-zinc-900/[0.06] dark:border-white/10">
                    <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle,currentColor_1px,transparent_1px)] [background-size:16px_16px]" />
                    {svg ? (
                      <div onClick={() => setLightbox(svg)} title="点击放大" className="relative w-full h-full cursor-zoom-in [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full" dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }} />
                    ) : t.status === "error" ? (
                      <div className="text-center text-red-500"><AlertCircle className="size-6 mx-auto mb-1.5" /><p className="text-[11px] px-3">{t.error}</p></div>
                    ) : (
                      <div className="text-center text-zinc-400 dark:text-white/40"><Loader2 className="size-5 animate-spin mx-auto mb-1.5" /><p className="text-[11px]">{t.status === "pending" ? "排队中…" : "AI 绘制中…"}</p></div>
                    )}
                  </div>
                  {/* 操作 + 提示词 */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <p className="flex-1 min-w-0 text-[11px] text-zinc-500 dark:text-white/50 line-clamp-1" title={t.prompt}>{t.prompt}</p>
                    {svg && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon-sm" onClick={() => copySvg(t)} title="复制源码">{copiedId === t.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => downloadSvg(t)} title="下载 SVG"><Download className="size-3.5" /></Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 我的矢量历史 */}
        <div style={{ animationDelay: "0.45s" }} className="fade-up-anim mt-12">
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">我的矢量历史</h2>
            {history.length > 0 && <span className="text-[11px] text-zinc-400 dark:text-white/40">{history.length} 条</span>}
          </div>
          {histLoading ? (
            <div className="py-10 text-center text-zinc-400 dark:text-white/40"><Loader2 className="size-5 animate-spin mx-auto" /></div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-zinc-400/70 dark:text-white/30 text-xs">还没有生成记录</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {history.map((h, i) => {
                const svg = h.image_b64 || "";
                const ok = h.status === "completed" && svg.includes("<svg");
                return (
                  <div key={h.id} className="fade-up-anim group rounded-2xl border border-zinc-900/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl overflow-hidden flex flex-col hover:bg-white/80 dark:hover:bg-white/[0.06] transition-colors" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                    <div className="relative h-40 flex items-center justify-center p-3 overflow-hidden border-b border-zinc-900/[0.06] dark:border-white/10">
                      {ok ? (
                        <div onClick={() => setLightbox(svg)} title="点击放大" className="relative w-full h-full cursor-zoom-in [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full" dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }} />
                      ) : (
                        <div className="text-center text-zinc-400/60 dark:text-white/30"><AlertCircle className="size-5 mx-auto mb-1" /><p className="text-[10px]">{h.status === "failed" ? "生成失败" : "无效"}</p></div>
                      )}
                      {/* hover 操作 */}
                      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {ok && (
                          <>
                            <button onClick={() => { navigator.clipboard.writeText(svg); setCopiedId(h.id); setTimeout(() => setCopiedId(null), 1500); }} className="size-6 rounded-full bg-white/90 dark:bg-zinc-900/90 border border-zinc-900/10 dark:border-white/15 backdrop-blur-md flex items-center justify-center text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white" title="复制">{copiedId === h.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}</button>
                            <button onClick={() => { const b = new Blob([svg], { type: "image/svg+xml" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `vector-${h.id}.svg`; a.click(); URL.revokeObjectURL(u); }} className="size-6 rounded-full bg-white/90 dark:bg-zinc-900/90 border border-zinc-900/10 dark:border-white/15 backdrop-blur-md flex items-center justify-center text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white" title="下载"><Download className="size-3" /></button>
                          </>
                        )}
                        <button onClick={() => delHistory(h.id)} className="size-6 rounded-full bg-white/90 dark:bg-zinc-900/90 border border-zinc-900/10 dark:border-white/15 backdrop-blur-md flex items-center justify-center text-zinc-600 dark:text-white/70 hover:text-red-500" title="删除"><X className="size-3" /></button>
                      </div>
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="text-[11px] text-zinc-600 dark:text-white/60 line-clamp-2 leading-relaxed" title={h.prompt}>{h.prompt}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-zinc-400 dark:text-white/35">
                        {h.model && <span className="inline-flex items-center rounded bg-zinc-900/[0.05] dark:bg-white/[0.08] px-1.5 py-0.5 font-medium truncate max-w-[60%]">{h.model}</span>}
                        {h.created_at && <span className="truncate">{formatTime(h.created_at)}</span>}
                      </div>
                    </div>
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
