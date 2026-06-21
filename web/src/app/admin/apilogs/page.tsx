"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Activity, CheckCircle2, AlertTriangle, Zap, ScrollText,
  Search, Pause, Play, Clock, Globe, Key, Hash, Timer,
} from "lucide-react";
import { BASE, getToken } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

const CARD = "rounded-2xl border bg-card";

// 端点标签
const EP_LABEL: Record<string, string> = {
  "images.generations": "生图",
  "images.query": "生图查询",
  "vector": "矢量生成",
  "image-to-text": "图生文",
  "image-enhance": "智能增强",
  "openai.images": "OpenAI 生图",
  "openai.models": "模型探测",
  "user.tokens": "令牌查询",
  "removebg": "背景移除",
};
const epLabel = (e: string) => EP_LABEL[e] || e;

// 状态码配色
function statusTone(code: number): string {
  if (code >= 200 && code < 300) return "text-emerald-600 dark:text-emerald-400";
  if (code === 429) return "text-amber-600 dark:text-amber-400";
  if (code >= 400) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
function statusBg(code: number): string {
  if (code >= 200 && code < 300) return "bg-emerald-500/10";
  if (code === 429) return "bg-amber-500/10";
  if (code >= 400) return "bg-red-500/10";
  return "bg-muted";
}

interface LogEntry {
  id: number;
  user_id?: number;
  user_email?: string;
  api_key_id: number;
  key_name: string;
  endpoint: string;
  ip: string;
  prompt?: string;
  image_url?: string;
  status_code: number;
  tokens_cost: number;
  latency_ms: number;
  created_at: string;
}
interface StatsData {
  total_calls: number; success_calls: number; failed_calls: number;
  rate_limited: number; total_tokens: number; active_users: number; active_keys: number;
}
const PAGE_SIZE = 20;

export default function AdminAPILogsPage() {
  // ── 实时状态 ──
  const [connected, setConnected] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const pausedRef = useRef(false);
  const liveContainerRef = useRef<HTMLDivElement>(null);

  // ── 历史查询 ──
  const [tab, setTab] = useState<"live" | "history">("live");
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [filterEmail, setFilterEmail] = useState("");
  const [filterEndpoint, setFilterEndpoint] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // ── SSE 连接 ──
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${BASE}/api/admin/api-logs/events`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const reader = res.body?.getReader();
          if (!reader) break;
          setConnected(true);

          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              let eventType = "";
              let data = "";
              for (const line of part.split("\n")) {
                if (line.startsWith("event: ")) eventType = line.slice(7);
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (!data) continue;
              try {
                const parsed = JSON.parse(data);
                if (eventType === "stats") {
                  setStats(parsed);
                } else if (eventType === "log" && !pausedRef.current) {
                  setLiveLogs(prev => {
                    const next = [parsed, ...prev];
                    if (next.length > 200) next.length = 200; // 保留最近 200 条
                    return next;
                  });
                }
              } catch (e) { console.error(e); }
            }
          }
        } catch (e) { if ((e as Error)?.name !== "AbortError") console.error(e); }
        if (!cancelled) setConnected(false);
        if (!cancelled) await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  // paused 同步到 ref（SSE 回调里读取）
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ── 历史查询 ──
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterEmail) params.set("email", filterEmail);
      if (filterEndpoint) params.set("endpoint", filterEndpoint);
      if (filterStatus) params.set("status", filterStatus);
      const token = getToken();
      const res = await fetch(`${BASE}/api/admin/api-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      setHistory(body.data?.items || []);
      setHistoryTotal(body.data?.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoadingHistory(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchHistory reads these deps; adding it would cause re-render churn
  useEffect(() => { if (tab === "history") fetchHistory(); }, [tab, page, filterEmail, filterEndpoint, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  // ── 自动滚动 ──
  useEffect(() => {
    if (tab === "live" && !paused && liveContainerRef.current) {
      liveContainerRef.current.scrollTop = 0;
    }
  }, [liveLogs, tab, paused]);

  // ── 共享日志行组件 ──
  const LogRow = ({ l, showUser }: { l: LogEntry; showUser?: boolean }) => (
    <div className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors text-[11px] sm:text-xs ${mono.className}`}>
      <span className="text-muted-foreground/70 shrink-0 w-12 sm:w-16 tabular-nums">{l.created_at?.slice(11) || l.created_at}</span>
      <span className="text-muted-foreground/80 shrink-0 w-16 sm:w-20 truncate" title={l.ip}>{l.ip || "—"}</span>
      {showUser && <span className="text-foreground/80 shrink-0 w-20 sm:w-28 truncate">{l.user_email || (l.user_id ? `#${l.user_id}` : "—")}</span>}
      <span className="text-foreground/70 shrink-0 w-16 sm:w-20 truncate">{epLabel(l.endpoint)}</span>
      <span className="text-muted-foreground/70 shrink-0 w-24 sm:w-32 truncate" title={l.prompt}>{l.prompt || "—"}</span>
      {l.image_url ? (
        <a href={l.image_url} target="_blank" rel="noreferrer" className="shrink-0 w-5 text-center" title={l.image_url}>
          <span className="text-[10px] text-primary/70 hover:text-primary">🖼</span>
        </a>
      ) : <span className="shrink-0 w-5" />}
      <span className={`shrink-0 w-8 text-right font-semibold ${statusTone(l.status_code)}`}>
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] ${statusBg(l.status_code)}`}>{l.status_code}</span>
      </span>
      <span className="text-muted-foreground/70 shrink-0 w-12 text-right tabular-nums">{l.latency_ms}ms</span>
      <span className="text-muted-foreground/70 shrink-0 w-10 text-right tabular-nums">{l.tokens_cost || "—"}</span>
      <span className="text-muted-foreground/50 shrink-0 w-16 truncate text-right">{l.key_name}</span>
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight flex items-center gap-2`}>
              API 调用日志
              <span className={`inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full ${connected ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "text-muted-foreground bg-muted"}`}>
                <span className="relative flex size-1.5">
                  {connected && <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative rounded-full size-1.5 ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                </span>
                {connected ? "实时" : "连接中"}
              </span>
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              实时监控全站 API 调用 · 已捕获 {liveLogs.length} 条实时日志
              {stats ? ` · 窗口调用 ${stats.total_calls}` : ""}
            </p>
          </div>
        </div>

        <motion.div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="space-y-3 sm:space-y-4 max-w-[1600px]">
            {/* ═══ KPI 卡片 ═══ */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
              {[
                { icon: Activity, label: "窗口调用", v: stats?.total_calls ?? "—", tone: "text-foreground" },
                { icon: CheckCircle2, label: "成功", v: stats?.success_calls ?? "—", tone: "text-emerald-600 dark:text-emerald-400" },
                { icon: AlertTriangle, label: "失败", v: stats?.failed_calls ?? "—", tone: "text-red-600 dark:text-red-400" },
                { icon: AlertTriangle, label: "429 限流", v: stats?.rate_limited ?? "—", tone: "text-amber-600 dark:text-amber-400" },
                { icon: Zap, label: "活跃 Key", v: stats?.active_keys ?? "—", tone: "text-violet-600 dark:text-violet-400" },
                { icon: ScrollText, label: "活跃用户", v: stats?.active_users ?? "—", tone: "text-cyan-600 dark:text-cyan-400" },
              ].map(k => (
                <motion.div key={k.label} variants={fadeUp} className={`${CARD} p-3 sm:p-4`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <k.icon className="size-3.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{k.label}</span>
                  </div>
                  <div className={`${mono.className} text-lg sm:text-xl font-semibold tabular-nums ${k.tone}`}>{k.v}</div>
                </motion.div>
              ))}
            </div>

            {/* ═══ Tab 切换 ═══ */}
            <div className="flex items-center gap-1 p-1 rounded-xl border bg-card w-fit">
              {[
                { key: "live", label: "实时流", icon: Activity },
                { key: "history", label: "历史明细", icon: Search },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key as "live" | "history")}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <t.icon className="size-3.5" />{t.label}
                </button>
              ))}
            </div>

            {/* ═══ 实时流 Tab ═══ */}
            {tab === "live" && (
              <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Activity className="size-4 text-emerald-500" /></div>
                    <span className="text-sm font-semibold">实时调用流</span>
                    <Badge variant="outline" className="tabular-nums">{liveLogs.length}</Badge>
                  </div>
                  <button onClick={() => setPaused(!paused)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${paused ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/5" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {paused ? <><Play className="size-3" />继续</> : <><Pause className="size-3" />暂停</>}
                  </button>
                </div>
                {/* 表头 */}
                <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 border-b border-border/30 bg-muted/30 text-[10px] text-muted-foreground">
                  <span className="shrink-0 w-12 sm:w-16"><Clock className="size-3 inline mr-1" />时间</span>
                  <span className="shrink-0 w-16 sm:w-20"><Globe className="size-3 inline mr-1" />IP</span>
                  <span className="shrink-0 w-20 sm:w-28">用户</span>
                  <span className="shrink-0 w-16 sm:w-20">端点</span>
                  <span className="shrink-0 w-24 sm:w-32">提示词</span>
                  <span className="shrink-0 w-5" />
                  <span className="shrink-0 w-8 text-right"><Hash className="size-3 inline" /></span>
                  <span className="shrink-0 w-12 text-right"><Timer className="size-3 inline mr-0.5" />耗时</span>
                  <span className="shrink-0 w-10 text-right">令牌</span>
                  <span className="shrink-0 w-16 text-right"><Key className="size-3 inline mr-0.5" />Key</span>
                </div>
                <div ref={liveContainerRef} className="overflow-y-auto max-h-[50vh] scrollbar-thin">
                  {liveLogs.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <Activity className="size-8 opacity-30" />
                      <p className="text-sm">等待 API 调用…</p>
                      <p className="text-xs text-muted-foreground/70">有 API Key 调用时将实时显示在这里</p>
                    </div>
                  ) : (
                    liveLogs.map((l, i) => <LogRow key={l.id || i} l={l} showUser />)
                  )}
                </div>
              </motion.div>
            )}

            {/* ═══ 历史明细 Tab ═══ */}
            {tab === "history" && (
              <motion.div variants={fadeUp} className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center"><Search className="size-4 text-muted-foreground" /></div>
                    <span className="text-sm font-semibold">历史明细</span>
                    <Badge variant="outline" className="tabular-nums">{historyTotal}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input placeholder="用户邮箱搜索…" value={filterEmail} onChange={e => { setFilterEmail(e.target.value); setPage(1); }}
                      className="h-8 rounded-xl text-xs w-36 sm:w-44" />
                    <Select value={filterEndpoint} onValueChange={v => { setFilterEndpoint(v as string); setPage(1); }}>
                      <SelectTrigger className="h-8 rounded-xl text-xs w-24"><SelectValue placeholder="端点" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        {Object.keys(EP_LABEL).map(e => <SelectItem key={e} value={e}>{epLabel(e)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={v => { setFilterStatus(v as string); setPage(1); }}>
                      <SelectTrigger className="h-8 rounded-xl text-xs w-20"><SelectValue placeholder="状态" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                        <SelectItem value="429">429</SelectItem>
                        <SelectItem value="400">400</SelectItem>
                        <SelectItem value="401">401</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {loadingHistory ? (
                  <div className="py-20 flex items-center justify-center text-muted-foreground">
                    <div className="size-5 border-2 border-muted border-t-primary rounded-full animate-spin mr-2" /> 加载中…
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Clock className="size-8 opacity-30" />
                    <p className="text-sm">暂无记录</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      {history.map(l => <LogRow key={l.id} l={l} showUser />)}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t">
                        <span className="text-[11px] text-muted-foreground">第 {page} / {totalPages} 页</span>
                        <div className="flex items-center gap-1.5">
                          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                            className="px-3 py-1.5 rounded-lg text-xs border text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground transition-colors">上一页</button>
                          <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            className="px-3 py-1.5 rounded-lg text-xs border text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground transition-colors">下一页</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
