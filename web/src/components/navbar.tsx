"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sparkles, User, Wand2, LogOut, Sun, Moon, Terminal, Shapes, ShoppingBag } from "lucide-react";
import { BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";

// 桌面导航项（中段药丸内的链接）
const NAV_ITEMS = [
  { href: "/", label: "首页", icon: null as null | typeof Sparkles },
  { href: "/gallery", label: "灵感广场", icon: Sparkles },
  { href: "/vector", label: "AI 矢量", icon: Shapes },
  { href: "/shop", label: "积分商城", icon: ShoppingBag },
  { href: "/docs", label: "API 文档", icon: Terminal },
];

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

  // 滚动加深：下滑后药丸阴影更重、背景更实
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

  return (
    <>
    {/* 站点公告 ribbon（置于导航上方，页面最顶层；滚动后随页面上移，导航贴顶） */}
    <AnnouncementBanner />

    {/* ── 悬浮容器：sticky 占流（不遮挡页面内容），内部居中悬浮药丸 ── */}
    <header className="sticky top-0 z-50 pointer-events-none">
      <div className="flex justify-center px-4 pt-3 md:pt-4 pb-1">
        {/* ── 桌面端：居中悬浮药丸 ── */}
        <div
          className={`pointer-events-auto hidden md:flex items-center gap-1 h-12 pl-2.5 pr-2 rounded-full border transition-all duration-300 ${
            scrolled
              ? "border-zinc-200/80 dark:border-white/10 bg-white/85 dark:bg-[#0b0e18]/85 backdrop-blur-2xl shadow-lg shadow-zinc-900/10 dark:shadow-cyan-500/10"
              : "border-zinc-200/50 dark:border-white/[0.07] bg-white/70 dark:bg-[#0b0e18]/70 backdrop-blur-xl shadow-md shadow-zinc-900/5 dark:shadow-black/20"
          }`}
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group shrink-0 pr-1">
            <div className="relative w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#22d3ee,#6366f1_55%,#e879f9)] shadow-[0_0_16px_-4px_rgba(34,211,238,0.6)] group-hover:shadow-[0_0_20px_-2px_rgba(34,211,238,0.85)] transition-shadow">
              {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
                <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-4 h-4 object-contain" />
              ) : (
                <span className="text-[9px] font-black text-white tracking-tighter drop-shadow-sm">{settings?.site_logo_text || "C2"}</span>
              )}
            </div>
            <span className="font-semibold text-sm text-zinc-900 dark:text-white truncate max-w-[160px]">{settings?.site_title || "ChatGPT2API Pro"}</span>
          </Link>

          {/* 细分隔线 */}
          <span className="w-px h-5 bg-zinc-200 dark:bg-white/10 mx-1" />

          {/* 导航链接 — active 态为药丸内填充高亮段 */}
          <nav className="flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-1.5 rounded-full text-[13px] flex items-center gap-1.5 transition-all ${
                    active
                      ? "text-zinc-900 dark:text-white font-medium bg-zinc-100 dark:bg-white/10"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/70 dark:hover:bg-white/5"
                  }`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* 细分隔线 */}
          <span className="w-px h-5 bg-zinc-200 dark:bg-white/10 mx-1" />

          {/* 操作区（右段） */}
          <div className="flex items-center gap-1">
            {user ? (
              <>
                <Link
                  href="/create"
                  className={`relative px-3.5 py-1.5 rounded-full text-[13px] font-medium flex items-center gap-1.5 transition-all ${
                    pathname === "/create"
                      ? "text-white bg-[linear-gradient(110deg,#0891b2,#6366f1)] shadow-[0_0_16px_-4px_rgba(34,211,238,0.7)]"
                      : "text-cyan-600 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-400/10"
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5" /> 创作中心
                </Link>

                {/* Avatar + Dropdown */}
                <div className="relative ml-0.5">
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-[linear-gradient(135deg,#22d3ee,#6366f1_60%,#e879f9)] ring-2 ring-white dark:ring-[#0b0e18] hover:shadow-[0_0_14px_-2px_rgba(34,211,238,0.8)] transition-all"
                  >
                    {user.name?.[0] || user.email?.[0] || "U"}
                  </button>

                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-2.5 w-48 bg-white dark:bg-[#0d101a] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-xl dark:shadow-cyan-500/5 z-20 py-1 overflow-hidden">
                        <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5">
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {user.name || user.email}
                          </p>
                          <p className="text-[10px] text-zinc-400 truncate mt-0.5">{user.email}</p>
                        </div>

                        <button
                          onClick={() => { toggleTheme(); setMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                        >
                          {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                          {dark ? "切换亮色模式" : "切换暗色模式"}
                        </button>

                        <Link
                          href="/user"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                        >
                          <User className="w-3.5 h-3.5" />
                          用户中心
                        </Link>

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
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
                  aria-label="切换明暗主题"
                >
                  {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                <Link href="/login" className="px-3 py-1.5 rounded-full text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-all">
                  登录
                </Link>
                <Link href="/register">
                  <Button size="sm" className="rounded-full text-[11px] h-7 px-3.5 font-semibold text-white border-0 bg-[linear-gradient(110deg,#0891b2,#6366f1)] hover:shadow-[0_0_18px_-4px_rgba(34,211,238,0.8)] hover:brightness-110 transition-all">
                    免费注册
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* ── 移动端：顶部细药丸（Logo + 主题切换，其余入口在底部 Tab 栏） ── */}
        <div
          className={`pointer-events-auto md:hidden flex items-center justify-between gap-3 w-full max-w-md h-12 pl-3 pr-2 rounded-full border transition-all duration-300 ${
            scrolled
              ? "border-zinc-200/80 dark:border-white/10 bg-white/85 dark:bg-[#0b0e18]/85 backdrop-blur-2xl shadow-lg shadow-zinc-900/10 dark:shadow-black/20"
              : "border-zinc-200/50 dark:border-white/[0.07] bg-white/70 dark:bg-[#0b0e18]/70 backdrop-blur-xl shadow-md shadow-zinc-900/5"
          }`}
        >
          <Link href="/" className="flex items-center gap-2 group min-w-0">
            <div className="relative w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#22d3ee,#6366f1_55%,#e879f9)] shadow-[0_0_16px_-4px_rgba(34,211,238,0.6)] shrink-0">
              {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
                <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="w-4 h-4 object-contain" />
              ) : (
                <span className="text-[9px] font-black text-white tracking-tighter drop-shadow-sm">{settings?.site_logo_text || "C2"}</span>
              )}
            </div>
            <span className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{settings?.site_title || "ChatGPT2API Pro"}</span>
          </Link>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all shrink-0"
            aria-label="切换明暗主题"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>

    {/* 移动端底部 Tab 栏（md 以下显示，桌面端隐藏） */}
    <MobileTabBar />
    </>
  );
}
