// 同源部署（Nginx 统一入口）下留空：所有请求走相对路径 /api，由反代转发到后端，天然无 CORS。
// 本地开发同样留空，由 next.config.ts 的 rewrites 把 /api 代理到 8080。
// 运行时可通过 public/config.js 的 window.RUNTIME_API_URL 配置，优先级最高。
// 构建期可通过 NEXT_PUBLIC_API_URL 注入。
const runtimeURL = typeof window !== "undefined" ? (window as any).RUNTIME_API_URL : "";
export const BASE = runtimeURL || process.env.NEXT_PUBLIC_API_URL || "";

let token: string | null = null;
if (typeof window !== "undefined") {
  token = localStorage.getItem("auth-token") || localStorage.getItem("admin-token");
  // 同步写入 cookie，供 img 标签自动携带（img 无法发送 Authorization 头）
  if (token) document.cookie = `token=${token}; path=/; max-age=86400`;
}

export function getToken() { return token; }
export function setToken(t: string | null) {
  token = t;
  if (t) {
    localStorage.setItem("auth-token", t);
    document.cookie = `token=${t}; path=/; max-age=86400`;
  } else {
    localStorage.removeItem("auth-token");
    document.cookie = "token=; path=/; max-age=0";
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth-token");
      localStorage.removeItem("user-data");
      setToken(null);
      window.location.replace("/login");
    }
    throw new Error("登录已过期，请重新登录");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}
