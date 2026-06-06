"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Gift, Copy, Check, Users, Coins } from "lucide-react";
import { toast } from "sonner";

/* 邀请好友卡片 — 用户中心「邀请好友」Tab 内容。复用积分系统的裂变入口。 */
export function InviteCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api("/api/user/invite")
      .then((r: any) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-cyan-500 rounded-full animate-spin" /></div>;
  }
  if (!data?.enabled) {
    return <p className="text-sm text-muted-foreground text-center py-12">邀请活动暂未开放</p>;
  }

  const link = typeof window !== "undefined" ? `${window.location.origin}/register?ref=${data.invite_code}` : "";

  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      toast.success("邀请链接已复制");
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className="space-y-5">
      {/* 邀请链接卡 — 深色光谱 */}
      <div className="relative rounded-2xl bg-zinc-900 dark:bg-[#0b0e16] ring-1 ring-white/10 overflow-hidden p-6">
        <div className="absolute -left-6 -top-10 w-44 h-44 rounded-full blur-[80px] opacity-25 bg-[#22d3ee] pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 mb-4">
            <Gift className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-medium text-cyan-100/70 tracking-wide">邀请好友得积分</span>
          </div>
          <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
            好友通过你的链接注册即可双方得积分
            {data.reward_recharge_invitee > 0 && "，TA 首次订阅你还能再得奖励"}。
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 rounded-xl bg-white/[0.06] border border-white/10 px-3.5 h-11 flex items-center">
              <span className="text-[13px] text-zinc-300 font-mono truncate">{link}</span>
            </div>
            <button onClick={copy}
              className="shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl text-sm font-semibold text-zinc-900 bg-white hover:bg-zinc-100 transition-colors">
              {copied ? <><Check className="w-4 h-4" /> 已复制</> : <><Copy className="w-4 h-4" /> 复制</>}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">邀请码 <span className="font-mono text-cyan-300">{data.invite_code}</span></p>
        </div>
      </div>

      {/* 战绩 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border bg-card p-5">
          <div className="size-8 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-2">
            <Users className="size-4 text-cyan-500" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{data.invited_count}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">已邀请好友</p>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center mb-2">
            <Coins className="size-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold tabular-nums">{data.total_reward}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">累计获得积分</p>
        </div>
      </div>

      {/* 邀请记录 */}
      {data.invitees?.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b text-[11px] font-medium text-muted-foreground tracking-wide">邀请记录</div>
          <div className="divide-y">
            {data.invitees.map((it: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-foreground truncate">{it.masked_email}</span>
                  {it.recharged && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">已订阅</span>}
                </div>
                <span className="shrink-0 text-[12px] text-cyan-600 dark:text-cyan-400 font-medium tabular-nums">
                  +{it.reward_register + it.reward_recharge}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
