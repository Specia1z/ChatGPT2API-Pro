"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Megaphone, Plus, Trash2, Settings2, RefreshCw, Info, AlertTriangle, CheckCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { IconTip } from "@/components/ui/icon-tip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };

interface Announcement {
  id: number;
  title: string;
  content: string;
  type: string;
  link: string;
  priority: number;
  enabled: boolean;
  dismissible: boolean;
  start_at: string;
  end_at: string;
  created_at: string;
}

const TYPES = [
  { value: "info", label: "信息", icon: Info, cls: "text-sky-500" },
  { value: "warning", label: "警告", icon: AlertTriangle, cls: "text-amber-500" },
  { value: "success", label: "成功", icon: CheckCircle, cls: "text-emerald-500" },
  { value: "activity", label: "活动", icon: Sparkles, cls: "text-violet-500" },
];
const typeMeta = (t: string) => TYPES.find(x => x.value === t) || TYPES[0];

const emptyItem = (): Announcement => ({
  id: 0, title: "", content: "", type: "info", link: "", priority: 0, enabled: true, dismissible: true, start_at: "", end_at: "", created_at: "",
});

// datetime-local 控件值 (YYYY-MM-DDTHH:mm) ←→ 后端字符串
const toInput = (s: string) => (s ? s.replace(" ", "T").slice(0, 16) : "");
const fromInput = (s: string) => (s ? s.replace("T", " ") + ":00" : "");

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  const load = async () => {
    try {
      const r = await api<any>("/api/admin/announcements");
      setItems(r.data || []);
    } catch (e: any) { toast.error(e.message || "加载失败"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.title.trim() && !editing.content.trim()) { toast.error("标题与内容不能都为空"); return; }
    setSaving(true);
    const payload = { ...editing, start_at: fromInput(toInput(editing.start_at)), end_at: fromInput(toInput(editing.end_at)) };
    try {
      if (editing.id > 0) {
        await api("/api/admin/announcements", { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/admin/announcements", { method: "POST", body: JSON.stringify(payload) });
      }
      toast.success("已保存");
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message || "保存失败"); }
    setSaving(false);
  };

  const toggleEnabled = async (a: Announcement) => {
    try {
      await api("/api/admin/announcements", { method: "PUT", body: JSON.stringify({ ...a, enabled: !a.enabled }) });
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api("/api/admin/announcements", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) });
      toast.success("已删除");
      load();
    } catch (e: any) { toast.error(e.message); }
    setDeleteTarget(null);
  };

  // PAGE_BODY_PLACEHOLDER
  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>公告管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">站点顶部 Banner 公告 · 支持类型/链接/定时/优先级</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={load} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <RefreshCw className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={() => setEditing(emptyItem())} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2">
              <Plus className="size-3 sm:size-3.5" /> <span className="hidden sm:inline">新建公告</span><span className="sm:hidden">新建</span>
            </Button>
          </div>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-28 text-muted-foreground">
                <RefreshCw className="size-4 animate-spin mr-2" /> 加载中…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28">
                <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Megaphone className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">暂无公告</p>
                <p className="text-xs text-muted-foreground mt-1">点击「新建公告」添加</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-3xl">
                {items.map(a => {
                  const m = typeMeta(a.type);
                  const Icon = m.icon;
                  return (
                    <motion.div key={a.id} variants={fadeUp}
                      className={`flex items-center gap-3 rounded-xl border bg-card p-3 sm:p-4 transition-all ${!a.enabled ? "opacity-50" : ""}`}>
                      <div className="size-8 sm:size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Icon className={`size-4 sm:size-[18px] ${m.cls}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{a.title || a.content || "（无标题）"}</span>
                          <span className={`${mono.className} text-[10px] text-muted-foreground/60 shrink-0`}>P{a.priority}</span>
                          {!a.dismissible && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">常驻</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {a.title && a.content ? a.content : ""}
                          {(a.start_at || a.end_at) && (
                            <span className="ml-1 text-muted-foreground/60">· {a.start_at?.slice(0, 16) || "即时"} ~ {a.end_at?.slice(0, 16) || "永久"}</span>
                          )}
                        </p>
                      </div>
                      <Switch checked={a.enabled} onCheckedChange={() => toggleEnabled(a)} />
                      <IconTip label="编辑"><Button variant="ghost" size="icon-sm" onClick={() => setEditing({ ...a })}><Settings2 className="size-3.5" /></Button></IconTip>
                      <IconTip label="删除"><Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => setDeleteTarget(a)}><Trash2 className="size-3.5" /></Button></IconTip>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </main>

      {/* EDIT_DIALOG_PLACEHOLDER */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-sm sm:text-base font-semibold`}>
              {editing && editing.id > 0 ? "编辑公告" : "新建公告"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 mt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">类型</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {TYPES.map(t => {
                    const Icon = t.icon;
                    const active = editing.type === t.value;
                    return (
                      <button key={t.value} type="button" onClick={() => setEditing({ ...editing, type: t.value })}
                        className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] transition-all ${active ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                        <Icon className={`size-4 ${t.cls}`} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">标题</label>
                <Input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="例如：系统维护通知" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">内容</label>
                <textarea value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })}
                  rows={2} placeholder="公告正文（顶部 Banner 展示）"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">跳转链接（可选）</label>
                <Input value={editing.link} onChange={e => setEditing({ ...editing, link: e.target.value })} placeholder="https://..." className="text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">优先级</label>
                  <Input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: +e.target.value })} className="text-sm" />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-medium text-muted-foreground">启用</label>
                  <div className="flex items-center h-9"><Switch checked={editing.enabled} onCheckedChange={v => setEditing({ ...editing, enabled: v })} /></div>
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-medium text-muted-foreground">允许关闭</label>
                  <div className="flex items-center h-9"><Switch checked={editing.dismissible} onCheckedChange={v => setEditing({ ...editing, dismissible: v })} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">生效起（空=即时）</label>
                  <Input type="datetime-local" value={toInput(editing.start_at)} onChange={e => setEditing({ ...editing, start_at: e.target.value })} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">生效止（空=永久）</label>
                  <Input type="datetime-local" value={toInput(editing.end_at)} onChange={e => setEditing({ ...editing, end_at: e.target.value })} className="text-sm" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>取消</Button>
                <Button className="flex-1" onClick={saveEdit} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        title="删除公告" description={`确定删除「${deleteTarget?.title || deleteTarget?.content || ""}」？`}
        confirmLabel="删除" variant="destructive" onConfirm={doDelete} />
    </div>
  );
}
