"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Database, HardDrive, Cloud, Check, Loader2, Server, Globe, Lock, Key, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

/* ── 存储类型 ─────────────────────────────── */
const STORAGE_TYPES = [
  { value: "database", label: "数据库存储", desc: "Base64 存储在 MySQL", icon: Database, color: "#10b981", bg: "bg-emerald-500/10", text: "text-emerald-500", tag: "默认" },
  { value: "local", label: "本地文件", desc: "服务器磁盘存储", icon: HardDrive, color: "#f59e0b", bg: "bg-amber-500/10", text: "text-amber-500", tag: "" },
  { value: "s3", label: "对象存储", desc: "S3 / MinIO / OSS", icon: Cloud, color: "#6366f1", bg: "bg-primary/10", text: "text-primary", tag: "推荐" },
];

/* ── 字段组件 ───────────────────────────────── */
function Field({ icon: Icon, label, hint, children }: { icon: any; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3" /> {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

/* ── 主页面 ─────────────────────────────────── */
export default function StoragePage() {
  const [cfg, setCfg] = useState<any>({ type: "database" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api("/api/admin/storage-config")
      .then((r: any) => { if (r.data) setCfg(r.data); })
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await api("/api/admin/storage-config", { method: "POST", body: JSON.stringify(cfg) });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      toast.success("配置已保存，新生成图片生效");
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const current = STORAGE_TYPES.find(t => t.value === cfg.type) || STORAGE_TYPES[0];

  if (loading) return (
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-start sm:items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className={`size-8 sm:size-9 rounded-xl ${current.bg} flex items-center justify-center shrink-0`}>
              <current.icon className={`size-4 sm:size-5 ${current.text}`} />
            </div>
            <div>
              <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>存储配置</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">当前：{current.label} · 切换不影响存量图片</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {saved && <span className="hidden sm:flex items-center gap-1 text-xs text-emerald-500"><Check className="size-3.5" /> 已保存</span>}
            <Button onClick={save} disabled={saving} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 h-7 sm:h-9">
              {saving ? <Loader2 className="size-3 sm:size-4 animate-spin" /> : <ShieldCheck className="size-3 sm:size-4" />}
              {saving ? "..." : "保存"}
            </Button>
          </div>
        </div>

        {/* ═══ 双栏布局 ═══ */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-0 overflow-hidden">

          {/* 左栏：存储类型选择 */}
          <div className="border-b lg:border-b-0 lg:border-r bg-card/40 p-4 sm:p-5 overflow-auto scrollbar-thin">
            <p className={`${heading.className} text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-1`}>存储方式</p>
            <div className="space-y-2">
              {STORAGE_TYPES.map((t, i) => {
                const active = cfg.type === t.value;
                return (
                  <motion.button key={t.value}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                    onClick={() => setCfg({ ...cfg, type: t.value })}
                    className={`relative w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                      active ? "bg-card shadow-sm" : "border-border bg-transparent hover:bg-card hover:shadow-sm"
                    }`}
                    style={active ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}, 0 4px 16px -8px ${t.color}` } : undefined}>
                    <div className="flex items-start gap-3">
                      <div className={`size-10 rounded-xl ${t.bg} flex items-center justify-center shrink-0`}>
                        <t.icon className={`size-5 ${t.text}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`${heading.className} text-sm font-semibold`}>{t.label}</span>
                          {t.tag && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ color: t.color, background: `${t.color}1a` }}>{t.tag}</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</p>
                      </div>
                      {active && (
                        <div className="size-5 rounded-full flex items-center justify-center shrink-0" style={{ background: t.color }}>
                          <Check className="size-3 text-white" />
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* 提示卡 */}
            <div className="mt-4 p-3.5 rounded-xl bg-muted/40 border">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium">运行状态</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                切换存储方式不影响已有图片，新生成的图片将按新模式存储。
              </p>
            </div>
          </div>

          {/* 右栏：配置详情 */}
          <div className="overflow-auto scrollbar-thin p-4 sm:p-6 lg:p-8">
            {/* PLACEHOLDER_CONFIG */}
            <motion.div key={cfg.type} variants={fadeUp} initial="hidden" animate="visible" className="max-w-2xl">
              {/* 配置标题 */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`size-12 rounded-2xl ${current.bg} flex items-center justify-center`}>
                  <current.icon className={`size-6 ${current.text}`} />
                </div>
                <div>
                  <h2 className={`${heading.className} text-lg font-bold tracking-tight`}>{current.label}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{current.desc}</p>
                </div>
              </div>

              {cfg.type === "database" && (
                <div className="rounded-2xl border bg-card p-4 sm:p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Check className="size-4 text-emerald-500" />
                    <span className="text-sm font-medium">无需额外配置</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    图片以 Base64 格式直接存储在 MySQL 数据库中。这是开箱即用的默认模式，适合小规模部署。
                    若图片量较大，建议切换到本地文件或对象存储以减轻数据库压力。
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-5">
                    {[
                      { label: "无需配置", value: "即开即用", icon: Check },
                      { label: "适用场景", value: "小规模部署", icon: Database },
                    ].map(item => (
                      <div key={item.label} className="rounded-xl bg-muted/40 p-4">
                        <item.icon className="size-4 text-emerald-500 mb-2" />
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-sm font-medium mt-0.5">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cfg.type === "local" && (
                <div className="rounded-2xl border bg-card p-4 sm:p-6 space-y-4 sm:space-y-5">
                  <div className="flex items-center gap-2">
                    <Server className="size-4 text-amber-500" />
                    <h3 className="text-sm font-semibold">本地文件系统配置</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field icon={HardDrive} label="存储路径" hint="图片保存的服务器目录，修改后即时生效（图片经代理读取，无需重启）">
                      <Input value={cfg.local_path || ""} onChange={e => setCfg({ ...cfg, local_path: e.target.value })} className={`${mono.className} text-sm`} placeholder="./uploads" />
                    </Field>
                    <Field icon={Globe} label="访问 URL（可选）" hint="图片统一经 /api/images/{id} 代理读取，此前缀仅作记录，可留空">
                      <Input value={cfg.local_url || ""} onChange={e => setCfg({ ...cfg, local_url: e.target.value })} className={`${mono.className} text-sm`} placeholder="（可留空）" />
                    </Field>
                  </div>
                </div>
              )}

              {cfg.type === "s3" && (
                <div className="rounded-2xl border bg-card p-4 sm:p-6 space-y-4 sm:space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Cloud className="size-4 text-primary shrink-0" />
                      <h3 className="text-sm font-semibold">S3 兼容存储配置</h3>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                      <Switch checked={!!cfg.s3_use_ssl} onCheckedChange={v => setCfg({ ...cfg, s3_use_ssl: v })} />
                      <span className="text-xs font-medium text-muted-foreground">启用 SSL</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field icon={Globe} label="Endpoint">
                      <Input value={cfg.s3_endpoint || ""} onChange={e => setCfg({ ...cfg, s3_endpoint: e.target.value })} className={`${mono.className} text-sm`} placeholder="s3.amazonaws.com" />
                    </Field>
                    <Field icon={Server} label="Bucket">
                      <Input value={cfg.s3_bucket || ""} onChange={e => setCfg({ ...cfg, s3_bucket: e.target.value })} className={`${mono.className} text-sm`} placeholder="my-bucket" />
                    </Field>
                    <Field icon={Globe} label="Region">
                      <Input value={cfg.s3_region || ""} onChange={e => setCfg({ ...cfg, s3_region: e.target.value })} className={`${mono.className} text-sm`} placeholder="us-east-1" />
                    </Field>
                    <Field icon={Key} label="Access Key">
                      <Input value={cfg.s3_access_key || ""} onChange={e => setCfg({ ...cfg, s3_access_key: e.target.value })} className={`${mono.className} text-sm`} placeholder="AKIA..." />
                    </Field>
                    <Field icon={Lock} label="Secret Key">
                      <Input type="password" value={cfg.s3_secret_key || ""} onChange={e => setCfg({ ...cfg, s3_secret_key: e.target.value })} className={`${mono.className} text-sm`} placeholder="留空则沿用已保存的密钥" />
                    </Field>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
