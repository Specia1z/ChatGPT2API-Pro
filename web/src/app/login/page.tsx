"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { api, setToken, BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { TurnstileWidget } from "@/components/turnstile-widget";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [settings, setSettings] = useState<any>({});
  const { login: authLogin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") {
      toast.success("注册成功，请登录");
      window.history.replaceState({}, "", "/login");
    }
    if (params.get("reset") === "1") {
      toast.success("密码已重置，请用新密码登录");
      window.history.replaceState({}, "", "/login");
    }
    // Linux Do OAuth 出错时由后端 302 带回的 error 文案
    const oauthError = params.get("oauth_error");
    if (oauthError) {
      setError(oauthError);
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.data) setSettings(data.data);
      })
      .catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, string> = { email, password };
      if (turnstileToken) body.cf_turnstile_token = turnstileToken;
      const res = await api<any>("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
      setToken(res.data.token);
      authLogin(res.data.user, res.data.token);
      // 管理员（含 superadmin）登录后进后台，普通用户回首页
      const u = res.data.user || {};
      if (u.is_super_admin || (u.role && u.role >= 1)) {
        router.push("/admin");
      } else {
        router.push("/");
      }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Animated bg blobs — neutral */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/2 -right-1/4 w-[600px] h-[600px] rounded-full bg-zinc-200/40 dark:bg-zinc-800/30 blur-[120px] animate-[blob1_20s_ease-in-out_infinite]" />
        <div className="absolute -bottom-1/3 -left-1/4 w-[500px] h-[500px] rounded-full bg-zinc-200/30 dark:bg-zinc-800/20 blur-[100px] animate-[blob2_25s_ease-in-out_infinite]" />
        <div className="absolute top-1/3 left-1/2 w-[400px] h-[400px] rounded-full bg-zinc-200/20 dark:bg-zinc-800/10 blur-[80px] animate-[blob3_18s_ease-in-out_infinite]" />
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
            欢迎回来
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
            登录你的账号继续创作
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-2xl p-6 space-y-4 shadow-xl shadow-zinc-200/20 dark:shadow-zinc-900/30">
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
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> 密码</span>
              <Link href="/forgot-password" className="text-[11px] font-normal text-cyan-600 dark:text-cyan-400 hover:underline">忘记密码？</Link>
            </label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10 text-sm pr-10"
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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

          {/* Error */}
          {error && (
            <div className="text-[13px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-xl px-4 py-2.5 border border-red-100 dark:border-red-500/10">
              {error}
            </div>
          )}

          {/* Turnstile */}
          {settings.cf_turnstile_enabled && settings.cf_turnstile_site_key && (
            <TurnstileWidget siteKey={settings.cf_turnstile_site_key} onToken={setTurnstileToken} />
          )}

          {/* Submit */}
          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-10 text-sm font-semibold gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-none"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {loading ? "登录中..." : "登录"}
          </Button>

          {/* Linux Do 第三方登录（后端 oauth_config.linuxdo_enabled 时显示） */}
          {(() => {
            try {
              const oc = JSON.parse(settings?.oauth_config || "{}");
              return oc?.linuxdo_enabled ? (
                <>
                  <div className="relative my-1">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-200 dark:border-zinc-800" /></div>
                    <div className="relative flex justify-center"><span className="bg-white dark:bg-zinc-900 px-2 text-[11px] text-zinc-400">或</span></div>
                  </div>
                  <a
                    href="/api/auth/linuxdo"
                    className="w-full h-10 text-sm font-semibold gap-2 rounded-xl bg-[#F0A020] hover:bg-[#db8e15] text-white inline-flex items-center justify-center transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3.2l2.3 4.7 5.2.8-3.8 3.7.9 5.2L12 17.3 7.4 19.8l.9-5.2L4.5 10.9l5.2-.8L12 5.2z" />
                    </svg>
                    Linux Do 登录
                  </a>
                </>
              ) : null;
            } catch { return null; }
          })()}

          {/* Register link */}
          <p className="text-center text-[13px] text-zinc-500 dark:text-zinc-400 pt-1">
            没有账号？<Link href="/register" className="font-medium text-zinc-600 dark:text-zinc-300 hover:underline">立即注册</Link>
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
