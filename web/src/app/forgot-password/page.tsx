"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Lock, Eye, EyeOff, KeyRound, ArrowLeft } from "lucide-react";
import { api, BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const router = useRouter();

  useEffect(() => {
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => { if (d?.data) setSettings(d.data); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown(n => n - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const smtpEnabled = settings?.email_config ? JSON.parse(settings.email_config).smtp_enabled : false;

  const sendCode = async () => {
    if (!email || sendingCode || countdown > 0) return;
    setError("");
    setSendingCode(true);
    try { await api("/api/auth/send-code", { method: "POST", body: JSON.stringify({ email }) }); setCountdown(60); }
    catch (e: any) { setError(e.message); }
    setSendingCode(false);
  };

  const submit = async () => {
    if (!email || !code || !password) return;
    if (password.length < 6) { setError("新密码至少 6 位"); return; }
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ email, code, password }) });
      setDone(true);
      setTimeout(() => router.push("/login?reset=1"), 1800);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };
  // PLACEHOLDER_RENDER
  return (
    <div className="min-h-screen relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* 光谱柔光背景 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/3 -left-1/4 w-[560px] h-[560px] rounded-full bg-cyan-400/10 dark:bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-1/3 -right-1/4 w-[480px] h-[480px] rounded-full bg-violet-400/10 dark:bg-violet-500/10 blur-[110px]" />
      </div>

      <div className="relative w-full max-w-sm mx-auto px-4">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex w-12 h-12 rounded-2xl items-center justify-center mb-4 bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 shadow-[0_8px_24px_-6px_rgba(99,102,241,0.5)]">
            <KeyRound className="w-5 h-5 text-white" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-[family-name:var(--font-display)]">找回密码</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">通过邮箱验证码重置你的登录密码</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-2xl p-6 space-y-4 shadow-xl shadow-zinc-200/20 dark:shadow-zinc-900/30">
          {!smtpEnabled ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">站点未开启邮箱验证</p>
              <p className="text-xs text-zinc-400">请联系管理员重置密码</p>
            </div>
          ) : done ? (
            <div className="py-8 text-center space-y-3">
              <div className="inline-flex w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 items-center justify-center"
                style={{ animation: "successPop 0.5s cubic-bezier(0.16,1,0.3,1)" }}>
                <KeyRound className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">密码已重置</p>
              <p className="text-xs text-zinc-400">即将跳转登录页…</p>
            </div>
          ) : (
            <>
              {/* 邮箱 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">邮箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="h-10 text-sm pl-9" />
                </div>
              </div>

              {/* 验证码 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">验证码</label>
                <div className="flex gap-2">
                  <Input value={code} onChange={e => setCode(e.target.value)} placeholder="6 位验证码" className="h-10 text-sm flex-1" />
                  <button onClick={sendCode} disabled={!email || sendingCode || countdown > 0}
                    className="shrink-0 h-10 px-3.5 rounded-lg text-xs font-medium text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 disabled:opacity-40 transition-all">
                    {countdown > 0 ? `${countdown}s` : sendingCode ? "发送中" : "获取验证码"}
                  </button>
                </div>
              </div>

              {/* 新密码 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">新密码</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" className="h-10 text-sm pl-9 pr-9" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <Button onClick={submit} disabled={loading || !email || !code || !password}
                className="w-full h-11 gap-2 text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:brightness-110 disabled:opacity-40">
                {loading ? "重置中…" : <>重置密码 <ArrowRight className="w-4 h-4" /></>}
              </Button>
            </>
          )}

          <Link href="/login" className="flex items-center justify-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors pt-1">
            <ArrowLeft className="w-3 h-3" /> 返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
