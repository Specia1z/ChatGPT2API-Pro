import type { NextConfig } from "next";

const apiURL = process.env.NEXT_PUBLIC_API_URL;
const isDev = process.env.NODE_ENV !== "production";

// 安全响应头。CSP 采用务实策略：允许 inline script/style（Next 主题脚本与样式需要），
// 但收紧高危项——禁 object、禁被嵌入(frame-ancestors none 防点击劫持)、限制资源来源。
// 完整 nonce 级 CSP 后续可迭代；当前先覆盖最实用的防护。
// dev 下 connect-src 额外放行 http/ws localhost——本地前端直连 http://localhost:8080 后端 + HMR，
// 否则严格 CSP 会拦掉跨端口 http 请求导致 "Failed to fetch"。生产同源(self/https)不受影响。
const connectSrc = isDev
  ? "connect-src 'self' https: http://localhost:* ws://localhost:* ws://127.0.0.1:*"
  : "connect-src 'self' https:";
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      connectSrc,
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // standalone：构建出自包含的最小运行产物，Docker 运行时无需完整 node_modules
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    // 仅当显式配置了后端地址时才挂 rewrites（本地开发把 /api 代理到 8080）。
    // 生产同源部署下不设此变量，由 Nginx 统一反代 /api 与 /uploads 到后端，前端只处理页面。
    if (!apiURL) return [];
    return [
      { source: "/api/:path*", destination: `${apiURL}/api/:path*` },
    ];
  },
};

export default nextConfig;
