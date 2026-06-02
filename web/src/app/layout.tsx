import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

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
    <html lang="zh-CN" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <AuthProvider><TooltipProvider>{children}</TooltipProvider></AuthProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}
