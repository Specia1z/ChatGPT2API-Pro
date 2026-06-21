<div align="center">

# 🎨 ChatGPT2API Pro

<sup>_AI 图片与矢量生成平台 · 用户系统 · 订阅计费 · 运营后台 · 开发者 API_</sup>

[![Go 1.24](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![MySQL 8](https://img.shields.io/badge/MySQL-8-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com)
[![Redis 7](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)

</div>

---

> [!CAUTION]
> **独立项目声明**
>
> 本项目（ChatGPT2API Pro）是一个**独立开发的开源项目**，与下列实体**不存在任何形式的关联、合作、赞助或隶属关系**：
> - OpenAI, Inc. 及其关联公司（包括但不限于 ChatGPT、GPT、DALL·E 等产品线）
> - Anthropic, Inc.（Claude 系列产品）
> - Google LLC（Gemini、Imagen 等）
> - Microsoft Corporation（Azure OpenAI Service、Copilot 等）
> - 以及其他 AI 模型 / 云服务提供商
>
> 项目名称中包含的「ChatGPT」字样**仅用于描述技术兼容性**（即支持 OpenAI API 格式的请求与响应），**不构成商标侵权意图**，亦不暗示任何形式的官方认证或背书。
>
> 上述公司及其产品的名称和商标均为其各自所有者的财产。

> [!WARNING]
> **使用须知与免责声明**
>
> 本项目仅供**学习、研究及个人非商业用途**，使用者不得将其用于任何违反法律法规或第三方服务条款的活动。本项目本身**不提供任何 AI 模型服务**，所有生成能力均依赖于用户自行注册的第三方 API 账户，相关费用、合规义务由用户自行承担。
>
> 开发者按「**现状（AS IS）**」提供本项目，不作任何明示或默示担保。在任何情况下，开发者均不对因使用本项目而产生的任何直接或间接损害承担责任，包括但不限于账户封禁、版权纠纷、数据丢失及 API 费用损失。使用本项目即表示您已**阅读、理解并同意**以上条款，如不同意请立即停止使用。

---

## ✨ 功能矩阵

<table>
<tr>
<td width="50%" valign="top">

### 👤 用户端

| 🎯 能力 | ✨ 特性 |
|---|---|
| 🖼️ **图片生成** | 文生图 · 图生图 · 创意增强 · 背景移除 · 图生文 |
| ✏️ **矢量生成** | AI SVG 流式输出 · SSE 实时预览 · 可缩放无损 |
| 💎 **提示词工具** | AI 智能润色 · 20+ 风格预设 · 批量一键出图 |
| 🌐 **API 网关** | RESTful · OpenAI 兼容 · Webhook 回调 · Python SDK |
| 🏪 **用户中心** | 注册登录 · JWT 鉴权 · API Key 管理 · 用量仪表盘 · 每日签到 |
| 📦 **账户体系** | 订阅套餐 · 令牌桶限流 · 邀请裂变 · 积分商城 · 兑换码 · 优惠券 |
| 💳 **支付集成** | 支付宝 · Linux Do Credit |
| 📢 **消息通知** | SMTP 邮件验证 · 公告横幅 · 弹窗推送 |

</td>
<td width="50%" valign="top">

### 🛠️ 运营后台

| 🎯 模块 | ✨ 能力 |
|---|---|
| 📊 **数据看板** | 用户 · 订单 · 生成量 · 收入统计 · 转化率 · ARPU |
| 📡 **系统监控** | SSE 实时推送 QPS · 性能 · 号池 · 定时器 |
| 📜 **API 日志** | 全站实时流 · 历史分页 · IP/端点/状态筛选 · 提示词 · 图片地址 |
| 🛡️ **风险评分** | 四维加权模型 · Redis 实时计数 · 自动封禁 · 限流降级 |
| 🤖 **号池管理** | 批量导入 · 健康监控 · 异常清理 · 智能补号 · 注册机 |
| 📣 **公告管理** | Banner + 弹窗双模式 · 类型 · 优先级 · 时间窗 |
| ⚙️ **系统设置** | 存储模式 · 调度并发 · 限速 · 缓存 · 风险阈值 |
| 🗑️ **图片管理** | 瀑布展示 · 批量删除 · S3/本地存储 |

</td>
</tr>
</table>

### 🔌 开发者 API

```bash
# OpenAI 兼容同步生图
curl -X POST /v1/images/generations \
  -H "Authorization: Bearer sk-xxx" \
  -d '{"prompt":"A cute cat","n":1,"size":"1:1"}'

# 原生异步生图 · 矢量生成 · 图生文 · 智能增强 · 背景移除
# 完整文档见 /docs · Python SDK 见 sdk/
```

---

## ⚡ 高并发设计

充分利用 Go 语言的并发特性，在**请求热路径**上做到零阻塞、零额外分配：

| 机制 | 实现方式 | Go 特性 |
|---|---|---|
| **QPS 实时采集** | `atomic` 环形桶，60 秒滑动窗口，无锁读写 | `sync/atomic` |
| **API 日志落库** | `channel` 非阻塞投递 + goroutine 定时/定量双触发批量 INSERT，满即丢弃永不阻塞请求 | `chan` · `goroutine` |
| **生图并发闸门** | 全局 / 单用户 / 单账号三级 `sync.Mutex` 计数限流，后台可热调 | `sync.Mutex` |
| **配置热缓存** | `sync.RWMutex` 保护进程内缓存，TTL 过期 + 写后主动失效，减少数据库压力 | `sync.RWMutex` |
| **API Key 限流** | Redis 原子滑动窗口，优先级链：套餐速率 → 后台默认 → 内置兜底 | Redis `INCR` + `EXPIRE` |
| **SSE 实时推送** | `channel` pub/sub 广播，订阅者非阻塞 send，掉队丢弃不拖慢发布者 | `select default` |
| **风险指标采集** | 每请求 Redis 原子计数器，定时批量合并到 DB，`sync.Map` 缓存限流名单 | `sync.Map` |
| **优雅退出** | `defer` 链保证 `apilog.Writer` flush 剩余缓冲 + DB/Redis 连接关闭 | `defer` |
| **HTTP 服务** | 显式 `http.Server`，`ReadHeaderTimeout` 防慢连接，不设 `WriteTimeout` 保 SSE 长连接 | `net/http` |

> 💡 **热路径原则**：所有中间件链上的操作均使用原子指令或无锁结构，GC 友好的值类型传递，避免在请求路径上分配堆内存。

---

## 🏗️ 技术架构

<div align="center">

```
┌──────────────────────────────────────────────────────┐
│  🌐 Nginx · SSL 终端 · 反向代理 · 静态资源              │
├──────────────────────────────────────────────────────┤
│  ⚛️  Next.js 16 · React 19 · Tailwind CSS 4           │
│  🎬  Framer Motion · Recharts · Lucide · Sonner        │
├──────────────────────────────────────────────────────┤
│  🔧  Go 1.24 · net/http · SSE · Webhook                │
│  🗄️  MySQL 8 (InnoDB · utf8mb4) · Redis 7              │
│  📦  S3 Compatible · 本地文件 · 数据库混合存储          │
├──────────────────────────────────────────────────────┤
│  🐳  Docker Compose · 单命令部署                       │
└──────────────────────────────────────────────────────┘
```

</div>

| 分类 | 技术选型 |
|---|---|
| 后端语言 | `Go` 1.24 |
| 前端框架 | `Next.js` 16 · `React` 19 · `TypeScript` |
| 样式方案 | `Tailwind CSS` 4 · Dark Mode · 响应式 · `framer-motion` |
| 数据存储 | `MySQL` 8 · `Redis` 7 |
| 图表监控 | `Recharts` · SSE 实时流 · QPS 滑动窗口 |
| 安全防护 | `JWT` · `Turnstile` 人机验证 · `bcrypt` · IP 信任链 |
| 部署方案 | `Docker` · `Docker Compose` · Nginx 反代 |

---

## 🚀 快速开始

<details open>
<summary><b>💻 本地开发</b></summary>

```bash
# 1️⃣ 起 MySQL + Redis（容器，避开本地端口冲突）
docker compose up -d
# → MySQL :3307  Redis :6380

# 2️⃣ 后端
cd server
cp .env.example .env
# 编辑 .env：MYSQL_PORT=3307  REDIS_PORT=6380  JWT_SECRET=随意写一个
go run .

# 3️⃣ 前端
cd web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" > .env.local
npm run dev
# → http://localhost:3000
```

</details>

<details>
<summary><b>🚢 生产部署</b></summary>

```bash
# 1. 配置环境变量
cp .env.prod.example .env.prod
# 编辑 .env.prod：JWT_SECRET 必须改为强随机值！

# 2. 一键部署
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 3. 首次重置管理员密码
docker compose -f docker-compose.prod.yml exec backend /app/reset_admin admin '你的强密码'
```

> **💡 提示**：生产环境建议用宝塔 Nginx 反代 `/api` → `127.0.0.1:8080`，`/` → `127.0.0.1:3000`

</details>

---

## 📂 项目结构

```
📦 chatgpt2api-pro
├── 📁 server/                  # Go 后端
│   ├── 📄 main.go              # 入口 · 依赖注入
│   ├── 📁 internal/
│   │   ├── 📁 api/             # HTTP handler（按领域拆分）
│   │   ├── 📁 apilog/          # API 调用日志异步批量写入器
│   │   ├── 📁 config/          # 环境变量加载
│   │   ├── 📁 metrics/         # QPS 滑动窗口
│   │   ├── 📁 middleware/      # 鉴权 · 限流 · 安全头 · CORS
│   │   ├── 📁 model/           # 数据模型
│   │   ├── 📁 service/         # 注册机 · 监控 · 生图 · 调度 · 评分
│   │   ├── 📁 storage/         # DB / Local / S3 存储后端
│   │   └── 📁 store/           # MySQL · Redis（按领域拆分）
│   └── 🐳 Dockerfile
├── 📁 web/                     # Next.js 前端
│   ├── 📁 src/app/             # App Router 页面
│   ├── 📁 src/components/      # UI 组件库
│   └── 🐳 Dockerfile
├── 📁 sdk/python/img2design/   # Python SDK
├── 📁 docs/superpowers/        # 设计文档 · 实现计划
├── 🐳 docker-compose.yml       # 本地开发
├── 🐳 docker-compose.prod.yml  # 生产编排
├── 📄 .env.prod.example        # 生产环境变量模板
└── 📄 README.md
```

---

## ⚙️ 环境变量

<details open>
<summary><b>后端</b></summary>

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | MySQL 连接 |
| `MYSQL_USER` / `MYSQL_PASS` / `MYSQL_DB` | `root` / _(空)_ / `chatgpt2api_pro` | 数据库认证 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASS` | `127.0.0.1` / `6379` / _(空)_ | Redis 连接 |
| `JWT_SECRET` | `change-me` | 🔐 **生产必须改为强随机值** |
| `SUPERADMIN_EMAIL` | _(空)_ | 超级管理员邮箱 |
| `ALLOWED_ORIGINS` | _(空)_ | 额外 CORS 来源（逗号分隔） |

> ⚠️ **注意**：`WriteTimeout` 未设置 — SSE 长连接（日志 · 监控）依赖无限写入时限。

</details>

<details>
<summary><b>前端</b></summary>

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_API_URL` | 开发环境指向后端；生产同源部署无需设置 |

</details>

---

## 📡 API 概览

<details open>
<summary><b>🔓 公开接口</b></summary>

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/plans` | 📋 套餐列表 |
| `GET` | `/api/settings` | ⚙️ 站点配置 |
| `GET` | `/api/announcements` | 📣 当前公告 |
| `GET` | `/api/gallery` | 🖼️ 作品广场 |
| `GET` | `/api/images/{id}` | 🖼️ 图片代理 |

</details>

<details>
<summary><b>🔐 用户接口</b> (JWT 鉴权)</summary>

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` | ✍️ 注册 |
| `POST` | `/api/auth/login` | 🔑 登录 |
| `POST` | `/api/user/keys` | 🔑 创建 API Key |
| `GET` | `/api/user/api-usage/summary` | 📊 用量概览 |
| `GET` | `/api/user/api-usage/logs` | 📜 调用明细 |
| `POST` | `/api/generations` | 🎨 创建生图 |
| `POST` | `/api/vector` | ✏️ 创建矢量 |

</details>

<details>
<summary><b>🛡️ 管理接口</b> (Admin 鉴权)</summary>

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/stats` | 📊 数据统计 |
| `GET` | `/api/admin/system/events` | 📡 系统监控 SSE |
| `GET` | `/api/admin/api-logs` | 📜 全站日志 |
| `GET` | `/api/admin/api-logs/events` | 📡 实时调用流 SSE |
| `GET` | `/api/admin/risk/scores` | 🛡️ 风险评分 |
| `POST` | `/api/admin/generations/batch-delete` | 🗑️ 批量清理 |

</details>

---

## 🔒 安全

| 🛡️ 措施 | 📋 说明 |
|---|---|
| 🔑 JWT 鉴权 | 用户 + Admin 双通道，24h 过期 |
| 🗝️ API Key | `sk-` 前缀，用户自管启用/禁用 |
| 🤖 Turnstile | Cloudflare 人机验证（注册 · 登录 · 支付） |
| 🔐 密码策略 | bcrypt 哈希 · 失败限流 · 邮箱验证码 |
| 🌐 IP 信任 | X-Real-IP → X-Forwarded-For → RemoteAddr |
| 🧱 安全头 | CSP · HSTS · X-Content-Type-Options |
| 🕵️ 密钥保护 | 公开接口抹除 · 回写保留旧值防覆盖 |

---

## 📄 开源许可

<div align="center">

本项目基于 **MIT License** 开源

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

<sub>Made with ❤️ by Specia1z</sub>

</div>
