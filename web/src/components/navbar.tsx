"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sparkles, User, Wand2, LogOut, Sun, Moon, Terminal, Shapes } from "lucide-react";
import { BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme") || "dark";
    setDark(stored === "dark");
  }, []);

  // 滚动加深：下滑后磨砂背景更实、阴影浮现
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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

  // 导航链接 active 态：当前页青色高亮，否则中性灰
  const navLink = (href: string) =>
    `relative px-2.5 py-1.5 rounded-lg text-[13px] transition-all flex items-center gap-1 ${
      pathname === href
        ? "text-cyan-600 dark:text-cyan-300"
        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5"
    }`;

  return (
    <>
    <header className={`sticky top-0 z-50 transition-all duration-300 border-b ${
      scrolled
        ? "border-zinc-200/70 dark:border-white/10 bg-white/85 dark:bg-[#080a12]/85 backdrop-blur-2xl shadow-sm shadow-zinc-900/5 dark:shadow-cyan-500/5"
        : "border-zinc-200/40 dark:border-white/5 bg-white/60 dark:bg-[#080a12]/60 backdrop-blur-xl"
    }`}>
      {/* 顶部青色微光渐变 — 强化磨砂"浮层"质感 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.4),rgba(99,102,241,0.3)_50%,rgba(232,121,249,0.3),transparent)]" />
      <div className="relative max-w-6xl mx-auto flex items-center justify-between px-4 md:px-6 h-14">
        {/* ── Logo（左段） ── */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="relative w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#22d3ee,#6366f1_55%,#e879f9)] shadow-[0_0_16px_-4px_rgba(34,211,238,0.6)] group-hover:shadow-[0_0_20px_-2px_rgba(34,211,238,0.85)] transition-shadow">
            {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
              <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-4 h-4 object-contain" />
            ) : (
              <span className="text-[9px] font-black text-white tracking-tighter drop-shadow-sm">{settings?.site_logo_text || "C2"}</span>
            )}
          </div>
          <span className="font-semibold text-sm text-zinc-900 dark:text-white truncate max-w-[200px]">{settings?.site_title || "ChatGPT2API Pro"}</span>
        </Link>

        {/* ── 移动端：仅主题切换（其余入口在底部 Tab 栏） ── */}
        <button
          onClick={toggleTheme}
          className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
          aria-label="切换明暗主题"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* ── 导航链接（中段，绝对居中，不受两侧宽度影响） ── */}
        <nav className="hidden md:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
          <Link href="/" className={navLink("/")}>
            首页
            {pathname === "/" && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 h-0.5 w-5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />}
          </Link>

          <Link href="/gallery" className={navLink("/gallery")}>
            <Sparkles className="w-3 h-3" /> 灵感广场
            {pathname === "/gallery" && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 h-0.5 w-5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />}
          </Link>

          <Link href="/vector" className={navLink("/vector")}>
            <Shapes className="w-3 h-3" /> AI 矢量
            {pathname === "/vector" && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 h-0.5 w-5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />}
          </Link>

          <Link href="/docs" className={navLink("/docs")}>
            <Terminal className="w-3 h-3" /> API 文档
            {pathname === "/docs" && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 h-0.5 w-5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />}
          </Link>
        </nav>

        {/* ── 操作区（右段） ── */}
        <div className="hidden md:flex items-center gap-0.5">
          {user ? (
            <>
              <Link
                href="/create"
                className={`relative ml-1 px-3 py-1.5 rounded-lg text-[13px] font-medium flex items-center gap-1 transition-all ${
                  pathname === "/create"
                    ? "text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] shadow-[0_0_16px_-4px_rgba(34,211,238,0.7)]"
                    : "text-cyan-600 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-400/10"
                }`}
              >
                <Wand2 className="w-3 h-3" /> 创作中心
              </Link>

              {/* ── Avatar + Dropdown ── */}
              <div className="relative ml-1.5">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-[linear-gradient(135deg,#22d3ee,#6366f1_60%,#e879f9)] ring-2 ring-white dark:ring-[#080a12] hover:shadow-[0_0_14px_-2px_rgba(34,211,238,0.8)] transition-all"
                >
                  {user.name?.[0] || user.email?.[0] || "U"}
                </button>

                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-[#0d101a] rounded-xl border border-zinc-200 dark:border-white/10 shadow-xl dark:shadow-cyan-500/5 z-20 py-1 overflow-hidden">
                      {/* User info */}
                      <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {user.name || user.email}
                        </p>
                        <p className="text-[10px] text-zinc-400 truncate mt-0.5">{user.email}</p>
                      </div>

                      {/* Theme toggle */}
                      <button
                        onClick={() => { toggleTheme(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                      >
                        {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        {dark ? "切换亮色模式" : "切换暗色模式"}
                      </button>

                      {/* User center */}
                      <Link
                        href="/user"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                      >
                        <User className="w-3.5 h-3.5" />
                        用户中心
                      </Link>

                      {/* Logout */}
                      <div className="border-t border-zinc-100 dark:border-white/5 mt-1 pt-1">
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
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
                aria-label="切换明暗主题"
              >
                <span className={`inline-block transition-transform duration-300 ${dark ? "rotate-0 scale-100" : "rotate-90 scale-100"}`}>
                  {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </span>
              </button>
              <Link href="/login" className="px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-all">
                登录
              </Link>
              <Link href="/register">
                <Button size="sm" className="ml-1 rounded-lg text-[11px] h-7 px-3.5 font-semibold text-white border-0 bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:shadow-[0_0_18px_-4px_rgba(34,211,238,0.8)] hover:brightness-110 transition-all">
                  免费注册
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>

    {/* 站点公告 Banner（紧贴 navbar 下方） */}
    <AnnouncementBanner />

    {/* 移动端底部 Tab 栏（md 以下显示，桌面端隐藏） */}
    <MobileTabBar />
    </>
  );
}
