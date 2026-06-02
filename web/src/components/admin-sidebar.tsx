"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Outfit } from "next/font/google";
import {
  LayoutDashboard, Zap, Shield, Settings, ImageIcon,
  Package, Users, LogOut, Ticket, BarChart3, ChevronRight,
  ShoppingCart, Tag, Database, Sun, Moon,
} from "lucide-react";
import { setToken, BASE } from "@/lib/api";

const heading = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading" });

/* ── 导航分组 ──────────────────────────────── */
const navGroups = [
  {
    label: "概览",
    items: [
      { href: "/admin/stats", icon: BarChart3, label: "数据统计" },
    ],
  },
  {
    label: "账号",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "号池管理" },
      { href: "/admin/register", icon: Zap, label: "注册机" },
      { href: "/admin/monitor", icon: Shield, label: "账号监控" },
    ],
  },
  {
    label: "业务",
    items: [
      { href: "/admin/plans", icon: Package, label: "套餐管理" },
      { href: "/admin/orders", icon: ShoppingCart, label: "订单管理" },
      { href: "/admin/redeem", icon: Ticket, label: "兑换码" },
      { href: "/admin/coupons", icon: Tag, label: "优惠码" },
      { href: "/admin/users", icon: Users, label: "用户管理" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/storage", icon: Database, label: "存储配置" },
      { href: "/admin/settings", icon: Settings, label: "系统设置" },
      { href: "/admin/generations", icon: ImageIcon, label: "生图管理" },
    ],
  },
];

export function AdminSidebar() {
  const [settings, setSettings] = useState<any>(null);
  const [dark, setDark] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetch(`${BASE}/api/settings`).then(r => r.json()).then(d => { if (d?.data) setSettings(d.data); }).catch(() => {});
    setDark((localStorage.getItem("theme") || "dark") === "dark");
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <aside className={`${heading.variable} w-60 shrink-0 flex flex-col border-r bg-card`}>

      {/* ── Logo ── */}
      <Link href="/" className="flex items-center gap-3 px-5 py-4 border-b hover:bg-muted/40 transition-colors group">
        <div className="size-9 rounded-xl bg-primary flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform">
          {settings?.site_logo_type === "url" || settings?.site_logo_type === "upload" ? (
            <img src={settings.site_logo_url} alt={settings.site_logo_text || "Logo"} className="size-5 object-contain" />
          ) : (
            <span className="text-xs font-black text-primary-foreground tracking-tighter">{settings?.site_logo_text || "C2"}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className={`${heading.className} text-sm font-bold tracking-tight truncate`}>{settings?.site_title || "ChatGPT2API"}</p>
          <p className="text-[10px] text-muted-foreground tracking-wide">管理后台</p>
        </div>
      </Link>

      {/* ── Nav ── */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto scrollbar-thin">
        {navGroups.map(group => (
          <div key={group.label}>
            <div className="px-3 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                {group.label}
              </span>
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href}
                    className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                      active
                        ? "text-primary bg-primary/10 font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    }`}>
                    {active && (
                      <motion.span layoutId="sidebar-active"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                    )}
                    <item.icon className={`size-[18px] shrink-0 transition-transform ${active ? "" : "group-hover:scale-110"}`} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="px-3 py-3 border-t space-y-0.5">
        <button onClick={toggleTheme}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors w-full">
          {dark ? <Sun className="size-[18px] shrink-0" /> : <Moon className="size-[18px] shrink-0" />}
          <span>{dark ? "亮色模式" : "暗色模式"}</span>
        </button>
        <button onClick={() => { setToken(null); router.push("/login"); }}
          className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full">
          <LogOut className="size-[18px] shrink-0" />
          <span className="flex-1 text-left">退出登录</span>
          <ChevronRight className="size-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </button>
      </div>
    </aside>
  );
}
