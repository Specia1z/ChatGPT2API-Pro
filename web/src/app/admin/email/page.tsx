"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Mail, Plus, Trash2, Save, RefreshCw, Shield, Globe, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export default function AdminEmailPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api("/api/settings");
      const raw = r.data?.email_config || "{}";
      setCfg(JSON.parse(raw));
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api("/api/settings");
      const settings = r.data || {};
      settings.email_config = JSON.stringify(cfg);
      await api("/api/settings", { method: "POST", body: JSON.stringify(settings) });
      toast.success("已保存");
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const update = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));

  const [domainField, setDomainField] = useState<string>("");
  const [domainInput, setDomainInput] = useState("");
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const openDomainDialog = (field: string) => { setDomainField(field); setDomainInput(""); setDomainDialogOpen(true); };
  const confirmDomain = () => {
    if (!domainInput.trim()) return;
    update(domainField, [...(cfg?.[domainField] || []), domainInput.trim()]);
    setDomainDialogOpen(false);
  };

  const [aliasFrom, setAliasFrom] = useState("");
  const [aliasTo, setAliasTo] = useState("");
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false);
  const openAliasDialog = () => { setAliasFrom(""); setAliasTo(""); setAliasDialogOpen(true); };
  const confirmAlias = () => {
    if (!aliasFrom.trim() || !aliasTo.trim()) return;
    update("domain_aliases", { ...(cfg?.domain_aliases || {}), [aliasFrom.trim()]: aliasTo.trim() });
    setAliasDialogOpen(false);
  };

  const removeListItem = (field: string, idx: number) => {
    const list = (cfg?.[field] || []).filter((_: any, i: number) => i !== idx);
    update(field, list);
  };

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>邮箱配置</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">SMTP 服务 · 域名黑/白名单 · 注册验证</p>
          </div>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 shrink-0">
            <Save className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">保存配置</span><span className="sm:hidden">保存</span>
          </Button>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin p-4 sm:p-6 lg:p-8">
          <div className="max-w-3xl space-y-5">

            {/* SMTP 配置 */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center"><Mail className="size-4 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>SMTP 服务</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">用于发送验证码邮件</p>
                </div>
                <Switch checked={!!cfg?.smtp_enabled} onCheckedChange={v => update("smtp_enabled", v)} />
              </div>
              {cfg?.smtp_enabled && (
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">SMTP 服务器</label>
                      <Input value={cfg.smtp_host || ""} onChange={e => update("smtp_host", e.target.value)} placeholder="smtp.example.com" /></div>
                    <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">端口</label>
                      <Input type="number" value={cfg.smtp_port || 587} onChange={e => update("smtp_port", +e.target.value)} placeholder="587" /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">用户名</label>
                      <Input value={cfg.smtp_user || ""} onChange={e => update("smtp_user", e.target.value)} placeholder="user@example.com" /></div>
                    <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">密码</label>
                      <Input type="password" value={cfg.smtp_pass || ""} onChange={e => update("smtp_pass", e.target.value)} placeholder="••••••••" /></div>
                  </div>
                  <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">发件人地址</label>
                    <Input value={cfg.smtp_from || ""} onChange={e => update("smtp_from", e.target.value)} placeholder="noreply@example.com" /></div>
                </div>
              )}
            </div>

            {/* 域名白名单 */}
            <DomainListCard title="域名白名单" desc="仅允许这些域名的邮箱注册（留空=不限制）" icon={Shield} field="domain_whitelist"
              items={cfg?.domain_whitelist || []} onAdd={() => openDomainDialog("domain_whitelist")} onRemove={(i: number) => removeListItem("domain_whitelist", i)} />

            {/* 域名黑名单 */}
            <DomainListCard title="域名黑名单" desc="禁止这些域名的邮箱注册" icon={Globe} field="domain_blacklist"
              items={cfg?.domain_blacklist || []} onAdd={() => openDomainDialog("domain_blacklist")} onRemove={(i: number) => removeListItem("domain_blacklist", i)} />

            {/* IP 注册限制 */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 rounded-lg bg-orange-500/10 flex items-center justify-center"><Users className="size-4 text-orange-500" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>IP 注册限制</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">每 IP 每日最多可注册的账号数</p>
                </div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="max-w-xs">
                  <Input type="number" min={0} value={cfg?.reg_limit_per_ip ?? 5}
                    onChange={e => update("reg_limit_per_ip", Math.max(0, +e.target.value))}
                    placeholder="5" className="text-sm" />
                  <p className="text-[10px] text-muted-foreground mt-1.5">设为 0 则不限制</p>
                </div>
              </div>
            </div>
            {/* Gmail 别名标准化 */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><Mail className="size-4 text-blue-500" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>Gmail 别名标准化</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">自动处理 Gmail 点号（.）和加号（+）别名</p>
                </div>
                <Switch checked={!!cfg?.normalize_gmail} onCheckedChange={v => update("normalize_gmail", v)} />
              </div>
              <div className="p-4 sm:p-6">
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li><code className="font-mono text-foreground">foo.bar@gmail.com</code> → <code className="font-mono text-foreground">foobar@gmail.com</code></li>
                  <li><code className="font-mono text-foreground">user+tag@gmail.com</code> → <code className="font-mono text-foreground">user@gmail.com</code></li>
                </ul>
              </div>
            </div>

            {/* 域名别名 */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
                <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><Mail className="size-4 text-amber-500" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className={`${heading.className} text-sm font-semibold`}>域名别名</h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">例如 googlemail.com → gmail.com</p>
                </div>
              </div>
              <div className="p-4 sm:p-6 space-y-2">
                {Object.entries(cfg?.domain_aliases || {}).length === 0 && (
                  <p className="text-xs text-muted-foreground">暂无别名</p>
                )}
                {Object.entries(cfg?.domain_aliases || {}).map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Input value={k} disabled className="font-mono" />
                    <span>→</span>
                    <Input value={v as string} onChange={e => {
                      const aliases = { ...(cfg?.domain_aliases || {}) };
                      delete aliases[k];
                      aliases[e.target.value] = v as string;
                      update("domain_aliases", aliases);
                    }} className="font-mono" />
                    <button onClick={() => {
                      const aliases = { ...(cfg?.domain_aliases || {}) };
                      delete aliases[k];
                      update("domain_aliases", aliases);
                    }} className="text-destructive hover:text-destructive/80 shrink-0"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1.5 text-xs w-full border-dashed" onClick={openAliasDialog}>
                  <Plus className="size-3.5" /> 添加别名
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </main>

      {/* 域名输入弹窗 */}
      <Dialog open={domainDialogOpen} onOpenChange={setDomainDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm font-semibold">添加域名</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={domainInput} onChange={e => setDomainInput(e.target.value)}
              placeholder="example.com" className="text-sm" onKeyDown={e => e.key === "Enter" && confirmDomain()} autoFocus />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDomainDialogOpen(false)}>取消</Button>
              <Button className="flex-1" onClick={confirmDomain}>添加</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 别名输入弹窗 */}
      <Dialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm font-semibold">添加域名别名</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">来源域名</label>
              <Input value={aliasFrom} onChange={e => setAliasFrom(e.target.value)} placeholder="googlemail.com" className="text-sm" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">目标域名</label>
              <Input value={aliasTo} onChange={e => setAliasTo(e.target.value)} placeholder="gmail.com" className="text-sm" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAliasDialogOpen(false)}>取消</Button>
              <Button className="flex-1" onClick={confirmAlias}>添加</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DomainListCard({ title, desc, icon: Icon, items, onAdd, onRemove }: any) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center gap-3">
        <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Icon className="size-4 text-emerald-500" /></div>
        <div className="min-w-0 flex-1">
          <h2 className={`${heading.className} text-sm font-semibold`}>{title}</h2>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="p-4 sm:p-6">
        {items.length === 0 ? <p className="text-xs text-muted-foreground mb-3">暂无配置</p> : (
          <div className="flex flex-wrap gap-2 mb-3">
            {items.map((d: string, i: number) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted text-xs font-mono">
                {d}
                <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onAdd}><Plus className="size-3.5" /> 添加域名</Button>
      </div>
    </div>
  );
}
