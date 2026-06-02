"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit, DM_Mono } from "next/font/google";
import { Users, Search, Pencil, Key, Coins, Ban, Check, RefreshCw, X, UserCheck, UserX, Plus, Minus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/* ── 动画 ─────────────────────────────────── */
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
const rowFade = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.3 } } };

/* ── 头像渐变 ─────────────────────────────── */
const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600",
  "from-blue-500 to-indigo-600", "from-rose-500 to-pink-600", "from-cyan-500 to-blue-600",
];
function avatarGradient(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

/* ── 主页面 ─────────────────────────────────── */
export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [editUser, setEditUser] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [pointsUser, setPointsUser] = useState<any>(null);
  const [pointsDelta, setPointsDelta] = useState(0);
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [toggleTarget, setToggleTarget] = useState<any>(null);

  const fetchUsers = () => {
    setLoading(true);
    api(`/api/admin/users?search=${encodeURIComponent(search)}`).then(r => {
      setUsers(r.data.items || []); setTotal(r.data.total || 0); setLoading(false);
    });
  };
  useEffect(() => { fetchUsers(); }, [search]);

  const updateName = async () => {
    try { await api("/api/admin/users/update", { method: "POST", body: JSON.stringify({ id: editUser.id, name: editName }) }); toast.success("已更新"); setEditUser(null); fetchUsers(); }
    catch (e: any) { toast.error(e.message); }
  };
  const confirmResetPassword = async () => {
    if (!resetTarget) return;
    try { await api("/api/admin/users/reset-password", { method: "POST", body: JSON.stringify({ id: resetTarget.id, password: "123456" }) }); toast.success("密码已重置为 123456"); setResetTarget(null); }
    catch (e: any) { toast.error(e.message); }
  };
  const adjustPoints = async () => {
    try { const res = await api<any>("/api/admin/users/points", { method: "POST", body: JSON.stringify({ id: pointsUser.id, delta: pointsDelta }) }); toast.success(`积分 ${res.data.action}: ${res.data.points}`); setPointsUser(null); fetchUsers(); }
    catch (e: any) { toast.error(e.message); }
  };
  const confirmToggleStatus = async () => {
    if (!toggleTarget) return;
    try { await api("/api/admin/users/toggle-status", { method: "POST", body: JSON.stringify({ id: toggleTarget.id }) }); toast.success("状态已切换"); setToggleTarget(null); fetchUsers(); }
    catch (e: any) { toast.error(e.message); }
  };

  const stats = useMemo(() => {
    const active = users.filter(u => u.status).length;
    return { total, active, disabled: users.length - active };
  }, [users, total]);

  return (
    <div className={`${heading.variable} ${mono.variable} h-screen bg-background flex overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0`}>
      <AdminSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ═══ Header ═══ */}
        <div className="border-b bg-card px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h1 className={`${heading.className} text-sm sm:text-base font-semibold tracking-tight`}>用户管理</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">管理注册用户 · 积分 · 状态</p>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchUsers} disabled={loading} className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-muted-foreground px-1.5 sm:px-2 shrink-0">
            <RefreshCw className={`size-3 sm:size-3.5 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">刷新</span>
          </Button>
        </div>

        <motion.div className="flex-1 overflow-auto scrollbar-thin" variants={stagger} initial="hidden" animate="visible">
          <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">

            {/* ═══ 统计卡 ═══ */}
            <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {[
                { label: "总用户", value: stats.total, icon: Users, color: "text-primary", bg: "bg-primary/10" },
                { label: "正常", value: stats.active, icon: UserCheck, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                { label: "禁用", value: stats.disabled, icon: UserX, color: "text-red-500", bg: "bg-red-500/10" },
              ].map(item => (
                <div key={item.label} className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:shadow-sm transition-shadow">
                  <div className={`size-10 sm:size-11 rounded-xl ${item.bg} flex items-center justify-center shrink-0`}>
                    <item.icon className={`size-4 sm:size-5 ${item.color}`} />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{item.label}</p>
                    <p className={`${mono.className} text-lg sm:text-xl font-medium tabular-nums mt-0.5`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* ═══ 工具栏 ═══ */}
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索邮箱或昵称..." className="pl-9 pr-8 text-xs" />
                {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>}
              </div>
              <div className="flex-1" />
              <span className={`${mono.className} text-[11px] text-muted-foreground tabular-nums`}>显示 {users.length} / {total}</span>
            </motion.div>

            {/* ═══ 表格 ═══ */}
            <motion.div variants={fadeUp} className="rounded-2xl border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3 pl-5">用户</th>
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">套餐</th>
                      <th className="text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">积分</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">状态</th>
                      <th className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">订阅到期</th>
                      <th className="hidden sm:table-cell text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-3">注册时间</th>
                      <th className="w-32 py-3 pr-5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        <td className="pl-5 py-3"><div className="flex items-center gap-3"><Skeleton className="size-9 rounded-xl" /><div className="space-y-1"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-3 w-32" /></div></div></td>
                        <td className="py-3"><Skeleton className="h-5 w-14 rounded-md" /></td>
                        <td className="py-3"><Skeleton className="h-3.5 w-10 ml-auto" /></td>
                        <td className="py-3"><Skeleton className="h-3.5 w-10 mx-auto" /></td>
                        <td className="py-3"><Skeleton className="h-3 w-20" /></td>
                        <td className="py-3"><Skeleton className="h-3 w-16" /></td>
                        <td className="py-3 pr-5" />
                      </tr>
                    )) : users.length === 0 ? (
                      <tr><td colSpan={7} className="h-40 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="size-12 rounded-2xl bg-muted flex items-center justify-center"><Users className="size-5 text-muted-foreground/50" /></div>
                          <p className="text-sm text-muted-foreground">{search ? "没有匹配的用户" : "暂无用户"}</p>
                        </div>
                      </td></tr>
                    ) : users.map(u => {
                      const initial = (u.name || u.email || "?")[0].toUpperCase();
                      return (
                        <motion.tr key={u.id} variants={rowFade} className={`group transition-colors hover:bg-muted/40 ${!u.status ? "opacity-60" : ""}`}>
                          <td className="pl-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`size-9 rounded-xl bg-gradient-to-br ${avatarGradient(u.email || u.name || "")} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                                {initial}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate max-w-[160px]">{u.name || "未命名"}</p>
                                <p className={`${mono.className} text-[11px] text-muted-foreground truncate`}>{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            {u.plan_name ? <Badge variant="secondary" className="bg-violet-500/10 text-violet-600 dark:text-violet-400">{u.plan_name}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="py-3 text-right"><span className={`${mono.className} text-sm font-medium tabular-nums`}>{u.points ?? 0}</span></td>
                          <td className="py-3 text-center">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${u.status ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                              <span className={`size-1.5 rounded-full ${u.status ? "bg-emerald-500" : "bg-red-500"}`} />{u.status ? "正常" : "禁用"}
                            </span>
                          </td>
                          <td className={`${mono.className} py-3 text-[11px] text-muted-foreground tabular-nums`}>{u.subscription_expires_at ? u.subscription_expires_at.slice(0, 10) : "—"}</td>
                          <td className={`${mono.className} hidden sm:table-cell py-3 text-[11px] text-muted-foreground tabular-nums`}>{u.created_at?.slice(0, 10) || "—"}</td>
                          <td className="py-3 pr-5">
                            <div className="flex items-center justify-end gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon-sm" onClick={() => { setEditUser(u); setEditName(u.name || ""); }} title="编辑昵称"><Pencil className="size-3.5" /></Button>
                              <Button variant="ghost" size="icon-sm" className="hover:text-amber-500" onClick={() => setResetTarget(u)} title="重置密码"><Key className="size-3.5" /></Button>
                              <Button variant="ghost" size="icon-sm" className="hover:text-emerald-500" onClick={() => { setPointsUser(u); setPointsDelta(0); }} title="调整积分"><Coins className="size-3.5" /></Button>
                              <Button variant="ghost" size="icon-sm" className={u.status ? "hover:text-destructive" : "text-red-400 hover:text-emerald-500"} onClick={() => setToggleTarget(u)} title={u.status ? "禁用" : "启用"}>
                                {u.status ? <Ban className="size-3.5" /> : <Check className="size-3.5" />}
                              </Button>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </main>

      {/* ═══ 编辑昵称 ═══ */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-base font-semibold`}>编辑用户</DialogTitle>
            <DialogDescription className="sr-only">修改用户昵称</DialogDescription>
          </DialogHeader>
          {editUser && (
            <div className="space-y-3 mt-1">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                <div className={`size-10 rounded-xl bg-gradient-to-br ${avatarGradient(editUser.email || "")} flex items-center justify-center text-white text-sm font-bold shadow-sm`}>
                  {(editUser.name || editUser.email || "?")[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{editUser.name || "未命名"}</p>
                  <p className={`${mono.className} text-[11px] text-muted-foreground truncate`}>{editUser.email}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">昵称</label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && updateName()} className="text-sm" autoFocus />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditUser(null)}>取消</Button>
            <Button size="sm" onClick={updateName}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ 调整积分 ═══ */}
      <Dialog open={!!pointsUser} onOpenChange={() => setPointsUser(null)}>
        <DialogContent className={`${heading.variable} ${mono.variable} max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={`${heading.className} text-base font-semibold flex items-center gap-2`}>
              <span className="size-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Coins className="size-4 text-emerald-500" /></span>
              调整积分
            </DialogTitle>
            <DialogDescription className="sr-only">为用户增加或扣除积分</DialogDescription>
          </DialogHeader>
          {pointsUser && (() => {
            const after = (pointsUser.points || 0) + pointsDelta;
            const invalid = after < 0;
            return (
              <div className="space-y-5 mt-1">
                {/* 用户身份 */}
                <div className="flex items-center gap-3">
                  <div className={`size-10 rounded-xl bg-gradient-to-br ${avatarGradient(pointsUser.email || "")} flex items-center justify-center text-white text-sm font-bold shadow-sm`}>
                    {(pointsUser.name || pointsUser.email || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pointsUser.name || pointsUser.email}</p>
                    <p className="text-[11px] text-muted-foreground">当前 <span className={`${mono.className} font-semibold text-foreground tabular-nums`}>{pointsUser.points ?? 0}</span> 积分</p>
                  </div>
                </div>

                {/* 步进器 */}
                <div className="flex items-center gap-3">
                  <button onClick={() => setPointsDelta(d => d - 10)}
                    className="size-11 rounded-xl border bg-card flex items-center justify-center text-muted-foreground hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/5 transition-all active:scale-95">
                    <Minus className="size-5" />
                  </button>
                  <div className="flex-1 relative">
                    <input type="number" value={pointsDelta} onChange={e => setPointsDelta(+e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !invalid && adjustPoints()}
                      className={`${mono.className} w-full h-14 rounded-xl border-2 bg-muted/30 text-center text-2xl font-bold tabular-nums outline-none transition-colors focus:border-primary ${
                        pointsDelta > 0 ? "text-emerald-500" : pointsDelta < 0 ? "text-red-500" : "text-muted-foreground"
                      }`} autoFocus />
                    {pointsDelta !== 0 && (
                      <span className={`absolute top-1.5 left-3 text-[10px] font-bold ${pointsDelta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {pointsDelta > 0 ? "增加" : "扣除"}
                      </span>
                    )}
                  </div>
                  <button onClick={() => setPointsDelta(d => d + 10)}
                    className="size-11 rounded-xl border bg-card flex items-center justify-center text-muted-foreground hover:text-emerald-500 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all active:scale-95">
                    <Plus className="size-5" />
                  </button>
                </div>

                {/* 快捷数额 */}
                <div className="grid grid-cols-6 gap-1.5">
                  {[-100, -50, -10, 10, 50, 100].map(v => (
                    <button key={v} onClick={() => setPointsDelta(d => d + v)}
                      className={`${mono.className} h-7 rounded-lg text-[11px] font-medium border transition-all hover:scale-105 ${
                        v > 0 ? "border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10" : "border-red-500/20 text-red-500 hover:bg-red-500/10"
                      }`}>
                      {v > 0 ? `+${v}` : v}
                    </button>
                  ))}
                </div>

                {/* 结果预览 */}
                <div className="flex items-center justify-center gap-3 py-3 rounded-xl bg-muted/40">
                  <span className={`${mono.className} text-lg font-medium tabular-nums text-muted-foreground`}>{pointsUser.points ?? 0}</span>
                  <ArrowRight className="size-4 text-muted-foreground/50" />
                  <span className={`${mono.className} text-2xl font-bold tabular-nums ${invalid ? "text-red-500" : after > (pointsUser.points ?? 0) ? "text-emerald-500" : "text-foreground"}`}>
                    {after}
                  </span>
                </div>
                {invalid && <p className="text-[11px] text-red-500 text-center -mt-2">积分不能为负数</p>}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setPointsUser(null)}>取消</Button>
                  <Button className="flex-1" onClick={adjustPoints} disabled={pointsDelta === 0 || invalid}>确认调整</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ═══ 重置密码确认 ═══ */}
      <ConfirmDialog open={!!resetTarget} onOpenChange={() => setResetTarget(null)}
        title="重置密码" description={`确定要将「${resetTarget?.name || resetTarget?.email}」的密码重置为 123456？`}
        confirmLabel="重置" variant="destructive" onConfirm={confirmResetPassword} />

      {/* ═══ 状态切换确认 ═══ */}
      <ConfirmDialog open={!!toggleTarget} onOpenChange={() => setToggleTarget(null)}
        title={toggleTarget?.status ? "禁用账号" : "启用账号"}
        description={toggleTarget?.status ? `确定要禁用「${toggleTarget?.name || toggleTarget?.email}」？` : `确定要启用「${toggleTarget?.name || toggleTarget?.email}」？`}
        confirmLabel={toggleTarget?.status ? "禁用" : "启用"}
        variant={toggleTarget?.status ? "destructive" : "default"} onConfirm={confirmToggleStatus} />
    </div>
  );
}
