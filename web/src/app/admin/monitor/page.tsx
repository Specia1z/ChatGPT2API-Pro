"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Play, Save, Trash2, Clock, Gauge, Settings2,
  PanelRightClose, PanelRightOpen, CheckCircle, XCircle,
  AlertTriangle, Terminal, RefreshCw, Eraser, ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { api, getToken, BASE } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── 常量 ─────────────────────────────────── */
const LOG_LEVELS = ["all", "green", "yellow", "red"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const levelConfig: Record<string, { icon: any; fill: string; label: string }> = {
  green:  { icon: CheckCircle, fill: "#34d399", label: "成功" },
  yellow: { icon: AlertTriangle, fill: "#fbbf24", label: "警告" },
  red:    { icon: XCircle, fill: "#f87171", label: "错误" },
  info:   { icon: Terminal, fill: "#a1a1aa", label: "信息" },
};

/* ── 配置开关行 ─────────────────────────────── */
function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0 mr-4">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function MonitorPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [logFilter, setLogFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api("/api/monitor").then(r => { setCfg(r.data); setLoading(false); }); }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${BASE}/api/monitor/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          const reader = res.body?.getReader();
          if (!reader) break;
          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const lines = part.split("\n");
              let data = "";
              for (const line of lines) { if (!line.startsWith("event: ") && line.startsWith("data: ")) data = line.slice(6); }
              if (data) {
                try {
                  const obj = JSON.parse(data);
                  setLogs(prev => { const n = [...prev, obj]; return n.length > 300 ? n.slice(-300) : n; });
                  if (obj.text?.includes("检查完成")) setChecking(false);
                } catch {}
              }
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => { if (autoScroll) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [logs, autoScroll]);

  const save = async () => { try { await api("/api/monitor", { method: "POST", body: JSON.stringify(cfg) }); toast.success("配置已保存"); } catch (e: any) { toast.error(e.message); } };
  const trigger = async () => { if (checking) return; setChecking(true); try { await api("/api/monitor/trigger", { method: "POST" }); } catch { toast.error("触发失败"); setChecking(false); } };
  const update = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));

  const filteredLogs = useMemo(() => logFilter === "all" ? logs : logs.filter(l => l.level === logFilter), [logs, logFilter]);

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-8 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className={`${heading.className} text-base font-semibold tracking-tight flex items-center gap-2.5`}>
              账号监控
              {cfg?.enabled && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  <span className="relative flex size-1.5">
                    <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative rounded-full size-1.5 bg-emerald-500" />
                  </span>
                  运行中
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">自动健康检查 · 异常清理 · 智能补号</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={trigger} disabled={checking} className="gap-1.5 text-xs">
              {checking ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {checking ? "检查中..." : "立即检查"}
            </Button>
            <Button size="sm" onClick={save} className="gap-1.5 text-xs">
              <Save className="size-3.5" /> 保存配置
            </Button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* ═══ 左侧：配置面板 ═══ */}
          <motion.div className="flex-1 p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">

              {/* 监控配置 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
                <div className="px-5 py-3.5 border-b flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Gauge className="size-4 text-emerald-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>监控配置</h2>
                </div>
                <div className="px-5 py-1">
                  <ToggleRow label="启用自动监控" desc="定时检查所有账号健康状态" checked={cfg?.enabled} onChange={v => update("enabled", v)} />
                  <div className="border-t" />
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2.5">
                      <Clock className="size-3.5 text-blue-500" />
                      <div>
                        <p className="text-xs font-medium">检查间隔</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">分钟</p>
                      </div>
                    </div>
                    <Input type="number" min={1} max={1440} value={cfg?.interval_minutes || 10}
                      onChange={e => update("interval_minutes", +e.target.value)} className="w-20 text-xs text-center" />
                  </div>
                </div>
              </motion.div>

              {/* 自动清理 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
                <div className="px-5 py-3.5 border-b flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <Trash2 className="size-4 text-red-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>自动清理</h2>
                </div>
                <div className="px-5 py-1">
                  <ToggleRow label="删除异常账号" desc="自动移除状态为「异常」的账号" checked={cfg?.auto_remove_abnormal} onChange={v => update("auto_remove_abnormal", v)} />
                  <div className="border-t" />
                  <ToggleRow label="删除禁用/封禁账号" desc="自动移除被禁用或 401 封禁的账号" checked={cfg?.auto_remove_disabled} onChange={v => update("auto_remove_disabled", v)} />
                </div>
              </motion.div>

              {/* 智能补号 */}
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
                <div className="px-5 py-3.5 border-b flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Settings2 className="size-4 text-blue-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>智能补号</h2>
                </div>
                <div className="px-5 py-1">
                  <ToggleRow label="自动补注册" desc="可用账号低于目标时自动触发注册机补号" checked={cfg?.auto_refill} onChange={v => update("auto_refill", v)} />
                  {cfg?.auto_refill && (
                    <>
                      <div className="border-t" />
                      <div className="grid grid-cols-2 gap-3 py-3">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">补号模式</label>
                          <select value={cfg?.refill_mode || "total"} onChange={e => update("refill_mode", e.target.value)}
                            className="w-full h-8 rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/20">
                            <option value="total">按总数</option>
                            <option value="available">按可用数</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">目标数量</label>
                          <Input type="number" min={1} value={cfg?.refill_target || 10} onChange={e => update("refill_target", +e.target.value)} className="text-xs" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* ═══ 右侧：终端控制台 ═══ */}
          {consoleOpen ? (
            <div className="w-[400px] shrink-0 border-l flex flex-col bg-zinc-950">
              {/* 控制台头部 */}
              <div className="h-11 flex items-center gap-2 px-4 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-red-500/80" />
                  <div className="size-2.5 rounded-full bg-amber-500/80" />
                  <div className={`size-2.5 rounded-full ${cfg?.enabled ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-zinc-600"}`} />
                </div>
                <span className={`${mono.className} text-[11px] text-zinc-400 ml-2`}>
                  {cfg?.enabled ? "monitor.log — 运行中" : "monitor.log — 已停止"}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  {LOG_LEVELS.map(level => (
                    <button key={level} onClick={() => setLogFilter(level)}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors font-medium ${
                        logFilter === level ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                      }`}>
                      {level === "all" ? "全部" : levelConfig[level]?.label}
                    </button>
                  ))}
                  <button onClick={() => setConsoleOpen(false)} className="p-1 rounded hover:bg-zinc-800 transition-colors ml-1">
                    <PanelRightClose className="size-3.5 text-zinc-500" />
                  </button>
                </div>
              </div>

              {/* 工具行 */}
              <div className="h-8 flex items-center gap-2 px-4 border-b border-zinc-800/60 shrink-0">
                <button onClick={() => setAutoScroll(!autoScroll)}
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors font-medium ${autoScroll ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>
                  <ArrowDownToLine className="size-3" /> 自动滚动
                </button>
                <button onClick={() => setLogs([])} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Eraser className="size-3" /> 清空
                </button>
                <span className={`${mono.className} text-[10px] text-zinc-600 tabular-nums ml-auto`}>{filteredLogs.length} 行</span>
              </div>

              {/* 日志 */}
              <div ref={logRef} className="flex-1 overflow-auto scrollbar-thin"
                onScroll={e => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
                  if (!atBottom && autoScroll) setAutoScroll(false);
                  if (atBottom && !autoScroll) setAutoScroll(true);
                }}>
                <div className={`${mono.className} p-2.5 space-y-px`}>
                  {filteredLogs.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-20">
                      <Terminal className="size-8 text-zinc-700" />
                      <p className="text-[11px] text-zinc-500">{logs.length === 0 ? "等待监控事件..." : "无匹配日志"}</p>
                    </div>
                  ) : filteredLogs.map((l, i) => {
                    const lc = levelConfig[l.level] || levelConfig.info;
                    return (
                      <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded transition-colors ${
                        l.level === "red" ? "bg-red-500/5" : l.level === "yellow" ? "bg-amber-500/5" : ""
                      } ${i === filteredLogs.length - 1 ? "animate-[slideIn_0.25s_ease-out]" : ""}`}>
                        <span className="text-[10px] text-zinc-600 shrink-0 w-9 pt-px tabular-nums">{l.time}</span>
                        <lc.icon className="size-3 shrink-0 mt-px" style={{ color: lc.fill }} />
                        <span className="text-[11px] leading-relaxed break-all" style={{ color: lc.fill }}>
                          {l.text}
                          {l.email && <span className="text-zinc-500 ml-1.5">{l.email}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => setConsoleOpen(true)}
              className="shrink-0 border-l flex flex-col items-center gap-2 pt-4 w-11 bg-card hover:bg-muted/40 transition-colors">
              <PanelRightOpen className="size-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground" style={{ writingMode: "vertical-rl" }}>实时日志</span>
              <span className={`${mono.className} text-[10px] text-muted-foreground tabular-nums`}>{logs.length}</span>
            </button>
          )}
        </div>
      </main>

      <style jsx global>{`@keyframes slideIn { 0% { opacity: 0; transform: translateY(-4px); } 100% { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
