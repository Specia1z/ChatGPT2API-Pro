"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { api, BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/turnstile-widget";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const router = useRouter();

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.data) setSettings(data.data);
      })
      .catch(() => {});
  }, []);

  const handleRegister = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, string> = { email, password, name: name || email.split("@")[0] };
      if (turnstileToken) body.cf_turnstile_token = turnstileToken;
      if (smtpEnabled && !codeVerified) {
        const v = await api("/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email, code }) });
        if (v.code !== 200) return setError(v.message || "验证码错误");
        setCodeVerified(true);
      }
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
      router.push("/login?registered=1");
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const smtpEnabled = settings?.email_config ? JSON.parse(settings.email_config).smtp_enabled : false;
  const sendCode = async () => {
    if (!email || sendingCode || codeSent) return;
    setSendingCode(true);
    try { await api("/api/auth/send-code", { method: "POST", body: JSON.stringify({ email }) }); setCodeSent(true); } catch (e: any) { setError(e.message); }
    setSendingCode(false);
  };
  const showTurnstile = settings.cf_turnstile_enabled && settings.cf_turnstile_site_key;

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Animated bg blobs — neutral */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-zinc-200/40 dark:bg-zinc-800/30 blur-[120px] animate-[blob1_20s_ease-in-out_infinite]" />
        <div className="absolute -bottom-1/3 -right-1/4 w-[500px] h-[500px] rounded-full bg-zinc-200/30 dark:bg-zinc-800/20 blur-[100px] animate-[blob2_25s_ease-in-out_infinite]" />
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] rounded-full bg-zinc-200/20 dark:bg-zinc-800/10 blur-[80px] animate-[blob3_18s_ease-in-out_infinite]" />
      </div>

      <div className="relative w-full max-w-sm mx-auto px-4">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-800 items-center justify-center mb-4 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors">
            {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
              <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-6 h-6 object-contain" />
            ) : (
              <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{settings?.site_logo_text || "C2"}</span>
            )}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            创建账号
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
            注册 {settings?.site_title || "ChatGPT2API Pro"} 开始 AI 创作
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-2xl p-6 space-y-4 shadow-xl shadow-zinc-200/20 dark:shadow-zinc-900/30">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <User className="w-3 h-3" />
              昵称
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的昵称"
              className="h-10 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              邮箱
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-10 text-sm"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <Lock className="w-3 h-3" />
              密码
            </label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                className="h-10 text-sm pr-10"
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Verify code (if SMTP enabled) */}
          {smtpEnabled && !codeVerified && (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                 验证码
                </label>
                <div className="flex gap-2">
                  <Input value={code} onChange={e => setCode(e.target.value)} placeholder="输入验证码" className="h-10 text-sm flex-1" />
                  <Button onClick={codeSent ? () => {} : sendCode} disabled={sendingCode || codeSent || !email} variant="outline" className="h-10 text-xs shrink-0">
                    {codeSent ? "已发送" : sendingCode ? "发送中..." : "发送验证码"}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="text-[13px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-xl px-4 py-2.5 border border-red-100 dark:border-red-500/10">
              {error}
            </div>
          )}

          {/* Turnstile */}
          {showTurnstile && (
            <TurnstileWidget siteKey={settings.cf_turnstile_site_key!} onToken={setTurnstileToken} />
          )}

          {/* Submit */}
          <Button
            onClick={handleRegister}
            disabled={loading}
            className="w-full h-10 text-sm font-semibold gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-none"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {loading ? "注册中..." : "注册"}
          </Button>

          {/* Login link */}
          <p className="text-center text-[13px] text-zinc-500 dark:text-zinc-400 pt-1">
            已有账号？<Link href="/login" className="font-medium text-zinc-600 dark:text-zinc-300 hover:underline">登录</Link>
          </p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes blob1 { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(30px,-30px) scale(1.05); } 66% { transform: translate(-20px,20px) scale(0.95); } }
        @keyframes blob2 { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(-25px,25px) scale(1.08); } 66% { transform: translate(20px,-15px) scale(0.92); } }
        @keyframes blob3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(15px,-20px) scale(1.1); } }
      `}</style>
    </div>
  );
}
