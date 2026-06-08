// 同源部署（Nginx 统一入口）下留空：所有请求走相对路径 /api，由反代转发到后端，天然无 CORS。
// 本地开发同样留空，由 next.config.ts 的 rewrites 把 /api 代理到 8080。
// 运行时可通过 public/config.js 的 window.RUNTIME_API_URL 配置，优先级最高。
// 构建期可通过 NEXT_PUBLIC_API_URL 注入。
const runtimeURL = typeof window !== "undefined" ? (window as any).RUNTIME_API_URL : "";
export const BASE = runtimeURL || process.env.NEXT_PUBLIC_API_URL || "";

let token: string | null = null;

// 写图片代理用的 cookie。img 标签无法带 Authorization 头，故 token 同步进 cookie。
// 加固：SameSite=Strict 防 CSRF；HTTPS 下加 Secure 防明文传输（本地 http 不加，否则 cookie 不生效）。
// 注：因 img 需读取，无法用 HttpOnly（那样 img 仍能带但属同一权衡）；存储型 XSS 入口已由 SVG sanitize 堵住。
function writeTokenCookie(t: string | null) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  if (t) {
    document.cookie = `token=${t}; path=/; max-age=86400; SameSite=Strict${secure}`;
  } else {
    document.cookie = `token=; path=/; max-age=0; SameSite=Strict${secure}`;
  }
}

if (typeof window !== "undefined") {
  token = localStorage.getItem("auth-token");
  if (token) writeTokenCookie(token);
}

export function getToken() { return token; }
export function setToken(t: string | null) {
  token = t;
  if (t) {
    localStorage.setItem("auth-token", t);
    writeTokenCookie(t);
  } else {
    localStorage.removeItem("auth-token");
    writeTokenCookie(null);
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
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`) as Error & { status?: number; code?: number };
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}
