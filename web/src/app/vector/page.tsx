"use client";

import { useState, useRef, useEffect } from "react";
import { Outfit, DM_Mono } from "next/font/google";
import { Shapes, Sparkles, Download, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { BASE, getToken } from "@/lib/api";
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

export default function VectorPage() {
  const [prompt, setPrompt] = useState("");
  const [raw, setRaw] = useState("");        // 流式累积原文
  const [svg, setSvg] = useState("");        // 最终 SVG
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const previewSvg = svg || extractSVG(raw);

  const generate = async () => {
    const p = prompt.trim();
    if (!p || loading) return;
    setLoading(true); setError(""); setRaw(""); setSvg("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${BASE}/api/vector`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
        body: JSON.stringify({ prompt: p }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.message || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      const handleBlock = (block: string) => {
        const ev = /event: (\w+)/.exec(block)?.[1];
        const dataLine = block.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) return;
        const payload = JSON.parse(dataLine.slice(6));
        if (ev === "delta") { acc += payload.text || ""; setRaw(acc); }
        else if (ev === "done") { setSvg(payload.svg || ""); setRaw(payload.raw || acc); }
        else if (ev === "error") { throw new Error(payload.message || "生成失败"); }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() || "";
        for (const block of blocks) handleBlock(block);
      }
      // 收尾：flush 残留（防最后一个 done 事件未被分块切出）
      if (buf.trim()) handleBlock(buf);
    } catch (e: any) {
      if (e.name !== "AbortError") { setError(e.message || "生成失败"); toast.error(e.message || "生成失败"); }
    }
    setLoading(false);
  };

  const copySvg = () => {
    navigator.clipboard.writeText(previewSvg);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const downloadSvg = () => {
    const blob = new Blob([previewSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vector-${Date.now()}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`${heading.variable} ${mono.variable} min-h-screen bg-background`}>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-2xl bg-fuchsia-500/10 flex items-center justify-center">
            <Shapes className="size-5 text-fuchsia-500" />
          </div>
          <div>
            <h1 className={`${heading.className} text-xl font-bold tracking-tight`}>AI 矢量图生成</h1>
            <p className="text-xs text-muted-foreground mt-0.5">描述你想要的图形，AI 生成可缩放的 SVG 矢量代码</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* 输入 */}
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="例如：一个简约的蓝色火箭图标，扁平风格"
              rows={5}
              maxLength={2000}
              className="w-full rounded-xl border bg-card px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-fuchsia-500/20"
            />
            <Button onClick={generate} disabled={loading || !prompt.trim()} className="w-full h-11 gap-2 bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:brightness-110">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {loading ? "生成中…" : "生成矢量图"}
            </Button>
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {/* SVG 源码 */}
            {(previewSvg || (loading && raw)) && (
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                  <span className="text-[11px] font-medium text-muted-foreground">SVG 源码</span>
                  {previewSvg && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={copySvg} title="复制">{copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</Button>
                      <Button variant="ghost" size="icon-sm" onClick={downloadSvg} title="下载"><Download className="size-3.5" /></Button>
                    </div>
                  )}
                </div>
                <pre className={`${mono.className} text-[11px] leading-relaxed p-3 max-h-72 overflow-auto whitespace-pre-wrap break-all`}>{previewSvg || raw}</pre>
              </div>
            )}
          </div>

          {/* 预览 */}
          <div className="rounded-xl border bg-card flex items-center justify-center p-6 h-[420px] relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle,currentColor_1px,transparent_1px)] [background-size:16px_16px]" />
            {previewSvg ? (
              <div
                className="relative w-full h-full [&>svg]:!w-full [&>svg]:!h-full [&>svg]:!max-w-full [&>svg]:!max-h-full"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            ) : loading ? (
              <div className="text-center text-muted-foreground"><Loader2 className="size-6 animate-spin mx-auto mb-2" /><p className="text-xs">AI 正在绘制…</p></div>
            ) : (
              <div className="text-center text-muted-foreground/50"><Shapes className="size-10 mx-auto mb-2" /><p className="text-xs">矢量图预览区</p></div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
