"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

// 管理后台路由守卫：仅 superadmin 或 role>=1 的用户可访问 /admin/*。
// 服务端各接口已强制鉴权（403），此处负责前端体验：未登录跳登录，非管理员回首页。
// 权限的最终真相源在后端，这里只做导航与避免泄露后台 UI。
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    const isAdmin = user.is_super_admin || (user.role ?? 0) >= 1;
    if (!isAdmin) router.replace("/");
  }, [user, loading, router]);

  // 鉴权未完成或无权限时不渲染后台内容，避免闪现
  if (loading || !user || !(user.is_super_admin || (user.role ?? 0) >= 1)) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="size-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}
