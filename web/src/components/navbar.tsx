"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Sparkles, User, Wand2, LogOut, Sun, Moon, Terminal } from "lucide-react";
import { BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";

export function Navbar() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme") || "dark";
    setDark(stored === "dark");
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then((res) => res.json())
      .then((d) => { if (d?.data) setSettings(d.data); })
      .catch(() => {});
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <>
    <header className="sticky top-0 z-50 border-b border-zinc-200/60 dark:border-white/5 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-4 md:px-6 h-14">
        {/* ── Logo ── */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-7 h-7 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-700 dark:group-hover:bg-zinc-300 transition-colors">
            {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
              <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-4 h-4 object-contain" />
            ) : (
              <span className="text-[9px] font-black text-white dark:text-zinc-900 tracking-tighter">{settings?.site_logo_text || "C2"}</span>
            )}
          </div>
          <span className="font-semibold text-sm text-zinc-900 dark:text-white truncate max-w-[200px]">{settings?.site_title || "ChatGPT2API Pro"}</span>
        </Link>

        {/* ── 移动端：仅主题切换（其余入口在底部 Tab 栏） ── */}
        <button
          onClick={toggleTheme}
          className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
          aria-label="切换明暗主题"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* ── Main Nav（桌面端） ── */}
        <nav className="hidden md:flex items-center gap-0.5">
          <Link
            href="/"
            className="px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
          >
            首页
          </Link>

          <Link
            href="/gallery"
            className="px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" /> 灵感广场
          </Link>

          <Link
            href="/docs"
            className="px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-1"
          >
            <Terminal className="w-3 h-3" /> API 文档
          </Link>

          {user ? (
            <>
              <Link
                href="/create"
                className="px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all flex items-center gap-1"
              >
                <Wand2 className="w-3 h-3" /> 创作中心
              </Link>

              {/* ── Avatar + Dropdown ── */}
              <div className="relative ml-1.5">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[11px] font-bold text-zinc-600 dark:text-zinc-300 ring-2 ring-white dark:ring-zinc-800 hover:ring-zinc-300 dark:hover:ring-zinc-500 transition-all"
                >
                  {user.name?.[0] || user.email?.[0] || "U"}
                </button>

                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl z-20 py-1 overflow-hidden">
                      {/* User info */}
                      <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {user.name || user.email}
                        </p>
                        <p className="text-[10px] text-zinc-400 truncate mt-0.5">{user.email}</p>
                      </div>

                      {/* Theme toggle */}
                      <button
                        onClick={() => { toggleTheme(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      >
                        {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        {dark ? "切换亮色模式" : "切换暗色模式"}
                      </button>

                      {/* User center */}
                      <Link
                        href="/user"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <User className="w-3.5 h-3.5" />
                        用户中心
                      </Link>

                      {/* Logout */}
                      <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1">
                        <button
                          onClick={() => { logout(); setMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          退出登录
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <button
                onClick={toggleTheme}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                aria-label="切换明暗主题"
              >
                <span className={`inline-block transition-transform duration-300 ${dark ? "rotate-0 scale-100" : "rotate-90 scale-100"}`}>
                  {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </span>
              </button>
              <Link href="/login" className="px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all">
                登录
              </Link>
              <Link href="/register">
                <Button size="sm" className="ml-1 rounded-lg text-[11px] h-7 px-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-none">
                  免费注册
                </Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>

    {/* 站点公告 Banner（紧贴 navbar 下方） */}
    <AnnouncementBanner />

    {/* 移动端底部 Tab 栏（md 以下显示，桌面端隐藏） */}
    <MobileTabBar />
    </>
  );
}
