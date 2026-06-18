"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Linux Do OAuth 回调落地页：后端完成授权换码后 302 到此页，
// 携带 token / user(JSON) / return_to。本页写入本地登录态并按角色跳转。
export default function LinuxDoCallbackPage() {
  const router = useRouter();
  const { login: authLogin } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const userStr = params.get("user");
    const returnTo = params.get("return_to");

    if (!token || !userStr) {
      setError("登录回调缺少参数，请重新登录");
      return;
    }

    let user: any;
    try {
      user = JSON.parse(userStr);
    } catch {
      setError("登录回调解析失败，请重新登录");
      return;
    }
    if (!user || !user.id) {
      setError("登录回调无效，请重新登录");
      return;
    }

    setToken(token);
    authLogin(user, token);

    const safeReturn = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null;
    if (user.is_super_admin || (user.role && user.role >= 1)) {
      router.replace(safeReturn && safeReturn !== "/" ? safeReturn : "/admin");
    } else {
      router.replace(safeReturn || "/");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      {error ? (
        <div className="text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          <a href="/login" className="text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:underline">返回登录</a>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">正在登录…</p>
        </div>
      )}
    </div>
  );
}
