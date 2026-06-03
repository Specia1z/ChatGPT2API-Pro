"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import * as LucideIcons from "lucide-react";
const { Palette, Plus, Trash2, Settings2, RefreshCw, Save } = LucideIcons;
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 图标列表（从 lucide-react 动态加载） ──── */
const ICON_NAMES = Object.keys(LucideIcons).filter(k => k[0] === k[0].toUpperCase() && k !== "default" && k !== "createLucideIcon").sort();

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface StyleItem {
  id: string;
  label: string;
  icon: string;
  desc: string;
  hint: string;
  enabled: boolean;
  order: number;
}

const emptyStyle = (order: number): StyleItem => ({
  id: "", label: "", icon: "Palette", desc: "", hint: "", enabled: true, order,
});

export default function AdminStylesPage() {
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StyleItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StyleItem | null>(null);
  const [iconSearch, setIconSearch] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const load = async () => {
    try {
      const r = await api("/api/settings");
      const raw = r.data?.style_presets || "[]";
      const list: StyleItem[] = JSON.parse(raw);
      setStyles(list.sort((a, b) => a.order - b.order));
    } catch { setStyles([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (list: StyleItem[]) => {
    setSaving(true);
    try {
      // 先读当前设置，保留其他字段
      const r = await api("/api/settings");
      const cfg = r.data || {};
      cfg.style_presets = JSON.stringify(list);
      await api("/api/settings", { method: "POST", body: JSON.stringify(cfg) });
      setStyles([...list].sort((a, b) => a.order - b.order));
      toast.success("已保存");
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const addNew = () => setEditing(emptyStyle(styles.length));

  const editItem = (s: StyleItem) => setEditing({ ...s });

  const saveEdit = () => {
    if (!editing) return;
    const id = editing.id || `style_${Date.now()}`;
    const updated = { ...editing, id };
    const idx = styles.findIndex(s => s.id === id);
    let list: StyleItem[];
    if (idx >= 0) {
      list = styles.map((s, i) => i === idx ? updated : s);
    } else {
      list = [...styles, updated];
    }
    setEditing(null);
    save(list);
  };

  const deleteStyle = () => {
    if (!deleteTarget) return;
    save(styles.filter(s => s.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const toggleEnabled = (id: string) => {
    save(styles.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
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

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>风格预设</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">管理创作页面的风格模板 · 支持自定义名称/图标/提示词</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={load} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <RefreshCw className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={addNew} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <Plus className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">新建风格</span><span className="sm:hidden">新建</span>
            </Button>
          </div>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">

            {styles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28">
                <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Palette className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">暂无风格预设</p>
                <p className="text-xs text-muted-foreground mt-1">点击「新建风格」添加</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-3xl">
                {styles.map((s, i) => (
                  <motion.div key={s.id} variants={fadeUp}
                    className={`flex items-center gap-3 rounded-xl border bg-card p-3 sm:p-4 transition-all ${!s.enabled ? "opacity-50" : ""}`}>
                    {/* 排序号 */}
                    <span className={`${mono.className} text-xs text-muted-foreground/50 w-5 text-center shrink-0`}>{i + 1}</span>
                    {/* 图标 */}
                    <div className="size-8 sm:size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {(() => { const Icon = (LucideIcons as any)[s.icon] || Palette; return <Icon className="size-4 sm:size-[18px] text-primary" />; })()}
                    </div>
                    {/* 信息 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{s.label}</span>
                        <span className={`${mono.className} text-[10px] text-muted-foreground/60`}>{s.icon}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{s.desc}</p>
                    </div>
                    {/* 启用开关 */}
                    <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s.id)} />
                    {/* 操作 */}
                    <Button variant="ghost" size="icon-sm" onClick={() => editItem(s)} title="编辑"><Settings2 className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => setDeleteTarget(s)} title="删除"><Trash2 className="size-3.5" /></Button>
                  </motion.div>
                ))}
              </div>
            )}

            {styles.length > 0 && (
              <div className="flex items-center gap-2 pt-2">
                <Button onClick={addNew} variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Plus className="size-3.5" /> 新建风格
                </Button>
                <div className="flex-1" />
                <span className="text-[10px] text-muted-foreground">共 {styles.length} 个风格</span>
              </div>
            )}
          </div>
        </motion.div>
      </main>

      {/* ═══ 编辑弹窗 ═══ */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-sm sm:text-base font-semibold`}>
              {editing?.id && styles.some(s => s.id === editing.id) ? "编辑风格" : "新建风格"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 mt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">名称</label>
                <Input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })}
                  placeholder="赛博朋克" className="text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">图标</label>
                  <div className="relative">
                    <button type="button" onClick={() => setIconPickerOpen(!iconPickerOpen)}
                      className="w-full h-8 rounded-lg border bg-background px-2.5 text-sm flex items-center gap-2 hover:bg-muted transition-colors">
                      {(() => { const Icon = (LucideIcons as any)[editing.icon] || Palette; return <Icon className="size-4 shrink-0" />; })()}
                      <span className="text-muted-foreground">{editing.icon}</span>
                    </button>
                    {iconPickerOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIconPickerOpen(false)} />
                        <div className="absolute left-0 top-full mt-1 z-20 w-[320px] sm:w-[400px] p-2 rounded-xl bg-card border shadow-xl max-h-60 overflow-auto scrollbar-thin">
                          <input value={iconSearch} onChange={e => setIconSearch(e.target.value)}
                            placeholder="搜索图标..." className="w-full h-7 rounded-lg border bg-background px-2.5 text-xs outline-none mb-2" autoFocus />
                          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1">
                            {ICON_NAMES.filter(n => !iconSearch || n.toLowerCase().includes(iconSearch.toLowerCase())).slice(0, 96).map(ico => {
                              const Icon = (LucideIcons as any)[ico];
                              const active = editing.icon === ico;
                              return (
                                <button key={ico} type="button" onClick={() => { setEditing({ ...editing, icon: ico }); setIconPickerOpen(false); }}
                                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg text-[9px] transition-all ${active ? "bg-primary/10 ring-1 ring-primary/30 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                                  <Icon className="size-4" />
                                  <span className="truncate w-full text-center leading-tight">{ico}</span>
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[9px] text-muted-foreground/60 text-center mt-1">共 {ICON_NAMES.length} 个图标</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">排序</label>
                  <Input type="number" min={0} value={editing.order}
                    onChange={e => setEditing({ ...editing, order: +e.target.value })} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">描述</label>
                <Input value={editing.desc} onChange={e => setEditing({ ...editing, desc: e.target.value })}
                  placeholder="霓虹都市·未来科技" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">提示词（英文，将追加到用户输入后）</label>
                <textarea value={editing.hint} onChange={e => setEditing({ ...editing, hint: e.target.value })}
                  rows={3} placeholder="cyberpunk city, neon lights..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>取消</Button>
                <Button className="flex-1" onClick={saveEdit}>保存</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="删除风格" description={`确定要删除「${deleteTarget?.label}」？`}
        confirmLabel="删除" variant="destructive" onConfirm={deleteStyle} />
    </div>
  );
}
