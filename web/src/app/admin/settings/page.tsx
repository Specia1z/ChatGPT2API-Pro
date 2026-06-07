"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Globe, Shield, Save, Gauge, Gift, CreditCard, Database, Users, Activity, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 分类锚点 ─────────────────────────────── */
const SECTIONS = [
  { id: "site", label: "站点信息", icon: Globe, color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "checkin", label: "每日签到", icon: Gift, color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "invite", label: "邀请裂变", icon: Users, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { id: "security", label: "安全验证", icon: Shield, color: "text-primary", bg: "bg-primary/10" },
  { id: "scheduler", label: "生图调度", icon: Gauge, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "apirate", label: "API 限速", icon: Activity, color: "text-rose-500", bg: "bg-rose-500/10" },
  { id: "perf", label: "性能调优", icon: Rocket, color: "text-orange-500", bg: "bg-orange-500/10" },
  { id: "payment", label: "支付配置", icon: CreditCard, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { id: "storage", label: "存储清理", icon: Database, color: "text-violet-500", bg: "bg-violet-500/10" },
];

/* ── 开关行 ─────────────────────────────────── */
function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0 mr-4">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ── 配置卡 ─────────────────────────────────── */
function Card({ id, icon: Icon, color, bg, title, desc, action, children }: {
  id: string; icon: any; color: string; bg: string; title: string; desc: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <motion.section id={id} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="scroll-mt-6 rounded-2xl border bg-card overflow-hidden">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
        <div className={`size-8 sm:size-9 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`size-4 sm:size-[18px] ${color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={`${heading.className} text-sm font-semibold`}>{title}</h2>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </motion.section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-muted-foreground">{children}</label>;
}

/* ── 主页面 ─────────────────────────────────── */
export default function SettingsPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [schedCfg, setSchedCfg] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSched, setSavingSched] = useState(false);
  const [activeSection, setActiveSection] = useState("site");

  useEffect(() => {
    Promise.all([api("/api/settings"), api("/api/admin/scheduler/config"), api("/api/admin/plans")])
      .then(([r1, r2, r3]) => { setCfg(r1.data); setSchedCfg(r2.data); setPlans(r3.data || []); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api("/api/settings", { method: "POST", body: JSON.stringify(cfg) }); toast.success("站点设置已保存"); }
    catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };
  const saveScheduler = async () => {
    const g = +schedCfg.global_max, u = +schedCfg.per_user_max;
    if (g < 1 || u < 1) { toast.error("并发上限必须 ≥ 1"); return; }
    if (u > g) { toast.error("单用户上限不能超过全局上限"); return; }
    setSavingSched(true);
    try { await api("/api/admin/scheduler/config", { method: "POST", body: JSON.stringify({ max_global: g, max_per_user: u }) }); toast.success("调度器配置已更新"); }
    catch (e: any) { toast.error(e.message); }
    setSavingSched(false);
  };
  const update = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));
  // 邀请配置是 JSON 字符串字段：解析为对象编辑，改后序列化回 cfg.invite_config
  const inviteCfg = (() => { try { return JSON.parse(cfg?.invite_config || "{}"); } catch { return {}; } })();
  const updateInvite = (k: string, v: any) => {
    const next = { ...inviteCfg, [k]: v };
    setCfg((p: any) => ({ ...p, invite_config: JSON.stringify(next) }));
  };
  const scrollTo = (id: string) => { setActiveSection(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const base = cfg?.checkin_base || 10;
  const bonus = cfg?.checkin_streak_bonus || 5;
  const inputCls = `${mono.className} text-sm`;
  const taCls = `${mono.className} w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20`;

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
            <h1 className={`${heading.className} text-base font-semibold tracking-tight`}>系统设置</h1>
            <p className="text-xs text-muted-foreground mt-0.5">站点信息 · 签到 · 安全 · 调度 · 支付 · 存储</p>
          </div>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5 text-xs">
            <Save className="size-3.5" /> {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>

        {/* ═══ 双栏：锚点导航 + 内容 ═══ */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[220px_1fr] min-h-0 overflow-hidden">

          {/* 左：分类导航 */}
          <nav className="hidden lg:block border-r bg-card/40 p-4 overflow-auto scrollbar-thin">
            <p className={`${heading.className} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-2`}>配置分类</p>
            <div className="space-y-1">
              {SECTIONS.map(s => (
                <button key={s.id} onClick={() => scrollTo(s.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${
                    activeSection === s.id ? "bg-card shadow-sm font-medium ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-card/60"
                  }`}>
                  <span className={`size-7 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                    <s.icon className={`size-3.5 ${s.color}`} />
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
          </nav>

          {/* 右：内容 */}
          <div className="overflow-auto scrollbar-thin p-6 lg:p-8">
            <div className="max-w-3xl space-y-5">
              {/* ═══ 站点信息 ═══ */}
              <Card id="site" icon={Globe} color="text-blue-500" bg="bg-blue-500/10" title="站点信息" desc="标题、描述、Logo 与默认套餐">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>站点标题</Label><Input value={cfg?.site_title || ""} onChange={e => update("site_title", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1.5"><Label>副标题</Label><Input value={cfg?.site_subtitle || ""} onChange={e => update("site_subtitle", e.target.value)} className="text-sm" /></div>
                  </div>
                  <div className="space-y-1.5"><Label>站点描述</Label>
                    <textarea value={cfg?.site_description || ""} onChange={e => update("site_description", e.target.value)} rows={2} className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>新用户默认套餐</Label>
                      <select value={cfg?.default_plan_id || 0} onChange={e => update("default_plan_id", +e.target.value)}
                        className="w-full h-8 rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                        <option value={0}>自动（首个免费套餐）</option>
                        {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}{!p.enabled ? " (禁用)" : ""}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5"><Label>站点 Logo 类型</Label>
                      <div className="flex gap-1.5">
                        {["text", "url", "upload"].map(t => (
                          <button key={t} onClick={() => update("site_logo_type", t)}
                            className={`flex-1 h-8 rounded-lg text-xs font-medium border transition-all ${
                              cfg?.site_logo_type === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                            }`}>{t === "text" ? "文本" : t === "url" ? "URL" : "上传"}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {cfg?.site_logo_type === "text" && (
                    <div className="space-y-1.5"><Label>Logo 文本</Label><Input value={cfg?.site_logo_text || "C2"} onChange={e => update("site_logo_text", e.target.value)} className={`${heading.className} text-sm font-bold`} maxLength={16} placeholder="C2" /></div>
                  )}
                  {cfg?.site_logo_type === "url" && (
                    <div className="space-y-1.5"><Label>图片 URL</Label><Input value={cfg?.site_logo_url || ""} onChange={e => update("site_logo_url", e.target.value)} className={inputCls} placeholder="https://example.com/logo.png" /></div>
                  )}
                  {cfg?.site_logo_type === "upload" && (
                    <div className="space-y-2">
                      <input type="file" accept="image/*" onChange={e => {
                        const file = e.target.files?.[0]; if (!file) return;
                        if (file.size > 512 * 1024) { toast.error("Logo 图片不能超过 512KB"); return; }
                        const reader = new FileReader(); reader.onload = () => update("site_logo_url", reader.result); reader.readAsDataURL(file);
                      }} className="w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70 transition-all" />
                      {cfg?.site_logo_url && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                          <img src={cfg.site_logo_url} alt="Logo" className="size-8 rounded object-contain bg-white" />
                          <span className="text-xs text-muted-foreground">已上传</span>
                          <button onClick={() => update("site_logo_url", "")} className="ml-auto text-xs text-destructive hover:underline">移除</button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5 pt-2 border-t"><Label>敏感词黑名单</Label>
                    <textarea value={cfg?.banned_words || ""} onChange={e => update("banned_words", e.target.value)} placeholder="一行一个或逗号分隔" rows={2} className={taCls} />
                  </div>
                </div>
              </Card>

              {/* ═══ 每日签到 ═══ */}
              <Card id="checkin" icon={Gift} color="text-amber-500" bg="bg-amber-500/10" title="每日签到" desc="用户每天签到获得积分奖励"
                action={<Switch checked={cfg?.checkin_enabled} onCheckedChange={v => update("checkin_enabled", v)} />}>
                {cfg?.checkin_enabled ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>基础积分</Label><Input type="number" value={cfg?.checkin_base || 10} onChange={e => update("checkin_base", +e.target.value)} className={inputCls} /></div>
                      <div className="space-y-1.5"><Label>连续奖励 / 天</Label><Input type="number" value={cfg?.checkin_streak_bonus || 5} onChange={e => update("checkin_streak_bonus", +e.target.value)} className={inputCls} /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[1, 3, 7].map(day => (
                        <div key={day} className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">第 {day} 天</div>
                          <div className={`${mono.className} text-lg font-bold text-amber-500 tabular-nums mt-0.5`}>+{base + day * bonus}</div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border pt-4 mt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-3">积分兑换突发令牌</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5"><Label>兑换比例（积分/个）</Label><Input type="number" min={1} value={cfg?.points_exchange_rate ?? 10} onChange={e => update("points_exchange_rate", +e.target.value)} className={inputCls} placeholder="10" />
                          <p className="text-[10px] text-muted-foreground">例如 10 = 10 积分换 1 个突发令牌</p>
                        </div>
                        <div className="space-y-1.5"><Label>大额赠送（≥50 个时）</Label><Input type="number" min={0} value={cfg?.points_exchange_bonus ?? 0} onChange={e => update("points_exchange_bonus", +e.target.value)} className={inputCls} placeholder="0" />
                          <p className="text-[10px] text-muted-foreground">每 50 个额外赠送 N 个</p>
                        </div>
                        <div className="space-y-1.5"><Label>突发令牌囤积上限</Label><Input type="number" min={0} value={cfg?.burst_token_cap ?? 0} onChange={e => update("burst_token_cap", +e.target.value)} className={inputCls} placeholder="0" />
                          <p className="text-[10px] text-muted-foreground">单用户突发令牌最多囤积数（0=不限），防止积分无限兑换额度</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">签到功能已关闭，开启后可配置积分奖励规则。</p>}
              </Card>

              {/* ═══ 邀请裂变 ═══ */}
              <Card id="invite" icon={Users} color="text-cyan-500" bg="bg-cyan-500/10" title="邀请裂变" desc="老用户邀请新用户，双方得积分奖励"
                action={<Switch checked={!!inviteCfg.enabled} onCheckedChange={v => updateInvite("enabled", v)} />}>
                {inviteCfg.enabled ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-3">注册奖励（被邀请人注册成功即发放）</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5"><Label>邀请人得积分</Label><Input type="number" min={0} value={inviteCfg.reward_reg_inviter ?? 0} onChange={e => updateInvite("reward_reg_inviter", +e.target.value)} className={inputCls} placeholder="0" /></div>
                        <div className="space-y-1.5"><Label>被邀请人得积分</Label><Input type="number" min={0} value={inviteCfg.reward_reg_invitee ?? 0} onChange={e => updateInvite("reward_reg_invitee", +e.target.value)} className={inputCls} placeholder="0" /></div>
                      </div>
                    </div>
                    <div className="border-t border-border pt-4">
                      <p className="text-xs font-medium text-muted-foreground mb-3">首充奖励（被邀请人首次付费订阅时发放）</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5"><Label>邀请人得积分</Label><Input type="number" min={0} value={inviteCfg.reward_recharge_inviter ?? 0} onChange={e => updateInvite("reward_recharge_inviter", +e.target.value)} className={inputCls} placeholder="0" /></div>
                        <div className="space-y-1.5"><Label>被邀请人得积分</Label><Input type="number" min={0} value={inviteCfg.reward_recharge_invitee ?? 0} onChange={e => updateInvite("reward_recharge_invitee", +e.target.value)} className={inputCls} placeholder="0" /></div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">防刷依赖现有「每 IP 每日注册上限」与邮箱验证；同一被邀请人仅奖励一次。</p>
                  </div>
                ) : <p className="text-sm text-muted-foreground">邀请活动已关闭，开启后用户中心将显示专属邀请链接。</p>}
              </Card>

              {/* ═══ 安全验证 ═══ */}
              <Card id="security" icon={Shield} color="text-primary" bg="bg-primary/10" title="安全验证" desc="Cloudflare Turnstile 人机验证"
                action={<Switch checked={cfg?.cf_turnstile_enabled} onCheckedChange={v => update("cf_turnstile_enabled", v)} />}>
                {cfg?.cf_turnstile_enabled ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Site Key</Label><Input value={cfg?.cf_turnstile_site_key || ""} onChange={e => update("cf_turnstile_site_key", e.target.value)} className={inputCls} /></div>
                    <div className="space-y-1.5"><Label>Secret Key</Label><Input type="password" value={cfg?.cf_turnstile_secret_key || ""} onChange={e => update("cf_turnstile_secret_key", e.target.value)} className={inputCls} /></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">未启用人机验证，开启后登录注册需完成 Cloudflare Turnstile 验证。</p>}
              </Card>

              {/* ═══ 生图调度 ═══ */}
              <Card id="scheduler" icon={Gauge} color="text-emerald-500" bg="bg-emerald-500/10" title="生图调度器" desc="并发上限控制（需单独应用）"
                action={
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0" onClick={saveScheduler} disabled={savingSched}>
                    {savingSched ? <div className="size-3 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <Save className="size-3" />}
                    应用
                  </Button>
                }>
                {schedCfg && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "全局活跃", value: schedCfg.global_active, color: "text-emerald-500" },
                        { label: "活跃用户", value: schedCfg.active_users, color: "text-blue-500" },
                        { label: "总任务", value: schedCfg.total_active, color: "text-primary" },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl bg-muted/40 p-3 text-center">
                          <div className={`${mono.className} text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>
                    {[
                      { label: "全局并发上限", key: "global_max", hint: "全站同时进行的生图任务总数上限" },
                      { label: "单用户并发上限", key: "per_user_max", hint: "单用户同时进行的任务数上限（套餐 concurrency 更小时以套餐为准），不能超过全局上限" },
                    ].map(s => (
                      <div key={s.key} className="space-y-1.5">
                        <Label>{s.label}</Label>
                        <Input type="number" min={1} value={schedCfg[s.key]}
                          onChange={e => setSchedCfg((p: any) => ({ ...p, [s.key]: +e.target.value }))}
                          className={inputCls} />
                        <p className="text-[10px] text-muted-foreground">{s.hint}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ═══ API 访问限速 ═══ */}
              <Card id="apirate" icon={Activity} color="text-rose-500" bg="bg-rose-500/10" title="API 访问限速" desc="API Key 调用 /v1 接口的默认每分钟请求上限">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1.5">
                    <Label>默认限速（次/分钟）</Label>
                    <Input type="number" min={0} value={cfg?.default_rate_limit_per_min ?? 0} onChange={e => update("default_rate_limit_per_min", +e.target.value)} className={inputCls} placeholder="0" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    未单独配置 API 速率的套餐统一回退此值。0 = 使用内置兜底 30 次/分钟。优先级：套餐速率 &gt; 此默认值 &gt; 内置兜底。保存后即时生效，无需重启。
                  </div>
                </div>
              </Card>

              {/* ═══ 性能调优 ═══ */}
              <Card id="perf" icon={Rocket} color="text-orange-500" bg="bg-orange-500/10" title="性能调优" desc="高并发优化开关，全部 0 = 保持默认行为，保存即时生效">
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>配置缓存 TTL（秒）</Label>
                      <Input type="number" min={0} max={3600} value={cfg?.config_cache_ttl_seconds ?? 0} onChange={e => update("config_cache_ttl_seconds", +e.target.value)} className={inputCls} placeholder="0" />
                      <p className="text-[10px] text-muted-foreground">系统设置 / 存储配置的内存缓存秒数。0=每次查库。建议 5~10。改配置时自动失效，不会读到旧值。</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>公开接口缓存 TTL（秒）</Label>
                      <Input type="number" min={0} max={600} value={cfg?.public_cache_ttl_seconds ?? 0} onChange={e => update("public_cache_ttl_seconds", +e.target.value)} className={inputCls} placeholder="0" />
                      <p className="text-[10px] text-muted-foreground">套餐 / 画廊 / 公告 / 统计等公开接口的缓存秒数。0=不缓存。建议 10~30，抗匿名刷量。</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>API Key 使用时间写节流（秒）</Label>
                      <Input type="number" min={0} max={3600} value={cfg?.apikey_lastused_throttle_seconds ?? 0} onChange={e => update("apikey_lastused_throttle_seconds", +e.target.value)} className={inputCls} placeholder="0" />
                      <p className="text-[10px] text-muted-foreground">API Key「最后使用时间」最小写库间隔。0=每次都写。建议 60，削减高频调用的数据库随机写。</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>数据库最大连接数</Label>
                      <Input type="number" min={0} max={200} value={cfg?.db_max_open_conns ?? 0} onChange={e => update("db_max_open_conns", +e.target.value)} className={inputCls} placeholder="0" />
                      <p className="text-[10px] text-muted-foreground">0=内置默认 25，上限 200。⚠ 调大会增加内存占用，4G 机器谨慎，扩容后再上调。</p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* ═══ 支付配置 ═══ */}
              <Card id="payment" icon={CreditCard} color="text-cyan-500" bg="bg-cyan-500/10" title="支付宝付款" desc="在定价页显示支付宝购买入口"
                action={<Switch checked={cfg?.alipay_enabled} onCheckedChange={v => update("alipay_enabled", v)} />}>
                {cfg?.alipay_enabled ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>支付宝 APP ID</Label><Input value={cfg?.alipay_app_id || ""} onChange={e => update("alipay_app_id", e.target.value)} placeholder="202100..." className={inputCls} /></div>
                      <div className="space-y-1.5"><Label>异步通知 URL</Label><Input value={cfg?.alipay_notify_url || ""} onChange={e => update("alipay_notify_url", e.target.value)} placeholder="留空则使用轮询查询" className={inputCls} /></div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>应用私钥（RSA2）</Label><textarea value={cfg?.alipay_app_private_key || ""} onChange={e => update("alipay_app_private_key", e.target.value)} rows={4} placeholder="-----BEGIN RSA PRIVATE KEY-----" className={taCls} /></div>
                      <div className="space-y-1.5"><Label>支付宝公钥</Label><textarea value={cfg?.alipay_alipay_public_key || ""} onChange={e => update("alipay_alipay_public_key", e.target.value)} rows={4} placeholder="-----BEGIN PUBLIC KEY-----" className={taCls} /></div>
                    </div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">未启用支付宝支付，开启后用户可在定价页通过支付宝购买套餐。</p>}
              </Card>

              {/* ═══ 存储清理 ═══ */}
              <Card id="storage" icon={Database} color="text-violet-500" bg="bg-violet-500/10" title="存储清理" desc="定期清理过期的图片（本地与 S3 均适用）">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1.5">
                    <Label>文件保留天数</Label>
                    <Input type="number" min={0} max={365} value={cfg?.storage_cleanup_days ?? 0} onChange={e => update("storage_cleanup_days", +e.target.value)} className={inputCls} />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    {cfg?.storage_cleanup_days > 0
                      ? `超过 ${cfg.storage_cleanup_days} 天的图片将被自动删除（本地文件或 S3 对象），并一并删除数据库中对应的生成记录。已分享到广场的图片不受影响。`
                      : "当前设为 0，表示不自动清理。"}
                  </div>
                </div>
              </Card>

              <p className="text-xs text-muted-foreground text-center pb-2">站点设置统一保存 · 调度器配置需在对应卡片单独应用</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
