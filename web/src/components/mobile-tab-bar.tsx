"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Home, Sparkles, Wand2, User } from "lucide-react";

/* 移动端底部 Tab 栏（md 以下显示）。桌面端由 Navbar 顶部导航接管。 */

const TABS = [
  { href: "/", label: "首页", icon: Home, needAuth: false },
  { href: "/gallery", label: "广场", icon: Sparkles, needAuth: false },
  { href: "/create", label: "创作", icon: Wand2, needAuth: true },
  { href: "/user", label: "我的", icon: User, needAuth: true },
] as const;

export function MobileTabBar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-[#080a12]/85 backdrop-blur-2xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around h-14">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          // 需要登录的 Tab：未登录时显示「登录」并跳转登录页
          const requiresLogin = tab.needAuth && !user;
          const href = requiresLogin ? "/login" : tab.href;
          const label = tab.href === "/user" && !user ? "登录" : tab.label;
          const active = pathname === tab.href;

          return (
            <Link
              key={tab.label}
              href={href}
              onClick={(e) => { if (requiresLogin) { e.preventDefault(); router.push("/login"); } }}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform"
            >
              <Icon
                className={`w-[18px] h-[18px] transition-all duration-200 ${
                  active
                    ? "text-cyan-600 dark:text-cyan-300 -translate-y-0.5"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              />
              <span
                className={`text-[10px] leading-none transition-colors ${
                  active
                    ? "text-cyan-600 dark:text-cyan-300 font-medium"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {label}
              </span>
              {active && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
