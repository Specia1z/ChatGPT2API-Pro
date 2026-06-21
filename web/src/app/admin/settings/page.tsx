"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Globe, Shield, Save, Gauge, Gift, Database, Users, Activity, Rocket, Coins, Layers, Shapes, RefreshCw, ShoppingBag, Plus, Trash2, Upload, KeyRound, ShieldAlert } from "lucide-react";
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
  { id: "oauth", label: "第三方登录", icon: KeyRound, color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "scheduler", label: "生图调度", icon: Gauge, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "apirate", label: "API 限速", icon: Activity, color: "text-rose-500", bg: "bg-rose-500/10" },
  { id: "imgcost", label: "生图消耗", icon: Coins, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "upload", label: "图片上传", icon: Upload, color: "text-teal-500", bg: "bg-teal-500/10" },
  { id: "svg", label: "AI 矢量", icon: Shapes, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
  { id: "shop", label: "积分商城", icon: ShoppingBag, color: "text-pink-500", bg: "bg-pink-500/10" },
  { id: "freequota", label: "无套餐额度", icon: Layers, color: "text-sky-500", bg: "bg-sky-500/10" },
  { id: "perf", label: "性能调优", icon: Rocket, color: "text-orange-500", bg: "bg-orange-500/10" },
  { id: "storage", label: "存储清理", icon: Database, color: "text-violet-500", bg: "bg-violet-500/10" },
  { id: "risk", label: "风险评分", icon: ShieldAlert, color: "text-red-500", bg: "bg-red-500/10" },
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
  const [svgModels, setSvgModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const r = await api<any>("/api/admin/models");
      setSvgModels(r.data || []);
      toast.success(`获取到 ${r.data?.length || 0} 个模型`);
    } catch (e: any) { toast.error(e.message || "获取模型失败"); }
    setLoadingModels(false);
  };

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
    const g = +schedCfg.global_max, u = +schedCfg.per_user_max, a = +schedCfg.per_account_max;
    const at = Math.max(0, +schedCfg.max_attempts || 0);
    if (g < 1 || u < 1 || a < 1) { toast.error("并发上限必须 ≥ 1"); return; }
    if (u > g) { toast.error("单用户上限不能超过全局上限"); return; }
    setSavingSched(true);
    try { await api("/api/admin/scheduler/config", { method: "POST", body: JSON.stringify({ max_global: g, max_per_user: u, max_per_account: a, max_attempts: at }) }); toast.success("调度器配置已更新"); }
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
  // 第三方登录配置（oauth_config）同样是 JSON 字符串字段
  const oauthCfg = (() => { try { return JSON.parse(cfg?.oauth_config || "{}"); } catch { return {}; } })();
  const updateOAuth = (k: string, v: any) => {
    const next = { ...oauthCfg, [k]: v };
    setCfg((p: any) => ({ ...p, oauth_config: JSON.stringify(next) }));
  };
  const scrollTo = (id: string) => { setActiveSection(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  // 积分商城商品（shop_config 为 JSON 数组）
  const shopItems: any[] = (() => { try { const a = JSON.parse(cfg?.shop_config || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } })();
  const setShopItems = (items: any[]) => setCfg((p: any) => ({ ...p, shop_config: JSON.stringify(items) }));
  const addShopItem = () => setShopItems([...shopItems, { id: "item" + Date.now(), name: "新商品", plan_id: plans[0]?.id || 0, days: 30, points: 100, enabled: true }]);
  const updateShopItem = (i: number, k: string, v: any) => { const next = shopItems.map((it, idx) => idx === i ? { ...it, [k]: v } : it); setShopItems(next); };
  const removeShopItem = (i: number) => setShopItems(shopItems.filter((_, idx) => idx !== i));

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
                        <div className="space-y-1.5"><Label>大额赠送数量</Label><Input type="number" min={0} value={cfg?.points_exchange_bonus ?? 0} onChange={e => update("points_exchange_bonus", +e.target.value)} className={inputCls} placeholder="0" />
                          <p className="text-[10px] text-muted-foreground">每满「赠送阈值」个，额外赠送 N 个（0=不赠送）</p>
                        </div>
                        <div className="space-y-1.5"><Label>赠送阈值（个）</Label><Input type="number" min={0} value={cfg?.points_exchange_bonus_threshold ?? 0} onChange={e => update("points_exchange_bonus_threshold", +e.target.value)} className={inputCls} placeholder="50" />
                          <p className="text-[10px] text-muted-foreground">单次兑换满此数量才触发赠送（0=默认 50）</p>
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

              {/* ═══ 第三方登录（Linux Do Connect OAuth2）═══ */}
              <Card id="oauth" icon={KeyRound} color="text-amber-500" bg="bg-amber-500/10" title="Linux Do 登录" desc="第三方 OAuth2 登录（connect.linux.do）"
                action={<Switch checked={!!oauthCfg.linuxdo_enabled} onCheckedChange={v => updateOAuth("linuxdo_enabled", v)} />}>
                {oauthCfg.linuxdo_enabled ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Client ID</Label><Input value={oauthCfg.linuxdo_client_id || ""} onChange={e => updateOAuth("linuxdo_client_id", e.target.value)} className={inputCls} placeholder="connect.linux.do 应用 Client ID" /></div>
                      <div className="space-y-1.5"><Label>Client Secret</Label><Input type="password" value={oauthCfg.linuxdo_client_secret || ""} onChange={e => updateOAuth("linuxdo_client_secret", e.target.value)} className={inputCls} placeholder="留空则保留已保存的值" /></div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>最低信任等级（trust_level）</Label>
                      <Input type="number" min={0} max={4} value={oauthCfg.linuxdo_min_trust_level ?? 0} onChange={e => updateOAuth("linuxdo_min_trust_level", Math.max(0, Math.min(4, +e.target.value || 0)))} className={inputCls} />
                      <p className="text-[10px] text-muted-foreground">允许登录的最低 trust_level（0=不限制；Linux Do 为 0-4）。设为 1 可阻挡纯新号，2 则要求活跃成员。</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">回调地址：<span className={mono.className}>{typeof window !== "undefined" ? window.location.origin : ""}/api/auth/linuxdo/callback</span>（需在 Linux Do Connect 应用后台填写一致）</p>
                  </div>
                ) : <p className="text-sm text-muted-foreground">未开启第三方登录。开启后登录页将显示「Linux Do 登录」按钮。</p>}
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
                      { label: "单账号并发上限", key: "per_account_max", hint: "单个 ChatGPT 账号同时承载的生图任务数。调高可提升产能，但单账号并发过高易触发上游限流（默认 3）。实际产能 ≈ 此值 × 正常账号数，且不超过全局上限" },
                    ].map(s => (
                      <div key={s.key} className="space-y-1.5">
                        <Label>{s.label}</Label>
                        <Input type="number" min={1} value={schedCfg[s.key]}
                          onChange={e => setSchedCfg((p: any) => ({ ...p, [s.key]: +e.target.value }))}
                          className={inputCls} />
                        <p className="text-[10px] text-muted-foreground">{s.hint}</p>
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label>选号最大尝试数</Label>
                      <Input type="number" min={0} value={schedCfg.max_attempts ?? 0}
                        onChange={e => setSchedCfg((p: any) => ({ ...p, max_attempts: +e.target.value }))}
                        className={inputCls} placeholder="0" />
                      <p className="text-[10px] text-muted-foreground">生图选号时最多尝试几个账号（占满则跳下一个）。0 = 自动按号池大小（至多 30）。号池很大、并发很高时可适当调高，避免前 N 个账号都满时误判「无可用账号」。</p>
                    </div>
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

              {/* ═══ 生图消耗 ═══ */}
              <Card id="imgcost" icon={Coins} color="text-emerald-500" bg="bg-emerald-500/10" title="生图消耗" desc="生成图片扣除的令牌数量">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1.5">
                    <Label>每张图消耗令牌</Label>
                    <Input type="number" min={0} value={cfg?.tokens_per_image ?? 0} onChange={e => update("tokens_per_image", +e.target.value)} className={inputCls} placeholder="1" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    生成 1 张图扣除的令牌数。0 = 使用内置默认 1。调高则同等令牌额度下可生成的图片更少（如设为 2，则 50 令牌只能生成 25 张）。原生接口与 OpenAI 兼容接口均生效，保存后即时生效。
                  </div>
                  <div className="space-y-1.5">
                    <Label>AI 提示词优化消耗令牌</Label>
                    <Input type="number" min={0} value={cfg?.prompt_polish_cost ?? 0} onChange={e => update("prompt_polish_cost", +e.target.value)} className={inputCls} placeholder="0" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    创作页「AI 优化」每次扣除的令牌数。0 = 免费（适合走量拉新）。该功能调用「AI 矢量生成」配置的同一个模型，需先配置模型。
                  </div>
                  <div className="space-y-1.5">
                    <Label>图生文（反推提示词）消耗令牌</Label>
                    <Input type="number" min={0} value={cfg?.image_to_text_cost ?? 0} onChange={e => update("image_to_text_cost", +e.target.value)} className={inputCls} placeholder="0" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    创作页「反推提示词」每次扣除的令牌数。0 = 免费。上传参考图后用 AI 反推出中文生图提示词，调用「AI 矢量生成」配置的同一个模型（需该模型支持图像识别）。
                  </div>
                  <div className="space-y-1.5 sm:col-span-2 flex items-center justify-between rounded-xl bg-muted/40 p-3.5">
                    <div className="space-y-0.5">
                      <Label>API 生成不永久落地（省空间）</Label>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">开启后，通过 API Key（sk-）调用生图/矢量产生的内容<strong>不写磁盘/S3/数据库</strong>，仅在 Redis 短时缓存（带下方 TTL），用户通过有时效的代理地址自取，过期自动清理。网页端创作不受影响、照常永久保存。适合大量 API 调用、用户自行保存的场景。</p>
                    </div>
                    <Switch checked={!!cfg?.api_no_persist} onCheckedChange={v => update("api_no_persist", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>API 缓存有效期（分钟）</Label>
                    <Input type="number" min={1} value={cfg?.api_image_ttl_min ?? 30} onChange={e => update("api_image_ttl_min", +e.target.value)} className={inputCls} placeholder="30" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    「API 生成不永久落地」开启时生效：图片在 Redis 缓存的存活时长。0 = 用内置默认 30 分钟。用户需在此时间内通过返回的代理地址下载，过期后地址失效。建议 30–60 分钟（API 用户通常拿到即存）。
                  </div>
                  <div className="space-y-1.5">
                    <Label>API 用量日志保留天数</Label>
                    <Input type="number" min={0} max={365} value={cfg?.api_log_retention_days ?? 0} onChange={e => update("api_log_retention_days", +e.target.value)} className={inputCls} placeholder="30" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    开发者「API 用量仪表盘」的调用日志保留多久，超期每日自动清理。0 = 用内置默认 30 天。调用量大时可调小以省空间；想保留更长趋势可调大。仅影响用量统计，不影响生图内容。
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>一键智能增强 · 附加指令</Label>
                    <textarea value={cfg?.image_enhance_prompt || ""} onChange={e => update("image_enhance_prompt", e.target.value)} rows={2}
                      placeholder="可留空。例：统一走电影质感 / 偏暖色调 / 增强日系清新感" className={taCls} />
                    <p className="text-[10px] text-muted-foreground">「一键增强」采用两步法：AI 先看图诊断不足、生成针对性重构提示词，再图生图出增强版。此处填的内容会作为全局附加指令追加到 AI 诊断结果之后（留空=纯 AI 自主诊断）。按一次图生图计费（tokens_per_image）。</p>
                  </div>
                </div>
              </Card>

              {/* ═══ 图片上传压缩 ═══ */}
              <Card id="upload" icon={Upload} color="text-teal-500" bg="bg-teal-500/10" title="图片上传压缩" desc="参考图上传前在浏览器内压缩，降体积、提上传速度">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1.5">
                    <Label>最长边像素</Label>
                    <Input type="number" min={0} value={cfg?.upload_max_edge ?? 0} onChange={e => update("upload_max_edge", +e.target.value)} className={inputCls} placeholder="1536" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    压缩后图片最长边的像素上限。0 = 默认 1536。上游生图只用约 1.5MP（≈1254×1254），传更大纯属浪费；1280~2048 之间都对画质无损。调小上传更快。
                  </div>
                  <div className="space-y-1.5">
                    <Label>压缩质量（1-100）</Label>
                    <Input type="number" min={0} max={100} value={cfg?.upload_quality ?? 0} onChange={e => update("upload_quality", +e.target.value)} className={inputCls} placeholder="82" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    WebP/JPEG 有损压缩质量。0 = 默认 82。82 左右肉眼几乎无损且体积小；追求极限速度可降到 70-75。
                  </div>
                  <div className="space-y-1.5">
                    <Label>输出格式</Label>
                    <select value={cfg?.upload_format || "auto"} onChange={e => update("upload_format", e.target.value)}
                      className={`${inputCls} w-full rounded-lg border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20`}>
                      <option value="auto">自动（优先 WebP，回退 JPEG）</option>
                      <option value="webp">WebP（体积最小）</option>
                      <option value="jpeg">JPEG（兼容最好）</option>
                    </select>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    自动模式下浏览器支持 WebP 就用 WebP（同画质比 JPEG 再小 25-35%），否则回退 JPEG。极限性能选「自动」即可。
                  </div>
                  <div className="space-y-1.5">
                    <Label>压缩触发阈值（KB）</Label>
                    <Input type="number" min={0} value={cfg?.upload_compress_threshold_kb ?? 0} onChange={e => update("upload_compress_threshold_kb", +e.target.value)} className={inputCls} placeholder="100" />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    文件超过此大小才压缩。0 = 默认 100KB。小图直传不折腾，省去解码/编码开销。保存后用户端即时生效（下次打开创作页拉取新配置）。
                  </div>
                </div>
              </Card>

              {/* ═══ AI 矢量生成 ═══ */}
              <Card id="svg" icon={Shapes} color="text-fuchsia-500" bg="bg-fuchsia-500/10" title="AI 矢量生成" desc="用 ChatGPT 文本模型生成 SVG 矢量图（用户端 /vector 页面）">
                <div className="space-y-4">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label>使用模型</Label>
                      <select value={cfg?.svg_model || ""} onChange={e => update("svg_model", e.target.value)}
                        className="w-full h-9 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                        <option value="">未启用（留空 = 关闭功能）</option>
                        {cfg?.svg_model && !svgModels.some((m: any) => m.slug === cfg.svg_model) && (
                          <option value={cfg.svg_model}>{cfg.svg_model}（当前）</option>
                        )}
                        {svgModels.map((m: any) => <option key={m.slug} value={m.slug}>{m.title}（{m.slug}）</option>)}
                      </select>
                    </div>
                    <Button variant="outline" onClick={loadModels} disabled={loadingModels} className="gap-1.5 text-xs h-9 shrink-0">
                      {loadingModels ? <div className="size-3 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <RefreshCw className="size-3.5" />}
                      获取模型列表
                    </Button>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                    点「获取模型列表」实时拉取号池账号可用的模型，选定后保存即生效。留空则关闭用户端矢量生成功能。
                    每次生成扣除与生图相同的令牌数（tokens_per_image）。模型可用性取决于账号套餐授权。
                  </div>
                </div>
              </Card>

              {/* ═══ 积分商城 ═══ */}
              <Card id="shop" icon={ShoppingBag} color="text-pink-500" bg="bg-pink-500/10" title="积分商城" desc="配置积分兑换商品（积分换套餐时长），给积分增加消耗出口、拉付费转化"
                action={<Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addShopItem}><Plus className="size-3.5" /> 添加商品</Button>}>
                {shopItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无商品。点「添加商品」创建。⚠ 定价须结合签到/邀请积分发放速率核算，避免被白嫖会员。</p>
                ) : (
                  <div className="space-y-3">
                    {shopItems.map((it, i) => (
                      <div key={it.id || i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-xl border p-3">
                        <div className="sm:col-span-3 space-y-1"><Label>商品名</Label><Input value={it.name || ""} onChange={e => updateShopItem(i, "name", e.target.value)} className="text-sm" /></div>
                        <div className="sm:col-span-3 space-y-1"><Label>套餐</Label>
                          <select value={it.plan_id || 0} onChange={e => updateShopItem(i, "plan_id", +e.target.value)} className="w-full h-9 rounded-lg border bg-background px-2 text-sm">
                            <option value={0}>选择套餐</option>
                            {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="sm:col-span-2 space-y-1"><Label>天数(0永久)</Label><Input type="number" min={0} value={it.days ?? 0} onChange={e => updateShopItem(i, "days", +e.target.value)} className="text-sm" /></div>
                        <div className="sm:col-span-2 space-y-1"><Label>所需积分</Label><Input type="number" min={1} value={it.points ?? 0} onChange={e => updateShopItem(i, "points", +e.target.value)} className="text-sm" /></div>
                        <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-4">
                          <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={!!it.enabled} onCheckedChange={v => updateShopItem(i, "enabled", v)} /><span className="text-xs">上架</span></label>
                          <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => removeShopItem(i)}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ═══ 无套餐默认额度 ═══ */}
              <Card id="freequota" icon={Layers} color="text-sky-500" bg="bg-sky-500/10" title="无套餐默认额度" desc="未订阅 / 订阅过期 / 无默认套餐用户的兜底额度">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label>令牌容量</Label><Input type="number" min={0} value={cfg?.free_token_capacity ?? 0} onChange={e => update("free_token_capacity", +e.target.value)} className={inputCls} placeholder="50" />
                    <p className="text-[10px] text-muted-foreground">令牌桶上限（0=默认 50）</p>
                  </div>
                  <div className="space-y-1.5"><Label>每小时恢复</Label><Input type="number" min={0} value={cfg?.free_token_refill_per_hour ?? 0} onChange={e => update("free_token_refill_per_hour", +e.target.value)} className={inputCls} placeholder="3" />
                    <p className="text-[10px] text-muted-foreground">每小时恢复令牌数（0=默认 3）</p>
                  </div>
                  <div className="space-y-1.5"><Label>并发上限</Label><Input type="number" min={0} value={cfg?.free_concurrency ?? 0} onChange={e => update("free_concurrency", +e.target.value)} className={inputCls} placeholder="1" />
                    <p className="text-[10px] text-muted-foreground">同时生成数（0=默认 1）</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">优先级：用户当前有效套餐 &gt; 此处默认额度 &gt; 内置兜底 50/3/1。对所有没有有效套餐的用户生效（含新注册未配默认套餐、付费用户订阅过期）。</p>
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

              {/* 支付配置已移至独立页面 /admin/payment */}

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

              {/* ═══ 风险评分 ═══ */}
              <Card id="risk" icon={ShieldAlert} color="text-red-500" bg="bg-red-500/10" title="风险评分" desc="多维度用户风险评估阈值（修改后即时生效）">
                {(() => {
                  const rc = (() => { try { return JSON.parse(cfg?.risk_config || "{}"); } catch { return {}; } })();
                  const setRisk = (k: string, v: number | boolean | string | number[]) => {
                    const next = { ...rc, [k]: v };
                    setCfg((p: any) => ({ ...p, risk_config: JSON.stringify(next) }));
                  };
                  const ladderStr = Array.isArray(rc.ban_ladder) ? rc.ban_ladder.join(",") : "60,1440,10080";
                  const weightSum = (rc.weight_api ?? 40) + (rc.weight_points ?? 20) + (rc.weight_content ?? 25) + (rc.weight_account ?? 15);
                  return (
                    <div className="space-y-5">
                      {/* 处置阈值 */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">处置阈值（总分 0-100）</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <Label>标记观察 ≥</Label>
                            <Input type="number" min={0} max={100} value={rc.flag_threshold ?? 40} onChange={e => setRisk("flag_threshold", +e.target.value)} className={inputCls} placeholder="40" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>限流降级 ≥</Label>
                            <Input type="number" min={0} max={100} value={rc.limit_threshold ?? 65} onChange={e => setRisk("limit_threshold", +e.target.value)} className={inputCls} placeholder="65" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>自动封禁 ≥</Label>
                            <Input type="number" min={0} max={100} value={rc.ban_threshold ?? 85} onChange={e => setRisk("ban_threshold", +e.target.value)} className={inputCls} placeholder="85" />
                          </div>
                        </div>
                      </div>

                      {/* 维度权重 */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">
                          维度权重 %（合计应 = 100，当前 <span className={weightSum === 100 ? "text-emerald-500" : "text-red-500"}>{weightSum}</span>）
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="space-y-1.5">
                            <Label>API 滥用</Label>
                            <Input type="number" min={0} max={100} value={rc.weight_api ?? 40} onChange={e => setRisk("weight_api", +e.target.value)} className={inputCls} placeholder="40" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>积分滥用</Label>
                            <Input type="number" min={0} max={100} value={rc.weight_points ?? 20} onChange={e => setRisk("weight_points", +e.target.value)} className={inputCls} placeholder="20" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>内容滥用</Label>
                            <Input type="number" min={0} max={100} value={rc.weight_content ?? 25} onChange={e => setRisk("weight_content", +e.target.value)} className={inputCls} placeholder="25" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>账号异常</Label>
                            <Input type="number" min={0} max={100} value={rc.weight_account ?? 15} onChange={e => setRisk("weight_account", +e.target.value)} className={inputCls} placeholder="15" />
                          </div>
                        </div>
                      </div>

                      {/* 采集与评分窗口 */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">采集与评分</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label>评分间隔(分钟)</Label>
                            <Input type="number" min={1} max={60} value={rc.score_interval_min ?? 5} onChange={e => setRisk("score_interval_min", +e.target.value)} className={inputCls} placeholder="5" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>采集窗口(分钟)</Label>
                            <Input type="number" min={1} max={60} value={rc.window_minutes ?? 5} onChange={e => setRisk("window_minutes", +e.target.value)} className={inputCls} placeholder="5" />
                          </div>
                        </div>
                      </div>

                      {/* 灵敏度子参数 */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">灵敏度（决定各维度子项打分快慢，0=内置默认）</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="space-y-1.5">
                            <Label>API 配额倍数</Label>
                            <Input type="number" min={0} value={rc.api_rate_budget_mult ?? 6} onChange={e => setRisk("api_rate_budget_mult", +e.target.value)} className={inputCls} placeholder="6" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>错误率最小样本</Label>
                            <Input type="number" min={0} value={rc.api_err_min_samples ?? 20} onChange={e => setRisk("api_err_min_samples", +e.target.value)} className={inputCls} placeholder="20" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>IP 数阈值</Label>
                            <Input type="number" min={0} value={rc.api_ip_threshold ?? 15} onChange={e => setRisk("api_ip_threshold", +e.target.value)} className={inputCls} placeholder="15" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>邀请统计窗口(天)</Label>
                            <Input type="number" min={0} value={rc.invite_window_days ?? 7} onChange={e => setRisk("invite_window_days", +e.target.value)} className={inputCls} placeholder="7" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>每重复prompt分</Label>
                            <Input type="number" min={0} value={rc.dup_prompt_unit ?? 20} onChange={e => setRisk("dup_prompt_unit", +e.target.value)} className={inputCls} placeholder="20" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>失败率满分上限</Label>
                            <Input type="number" min={0} max={100} value={rc.fail_rate_max ?? 20} onChange={e => setRisk("fail_rate_max", +e.target.value)} className={inputCls} placeholder="20" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>每同IP账号分</Label>
                            <Input type="number" min={0} value={rc.same_ip_unit ?? 12} onChange={e => setRisk("same_ip_unit", +e.target.value)} className={inputCls} placeholder="12" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>同IP分上限</Label>
                            <Input type="number" min={0} max={100} value={rc.same_ip_max ?? 50} onChange={e => setRisk("same_ip_max", +e.target.value)} className={inputCls} placeholder="50" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>被封历史加分</Label>
                            <Input type="number" min={0} max={100} value={rc.ban_history_score ?? 40} onChange={e => setRisk("ban_history_score", +e.target.value)} className={inputCls} placeholder="40" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>新账号判定(小时)</Label>
                            <Input type="number" min={0} value={rc.new_account_hours ?? 24} onChange={e => setRisk("new_account_hours", +e.target.value)} className={inputCls} placeholder="24" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>新账号加分</Label>
                            <Input type="number" min={0} max={100} value={rc.new_account_score ?? 20} onChange={e => setRisk("new_account_score", +e.target.value)} className={inputCls} placeholder="20" />
                          </div>
                        </div>
                      </div>

                      {/* 封禁策略 */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">封禁策略</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <Switch checked={rc.ban_escalation ?? true} onCheckedChange={v => setRisk("ban_escalation", v)} />
                              <span>阶梯封禁</span>
                            </label>
                          </div>
                          {(rc.ban_escalation ?? true) ? (
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label>阶梯时长序列(分钟,逗号分隔,0=永久)</Label>
                              <Input value={ladderStr} onChange={e => setRisk("ban_ladder", e.target.value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)))} className={inputCls} placeholder="60,1440,10080" />
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <Label>固定封禁时长(分钟,0=永久)</Label>
                              <Input type="number" min={0} max={43200} value={rc.ban_duration_minutes ?? 60} onChange={e => setRisk("ban_duration_minutes", +e.target.value)} className={inputCls} placeholder="60" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5 mt-3">
                          <Label>申诉联系方式（注入封禁提示，留空用通用文案）</Label>
                          <Input value={rc.appeal_contact ?? ""} onChange={e => setRisk("appeal_contact", e.target.value)} className={inputCls} placeholder="如 邮箱 admin@example.com / TG @xxx / QQ群 12345" />
                        </div>
                      </div>

                      <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                        阈值：≥{rc.flag_threshold ?? 40} 观察 · ≥{rc.limit_threshold ?? 65} 限流降级（速率减半）· ≥{rc.ban_threshold ?? 85} 自动封禁。
                        评分每 {rc.score_interval_min ?? 5} 分钟刷新，高频信号按 {rc.window_minutes ?? 5} 分钟窗口采集。
                        开启阶梯后按序列逐级升级时长（默认 1h→1天→7天，超出序列用最后一级），关闭则每次都用固定时长。临时封禁到期自动解封。点击底部「保存设置」即时生效。
                      </div>
                    </div>
                  );
                })()}
              </Card>

              <p className="text-xs text-muted-foreground text-center pb-2">站点设置统一保存 · 调度器配置需在对应卡片单独应用</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
