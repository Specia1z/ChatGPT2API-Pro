"use client";

import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { Copy, Check, KeyRound, Image as ImageIcon, Clock, AlertTriangle, Terminal, Shapes } from "lucide-react";

/* ── 复制按钮 ─────────────────────────────── */
function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  return (
    <div className="relative group">
      <button onClick={copy}
        className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-zinc-300 text-[11px] font-medium transition-colors">
        {copied ? <><Check className="w-3 h-3 text-emerald-400" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
      </button>
      <pre className="overflow-x-auto scrollbar-thin rounded-xl bg-zinc-900 dark:bg-black/40 border border-zinc-800 p-4 pr-20 text-[12.5px] leading-relaxed">
        <code className="font-mono text-zinc-200 whitespace-pre">{code}</code>
      </pre>
      <span className="absolute left-3 bottom-2 text-[9px] font-mono text-zinc-600 uppercase tracking-wider pointer-events-none">{lang}</span>
    </div>
  );
}

/* ── 字段表 ─────────────────────────────────── */
function FieldTable({ rows }: { rows: { name: string; type: string; required: string; desc: string }[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm border-collapse min-w-[520px]">
        <thead>
          <tr className="bg-zinc-50 dark:bg-zinc-900/60 text-left">
            <th className="px-4 py-2.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">字段</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">类型</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">必填</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">说明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.name} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30">
              <td className="px-4 py-2.5 font-mono text-[12.5px] text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{r.name}</td>
              <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-500">{r.type}</td>
              <td className="px-4 py-2.5">
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.required === "是" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500"}`}>{r.required}</span>
              </td>
              <td className="px-4 py-2.5 text-[12.5px] text-zinc-600 dark:text-zinc-400">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Section 容器 ─────────────────────────── */
function Section({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0">
          {icon}
        </div>
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function DocsPage() {
  return <DocsContent />;
}

const SIZES = "1:1 · 4:3 · 3:4 · 16:9 · 9:16 · 16:10 · 10:16 · 4:5 · 5:4 · 2:3 · 3:2 · 21:9 · HD · 2K · 4K · 8K · A4";

const NAV = [
  { id: "auth", label: "认证" },
  { id: "create", label: "提交生图" },
  { id: "query", label: "查询结果" },
  { id: "tokens", label: "查询额度" },
  { id: "openai", label: "OpenAI 兼容" },
  { id: "vector", label: "矢量图(SVG)" },
  { id: "errors", label: "错误码" },
  { id: "limits", label: "限流与配额" },
];

function DocsContent() {
  // 站点地址：客户端取当前访问的 origin，使示例可直接复制使用；SSR 阶段用占位
  const [origin, setOrigin] = useState("https://your-domain.com");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-16 md:pb-0">
      <Navbar />

      {/* Hero */}
      <div className="border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-500 mb-4 tracking-wide">
            <Terminal className="w-3 h-3" /> API 文档
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3">
            生图 API 接入指南
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-2xl">
            用你在「用户中心 → API 密钥」创建的 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">sk-</code> 密钥，
            即可在自己的程序里调用生图接口。接口为<strong className="text-zinc-700 dark:text-zinc-300">异步</strong>设计：提交后返回任务 ID，再轮询查询结果。
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex gap-8">
        {/* 侧边导航（桌面端） */}
        <aside className="hidden lg:block w-44 shrink-0">
          <nav className="sticky top-20 space-y-1">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`}
                className="block px-3 py-1.5 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                {n.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* 正文 */}
        <div className="flex-1 min-w-0 space-y-12">

          {/* 认证 */}
          <Section id="auth" icon={<KeyRound className="w-4 h-4" />} title="认证">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              所有 API 请求都需在请求头携带你的密钥，使用 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Bearer</code> 方案。
              密钥以 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">sk-</code> 开头，在用户中心创建与管理。
            </p>
            <CodeBlock lang="http" code={`Authorization: Bearer sk-你的密钥`} />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              基础地址为你的站点域名 + <code className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">/api/v1</code>，
              下文示例已自动填入当前站点地址 <code className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{origin}</code>。
            </p>
          </Section>

          {/* 提交生图 */}
          <Section id="create" icon={<ImageIcon className="w-4 h-4" />} title="提交生图任务">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">POST</span>
              <code className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">/api/v1/images/generations</code>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              提交一个生图请求。接口立即返回任务 ID 与 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">pending</code> 状态，
              图片在后台生成，需通过下方「查询结果」接口轮询获取。
            </p>
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">请求参数</h3>
            <FieldTable rows={[
              { name: "prompt", type: "string", required: "是", desc: "提示词，最长 2000 字符" },
              { name: "size", type: "string", required: "否", desc: `图片比例/尺寸，默认 1:1。可选：${SIZES}` },
              { name: "count", type: "int", required: "否", desc: "生成数量，默认 1，范围 1–10（受套餐并发与令牌限制）" },
              { name: "ref_images_b64", type: "string[]", required: "否", desc: "参考图（图生图），每项为裸 base64，整体请求体 ≤10MB" },
              { name: "model", type: "string", required: "否", desc: "模型标识，默认 gpt-image-2" },
            ]} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">请求示例</h3>
            <CodeBlock code={`curl -X POST ${origin}/api/v1/images/generations \\
  -H "Authorization: Bearer sk-你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "A serene mountain landscape at sunset, oil painting",
    "size": "16:9",
    "count": 2
  }'`} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">响应</h3>
            <CodeBlock lang="json" code={`{
  "code": 200,
  "data": {
    "ids": [12345, 12346],
    "count": 2,
    "status": "pending"
  }
}`} />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              <code className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">ids</code> 为本次提交的任务 ID 列表（count &gt; 1 时返回多个），用于后续查询匹配。
            </p>
          </Section>

          {/* 查询结果 */}
          <Section id="query" icon={<Clock className="w-4 h-4" />} title="查询生成结果">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">GET</span>
              <code className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">/api/v1/images/generations</code>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              分页返回你账号下的生成记录（按时间倒序）。提交后建议每 <strong className="text-zinc-700 dark:text-zinc-300">3–5 秒</strong>轮询一次，
              在结果里用提交时拿到的 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">id</code> 匹配对应任务，直到其 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">status</code> 变为 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">completed</code> 或 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">failed</code>。
            </p>
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">查询参数</h3>
            <FieldTable rows={[
              { name: "page", type: "int", required: "否", desc: "页码，默认 1" },
              { name: "page_size", type: "int", required: "否", desc: "每页条数，默认 12，最大 50" },
            ]} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">请求示例</h3>
            <CodeBlock code={`curl ${origin}/api/v1/images/generations?page=1&page_size=20 \\
  -H "Authorization: Bearer sk-你的密钥"`} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">响应</h3>
            <CodeBlock lang="json" code={`{
  "code": 200,
  "data": {
    "items": [
      {
        "id": 12345,
        "prompt": "A serene mountain landscape...",
        "model": "gpt-image-2",
        "size": "16:9",
        "status": "completed",
        "image_url": "${origin}/api/images/12345",
        "image_b64": "",
        "error_msg": "",
        "created_at": "2026-06-06T10:30:45Z"
      }
    ],
    "total": 42,
    "page": 1,
    "page_size": 20
  }
}`} />
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-4 space-y-2 text-[13px] text-zinc-600 dark:text-zinc-400">
              <p><strong className="text-zinc-700 dark:text-zinc-300">status</strong> 取值：<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">pending</code>（排队/生成中）、<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">completed</code>（成功）、<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">failed</code>（失败，原因见 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">error_msg</code>）。</p>
              <p><strong className="text-zinc-700 dark:text-zinc-300">图片获取</strong>：<code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">image_url</code> 为带签名的代理地址（形如 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">/api/images/&#123;id&#125;?exp=...&amp;sig=...</code>），可直接 GET 下载，链接有效期 24 小时。无论后端用对象存储还是数据库存储，统一通过此地址获取，无需关心底层存储。</p>
              <p className="text-amber-600 dark:text-amber-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>任务若超过 15 分钟仍未完成，将自动标记为 failed（生成超时）。</span></p>
            </div>
          </Section>

          {/* 查询额度 */}
          <Section id="tokens" icon={<Terminal className="w-4 h-4" />} title="查询令牌额度">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">GET</span>
              <code className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">/api/v1/user/tokens</code>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              查询当前可用令牌、桶容量、恢复速率与并发上限，便于在调用前判断额度。
            </p>
            <CodeBlock lang="json" code={`{
  "code": 200,
  "data": {
    "tokens": 48.5,
    "capacity": 50,
    "refill": 3,
    "plan": "免费版",
    "concurrency": 1
  }
}`} />
          </Section>

          {/* OpenAI 兼容 */}
          <Section id="openai" icon={<ImageIcon className="w-4 h-4" />} title="OpenAI 兼容接口">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">POST</span>
              <code className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">/v1/images/generations</code>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              与 OpenAI 官方 Images 接口对齐的<strong className="text-zinc-700 dark:text-zinc-300">同步</strong>接口：一次请求阻塞直到图片生成完成，直接返回结果，无需轮询。
              可直接用 OpenAI 官方 SDK，只需把 <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">base_url</code> 指向本站、
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">api_key</code> 用你的 sk- 密钥。
            </p>
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">请求参数</h3>
            <FieldTable rows={[
              { name: "prompt", type: "string", required: "是", desc: "提示词，最长 2000 字符" },
              { name: "n", type: "int", required: "否", desc: "生成数量，默认 1，范围 1–10（受套餐并发与令牌限制）" },
              { name: "size", type: "string", required: "否", desc: "支持 OpenAI 像素尺寸（1024x1024 / 1792x1024 / 1024x1792 等）或内部比例（16:9 / 2K / A4 等），默认 1:1" },
              { name: "response_format", type: "string", required: "否", desc: "b64_json（默认）返回 base64，或 url 返回图片链接" },
              { name: "model", type: "string", required: "否", desc: "兼容字段，内部固定 gpt-image-2" },
            ]} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">cURL 示例</h3>
            <CodeBlock code={`curl -X POST ${origin}/v1/images/generations \\
  -H "Authorization: Bearer sk-你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "A cute corgi astronaut, studio lighting",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'`} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">Python（OpenAI SDK）</h3>
            <CodeBlock lang="python" code={`from openai import OpenAI

client = OpenAI(
    api_key="sk-你的密钥",
    base_url="${origin}/v1",
)

resp = client.images.generate(
    prompt="A cute corgi astronaut, studio lighting",
    n=1,
    size="1024x1024",
    response_format="b64_json",
)
print(resp.data[0].b64_json[:40])`} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">响应</h3>
            <CodeBlock lang="json" code={`{
  "created": 1733480000,
  "data": [
    { "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..." }
  ]
}`} />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              出错时返回 OpenAI 风格 <code className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{`{ "error": { "message", "type", "code" } }`}</code>。
            </p>
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">response_format: "url"</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              返回带签名的<strong className="text-zinc-700 dark:text-zinc-300">临时图片链接</strong>，无需登录态即可直接访问，
              有效期 <strong className="text-zinc-700 dark:text-zinc-300">24 小时</strong>，过期或篡改后失效。适合不想处理 base64 的场景。
            </p>
            <CodeBlock lang="json" code={`{
  "created": 1733480000,
  "data": [
    { "url": "${origin}/api/images/12345?exp=1733566400&sig=..." }
  ]
}`} />
            <div className="rounded-xl border border-amber-300/40 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/[0.06] p-4 flex items-start gap-2 text-[13px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>这是<strong>同步</strong>接口，单次请求会阻塞直到出图，通常耗时 10–30 秒（n 越大越久）。请把客户端 / SDK 的超时设到 <strong>60 秒以上</strong>，否则可能在图片生成完成前被客户端中断。</span>
            </div>
          </Section>

          {/* 矢量图 SVG */}
          <Section id="vector" icon={<Shapes className="w-4 h-4" />} title="矢量图生成 (SVG)">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">POST</span>
              <code className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">/api/v1/vector</code>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              用 AI 文本模型生成 <strong className="text-zinc-700 dark:text-zinc-300">SVG 矢量图</strong>（可无限缩放、可编辑）。
              <strong className="text-zinc-700 dark:text-zinc-300">同步</strong>接口，一次请求阻塞直到生成完成，直接返回 SVG 源码。
              使用的模型由站点管理员统一配置（你无需也无法指定）。
            </p>
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">请求参数</h3>
            <FieldTable rows={[
              { name: "prompt", type: "string", required: "是", desc: "图形描述，最长 2000 字符。例如「一个简约的蓝色火箭图标，扁平风格」" },
            ]} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">cURL 示例</h3>
            <CodeBlock code={`curl -X POST ${origin}/api/v1/vector \\
  -H "Authorization: Bearer sk-你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{ "prompt": "一个简约的蓝色火箭图标，扁平风格" }'`} />
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 pt-1">响应</h3>
            <CodeBlock lang="json" code={`{
  "code": 200,
  "data": {
    "id": 12345,
    "model": "gpt-5.3",
    "svg": "<svg viewBox=\\"0 0 128 128\\" xmlns=\\"http://www.w3.org/2000/svg\\">...</svg>"
  }
}`} />
            <div className="space-y-1.5 text-xs text-zinc-500 dark:text-zinc-500 pt-1">
              <p><strong className="text-zinc-700 dark:text-zinc-300">svg</strong> 字段即可直接渲染或保存为 .svg 文件。</p>
              <p>每次生成与生图<strong className="text-zinc-700 dark:text-zinc-300">共用令牌</strong>（消耗规则同下方「限流与配额」）。</p>
            </div>
            <div className="rounded-xl border border-amber-300/40 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/[0.06] p-4 flex items-start gap-2 text-[13px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>同步接口，单次通常耗时 5–30 秒；请把客户端超时设到 <strong>60 秒以上</strong>。若管理员未配置矢量模型，返回 <strong>503</strong>。</span>
            </div>
          </Section>

          {/* 错误码 */}
          <Section id="errors" icon={<AlertTriangle className="w-4 h-4" />} title="错误码">
            <FieldTable rows={[
              { name: "400", type: "Bad Request", required: "—", desc: "参数错误：prompt 为空/超长、含违规词、并发超限、参考图过大等" },
              { name: "401", type: "Unauthorized", required: "—", desc: "缺少 API Key、格式非 sk-、密钥无效或已禁用、订阅过期" },
              { name: "413", type: "Payload Too Large", required: "—", desc: "请求体超过 10MB（参考图过大）" },
              { name: "429", type: "Too Many Requests", required: "—", desc: "触发 IP 限流、令牌不足或系统并发已满" },
              { name: "500", type: "Server Error", required: "—", desc: "服务端异常" },
            ]} />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">错误响应统一格式：</p>
            <CodeBlock lang="json" code={`{
  "code": 429,
  "message": "令牌不足 (剩余 18, 需 20 个, 等待 1800s)"
}`} />
          </Section>

          {/* 限流与配额 */}
          <Section id="limits" icon={<Clock className="w-4 h-4" />} title="限流与配额">
            <ul className="space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-zinc-400 shrink-0" />
                <span><strong className="text-zinc-700 dark:text-zinc-300">IP 速率</strong>：每个 IP 限 10 次/秒，超出返回 429。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-zinc-400 shrink-0" />
                <span><strong className="text-zinc-700 dark:text-zinc-300">令牌桶</strong>：每张图/每次矢量生成消耗固定令牌数（默认 1，由管理员配置）；生成 count 张即消耗 count × 单价。令牌按套餐速率每小时恢复，不足时返回 429 并提示等待时长。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-zinc-400 shrink-0" />
                <span><strong className="text-zinc-700 dark:text-zinc-300">并发</strong>：单次提交的 count 不能超过套餐并发上限，超出返回 400。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-zinc-400 shrink-0" />
                <span>建议轮询间隔不低于 3 秒，避免触发 IP 速率限制。</span>
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
