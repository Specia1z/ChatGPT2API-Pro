import type { Metadata } from "next";
import "./globals.css";
import { Geist, Fraunces } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// 英雄区标题用 — 编辑级衬线，与深色技术背景形成"画廊/高级"张力
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "ChatGPT2API Pro — AI 图片生成服务",
};

const themeScript = `
  (function(){
    try {
      var t = localStorage.getItem('theme') || 'dark';
      document.documentElement.classList.toggle('dark', t === 'dark');
    } catch(e) {}
  })()
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={cn("font-sans", geist.variable, fraunces.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script src="/config.js" />
      </head>
      <body className="bg-background text-foreground antialiased">
        <AuthProvider><TooltipProvider>{children}</TooltipProvider></AuthProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}
