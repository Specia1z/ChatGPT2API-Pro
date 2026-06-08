import type { NextConfig } from "next";

const apiURL = process.env.NEXT_PUBLIC_API_URL;

// 安全响应头。CSP 采用务实策略：允许 inline script/style（Next 主题脚本与样式需要），
// 但收紧高危项——禁 object、禁被嵌入(frame-ancestors none 防点击劫持)、限制资源来源。
// 完整 nonce 级 CSP 后续可迭代；当前先覆盖最实用的防护。
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
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
