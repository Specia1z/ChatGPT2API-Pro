"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import {
  Save, Play, Square, Settings, Mail, Globe, Clock, Plus, Trash2,
  Terminal, CheckCircle, XCircle, TrendingUp, ChevronDown,
  AlertTriangle, Zap, Activity, Eraser, ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { api, getToken, BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };
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

/* ── 主页面 ─────────────────────────────────── */
export default function RegisterPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [liveStats, setLiveStats] = useState({ success: 0, fail: 0, done: 0, running: 0 });
  const [logFilter, setLogFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<number>>(new Set());
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const isRunning = cfg?.enabled;

  /* ── SSE ─────────────────────────────────── */
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${BASE}/api/register/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          const reader = res.body?.getReader();
          if (!reader) break;
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const lines = part.split("\n");
              let eventType = "", data = "";
              for (const line of lines) {
                if (line.startsWith("event: ")) eventType = line.slice(7);
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (eventType === "stats") { try { setLiveStats(JSON.parse(data)); } catch {} }
              else if (data) { try { setLogs(prev => { const next = [...prev, JSON.parse(data)]; return next.length > 300 ? next.slice(-300) : next; }); } catch {} }
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => { if (autoScroll) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [logs, autoScroll]);
  useEffect(() => { if (!getToken()) { router.push("/login"); return; } api("/api/register").then(r => { setCfg(r.data); setLoading(false); }); }, [router]);

  /* ── Actions ── */
  const save = async () => {
    setSaving(true);
    try { await api("/api/register", { method: "POST", body: JSON.stringify({ ...cfg, enabled: false }) }); toast.success("配置已保存"); }
    catch (e: any) { toast.error(e.message); } setSaving(false);
  };
  const start = async () => {
    const payload = { ...cfg, enabled: true, threads: cfg?.threads || 3, total: cfg?.total || 10, wait_timeout: cfg?.wait_timeout || 300 };
    await api("/api/register", { method: "POST", body: JSON.stringify(payload) });
    update("enabled", true); setLogs([]); toast.success("注册机已启动");
  };
  const stop = async () => {
    await api("/api/register", { method: "POST", body: JSON.stringify({ ...cfg, enabled: false }) });
    update("enabled", false); toast.success("注册机已停止");
  };
  const update = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));
  const updateProvider = (idx: number, k: string, v: any) => {
    setCfg((p: any) => { const mail = [...(p.mail_providers || [])]; mail[idx] = { ...mail[idx], [k]: v }; return { ...p, mail_providers: mail }; });
  };
  const addProvider = () => setCfg((p: any) => ({ ...p, mail_providers: [...(p.mail_providers || []), { provider: "cloudflare_temp_email", api_base: "", admin_password: "", domain: [""] }] }));
  const removeProvider = (idx: number) => setRemoveIndex(idx);
  const confirmRemoveProvider = () => {
    if (removeIndex === null) return;
    const idx = removeIndex;
    setCfg((p: any) => ({ ...p, mail_providers: (p.mail_providers || []).filter((_: any, i: number) => i !== idx) }));
    setCollapsedProviders(prev => { const n = new Set(prev); n.delete(idx); return n; });
    setRemoveIndex(null); toast.success("已移除邮箱提供商");
  };
  const toggleCollapse = (idx: number) => { setCollapsedProviders(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; }); };

  const filteredLogs = useMemo(() => logFilter === "all" ? logs : logs.filter(l => l.level === logFilter), [logs, logFilter]);

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-16 md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-start sm:items-center justify-between shrink-0 gap-2">
          <div>
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>注册机配置</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">管理邮箱提供商 · 批量注册 ChatGPT 账号</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {isRunning ? (
              <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 sm:px-2.5 py-1 rounded-full whitespace-nowrap">
                <span className="relative flex size-1.5 sm:size-2">
                  <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative rounded-full size-1.5 sm:size-2 bg-emerald-500" />
                </span>
                <span className="hidden sm:inline">运行中</span><span className="sm:hidden">运行</span>
              </span>
            ) : (
              <Badge variant="secondary" className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs whitespace-nowrap">
                <span className="size-1.5 rounded-full bg-muted-foreground" /> <span className="hidden sm:inline">已停止</span><span className="sm:hidden">停止</span>
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={save} disabled={saving} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <Save className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">{saving ? "保存中..." : "保存配置"}</span><span className="sm:hidden">保存</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* ═══ 左侧：设置面板 ═══ */}
          <motion.div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
            <div className="max-w-3xl space-y-6">

              {/* 实时统计 */}
              <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                {[
                  { label: "成功", value: liveStats.success, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                  { label: "失败", value: liveStats.fail, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
                  { label: "进行中", value: liveStats.running, icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: "已完成", value: liveStats.done, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
                ].map(item => (
                  <div key={item.label} className="rounded-xl border bg-card p-3 sm:p-4">
                    <div className={`size-7 sm:size-8 rounded-lg ${item.bg} flex items-center justify-center mb-1.5 sm:mb-2`}>
                      <item.icon className={`size-3.5 sm:size-4 ${item.color}`} />
                    </div>
                    <p className={`${mono.className} text-base sm:text-xl font-medium tabular-nums`}>{item.value.toLocaleString()}</p>
                    <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                  </div>
                ))}
              </motion.div>

              {/* 基础设置 + 注册控制 */}
              <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {/* 基础设置 */}
                <div className="rounded-2xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Settings className="size-4 text-blue-500" />
                    </div>
                    <h2 className={`${heading.className} text-sm font-semibold`}>基础设置</h2>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Globe className="size-3" /> 代理地址</label>
                      <Input value={cfg?.proxy || ""} onChange={e => update("proxy", e.target.value)} placeholder="http://127.0.0.1:10808" className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Clock className="size-3" /> 验证码超时 (秒)</label>
                      <Input type="number" value={cfg?.wait_timeout || 300} onChange={e => update("wait_timeout", +e.target.value)} className="text-xs" />
                    </div>
                  </div>
                </div>

                {/* 注册控制 */}
                <div className={`rounded-2xl border p-4 sm:p-5 relative overflow-hidden transition-all duration-500 bg-card ${isRunning ? "ring-1 ring-emerald-500/30 border-emerald-500/30" : ""}`}>
                  {isRunning && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse" />}
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`size-8 rounded-lg flex items-center justify-center ${isRunning ? "bg-emerald-500/10" : "bg-muted"}`}>
                      <Zap className={`size-4 ${isRunning ? "text-emerald-500" : "text-muted-foreground"}`} />
                    </div>
                    <h2 className={`${heading.className} text-sm font-semibold`}>注册控制</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4">
                    {[{ label: "注册总数", key: "total", val: cfg?.total || 10 }, { label: "并发线程", key: "threads", val: cfg?.threads || 3 }].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="text-xs text-muted-foreground">{f.label}</label>
                        <Input type="number" value={f.val} onChange={e => update(f.key, +e.target.value)} className="text-xs" />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">注册模式</label>
                      <select value={cfg?.mode || "total"} onChange={e => update("mode", e.target.value)}
                        className="w-full h-8 rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20">
                        <option value="total">按总数</option>
                        <option value="quota">按配额</option>
                        <option value="available">按可用数</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">检查间隔 (秒)</label>
                      <Input type="number" value={cfg?.check_interval || 5} onChange={e => update("check_interval", +e.target.value)} className="text-xs" />
                    </div>
                  </div>
                  {(cfg?.mode === "quota" || cfg?.mode === "available") && (
                    <div className="mb-4 space-y-1">
                      <label className="text-xs text-muted-foreground">{cfg?.mode === "quota" ? "目标配额" : "目标可用数"}</label>
                      <Input type="number" value={cfg?.mode === "quota" ? (cfg?.target_quota || 100) : (cfg?.target_available || 10)}
                        onChange={e => update(cfg?.mode === "quota" ? "target_quota" : "target_available", +e.target.value)} className="text-xs" />
                    </div>
                  )}
                  <div className="flex gap-1.5 sm:gap-2">
                    <Button onClick={start} disabled={isRunning} className="flex-1 gap-1 sm:gap-1.5 text-[10px] sm:text-xs"
                      style={{ backgroundColor: isRunning ? undefined : "#10b981" }}>
                      <Play className="size-3.5" /> 启动注册
                    </Button>
                    <Button variant="outline" onClick={stop} disabled={!isRunning} className="flex-1 gap-1.5 text-xs">
                      <Square className="size-3.5" /> 停止
                    </Button>
                  </div>
                </div>
              </motion.div>

              {/* ═══ 邮箱提供商 ═══ */}
              <motion.div variants={fadeUp}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Mail className="size-4 text-violet-500" />
                  </div>
                  <h2 className={`${heading.className} text-sm font-semibold`}>邮箱提供商</h2>
                  <Badge variant="outline" className="ml-1">{(cfg?.mail_providers || []).length} 个</Badge>
                </div>

                {(cfg?.mail_providers || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed flex flex-col items-center gap-3 py-14">
                    <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
                      <Mail className="size-5 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">尚未配置邮箱提供商</p>
                    <Button variant="outline" size="sm" onClick={addProvider} className="gap-1.5 text-xs">
                      <Plus className="size-3.5" /> 添加邮箱提供商
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cfg?.mail_providers.map((p: any, i: number) => (
                      <div key={i} className="rounded-2xl border bg-card overflow-hidden">
                        <button onClick={() => toggleCollapse(i)}
                          className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 hover:bg-muted/40 transition-colors text-left">
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                              <Mail className="size-4 text-violet-500" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Cloudflare Temp Email</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {p.domain?.length ? `${p.domain.length} 个域名` : "未配置域名"} · {p.api_base ? "API 已配置" : "待配置"}
                              </p>
                            </div>
                          </div>
                          <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ${collapsedProviders.has(i) ? "" : "rotate-180"}`} />
                        </button>
                        {!collapsedProviders.has(i) && (
                          <div className="px-4 sm:px-5 pb-4 space-y-3 border-t">
                            <div className="grid grid-cols-2 gap-2 sm:gap-3 pt-4">
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">API 地址</label>
                                <Input value={p.api_base || ""} onChange={e => updateProvider(i, "api_base", e.target.value)} placeholder="https://apimail.infiniio.com" className="text-xs" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">管理密码</label>
                                <Input type="password" value={p.admin_password || ""} onChange={e => updateProvider(i, "admin_password", e.target.value)} placeholder="••••••••" className="text-xs" />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">域名（逗号分隔）</label>
                              <Input value={(p.domain || []).join(",")} onChange={e => updateProvider(i, "domain", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="mail.example.com" className="text-xs" />
                            </div>
                            <div className="flex justify-end pt-1">
                              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive gap-1.5" onClick={() => removeProvider(i)}>
                                <Trash2 className="size-3.5" /> 移除
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addProvider} className="w-full gap-1.5 border-dashed text-xs">
                      <Plus className="size-3.5" /> 添加邮箱提供商
                    </Button>
                  </div>
                )}
              </motion.div>
            </div>
          </motion.div>

          {/* ═══ 终端：桌面侧栏 / 移动端抽屉 ═══ */}
          <div className={`
            flex flex-col bg-card min-h-0
            /* Desktop side panel：flex 流中的右侧栏 */
            lg:w-[400px] lg:shrink-0 lg:border-l
            /* Mobile bottom drawer：仅移动端做固定抽屉 */
            max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50
            max-lg:border-t max-lg:rounded-t-2xl max-lg:shadow-2xl
            max-lg:max-h-[70vh] max-lg:transition-transform max-lg:duration-300 max-lg:ease-in-out
            ${consoleOpen ? 'max-lg:translate-y-0' : 'max-lg:translate-y-full'}
          `}>
            {/* 拖拽手柄 — 移动端 */}
            <div className="flex lg:hidden items-center justify-center py-2 shrink-0 cursor-pointer" onClick={() => setConsoleOpen(false)}>
              <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* 控制台头部 */}
            <div className="h-11 flex items-center gap-2 px-4 border-b shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-full bg-red-500/80" />
                <div className="size-2.5 rounded-full bg-amber-500/80" />
                <div className={`size-2.5 rounded-full ${isRunning ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-muted-foreground/30"}`} />
              </div>
              <span className={`${mono.className} text-[11px] text-muted-foreground ml-2`}>
                {isRunning ? "register.log — 运行中" : "register.log — 已停止"}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                {LOG_LEVELS.map(level => (
                  <button key={level} onClick={() => setLogFilter(level)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors font-medium ${
                      logFilter === level ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground/70"
                    }`}>
                    {level === "all" ? "全部" : levelConfig[level]?.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 工具行 */}
            <div className="h-8 flex items-center gap-2 px-4 border-b shrink-0">
              <button onClick={() => setAutoScroll(!autoScroll)}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors font-medium ${autoScroll ? "text-emerald-400" : "text-muted-foreground hover:text-foreground/70"}`}>
                <ArrowDownToLine className="size-3" /> 自动滚动
              </button>
              <button onClick={() => setLogs([])} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground/70 transition-colors">
                <Eraser className="size-3" /> 清空
              </button>
              <span className={`${mono.className} text-[10px] text-muted-foreground/60 tabular-nums ml-auto`}>{filteredLogs.length} 行</span>
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
                    <Terminal className="size-8 text-muted-foreground/40" />
                    <p className="text-[11px] text-muted-foreground">{logs.length === 0 ? "等待注册事件..." : "无匹配日志"}</p>
                  </div>
                ) : filteredLogs.map((l, i) => {
                  const lc = levelConfig[l.level] || levelConfig.info;
                  return (
                    <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded transition-colors ${
                      l.level === "red" ? "bg-red-500/5" : l.level === "yellow" ? "bg-amber-500/5" : ""
                    } ${i === filteredLogs.length - 1 ? "animate-[slideIn_0.25s_ease-out]" : ""}`}>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0 w-9 pt-px tabular-nums">{l.time}</span>
                      <lc.icon className="size-3 shrink-0 mt-px" style={{ color: lc.fill }} />
                      <span className="text-[11px] leading-relaxed break-all" style={{ color: lc.fill }}>
                        {l.text}
                        {l.email && <span className="text-muted-foreground ml-1.5">{l.email}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 移动端 backdrop + 浮动按钮 */}
          {consoleOpen && (
            <div className="fixed inset-0 z-40 lg:hidden bg-black/30" onClick={() => setConsoleOpen(false)} />
          )}
          <button
            onClick={() => setConsoleOpen(!consoleOpen)}
            className="fixed bottom-4 right-4 z-50 lg:hidden size-11 rounded-full bg-card border shadow-lg flex items-center justify-center text-foreground/70 hover:text-white hover:bg-muted transition-colors"
          >
            <Terminal className="size-5" />
          </button>

      <style jsx global>{`@keyframes slideIn { 0% { opacity: 0; transform: translateY(-4px); } 100% { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
      </main>

      <ConfirmDialog open={removeIndex !== null} onOpenChange={() => setRemoveIndex(null)}
        title="移除邮箱提供商" description="确定要移除此邮箱提供商？此操作不可撤销，但可在保存前通过刷新页面恢复。"
        confirmLabel="移除" variant="destructive" onConfirm={confirmRemoveProvider} />
    </div>
  );
}
