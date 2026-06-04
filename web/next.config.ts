import type { NextConfig } from "next";

const apiURL = process.env.NEXT_PUBLIC_API_URL;

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // standalone：构建出自包含的最小运行产物，Docker 运行时无需完整 node_modules
  output: "standalone",
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
