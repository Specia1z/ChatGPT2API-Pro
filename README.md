<div align="center">

# 🎨 ChatGPT2API Pro

<sup>_AI 图片与矢量生成平台 · 用户体系 · 订阅计费 · 运营后台 · 开发者 API_</sup>

<br/>

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)

</div>

---

> [!CAUTION]
> ### 独立项目声明
>
> 本项目（ChatGPT2API Pro）是一个**独立开发的开源项目**，与下列实体**不存在任何形式的关联、合作、赞助或隶属关系**：
>
> - OpenAI, Inc.（含 ChatGPT、GPT、DALL·E 等产品）
> - Anthropic, Inc.（Claude 系列）
> - Google LLC（Gemini、Imagen 等）
> - Microsoft Corporation（Azure OpenAI Service、Copilot 等）
> - 以及其他任何 AI 模型 / 云服务提供商
>
> 项目名称中的「ChatGPT」字样**仅用于描述技术兼容性**（即支持 OpenAI 风格的 API 请求与响应格式），**不构成商标侵权意图**，亦不暗示任何官方认证或背书。上述公司及其产品名称、商标均为各自所有者的财产。

> [!WARNING]
> ### 使用须知与免责声明
>
> - 本项目仅供**学习、研究与个人非商业用途**。使用者不得将其用于任何违反法律法规或第三方服务条款的活动。
> - 本项目**自身不提供任何 AI 模型服务**。所有生成能力均依赖使用者**自行配置的第三方账户 / API**，由此产生的费用、合规义务、封号风险及版权责任**全部由使用者自行承担**。
> - 软件按「**现状（AS IS）**」提供，不作任何明示或默示担保。在任何情况下，开发者均不对因使用本项目而产生的任何直接或间接损失负责，包括但不限于账户封禁、版权纠纷、数据丢失与 API 费用。
> - 使用本项目即表示您已**阅读、理解并同意**上述条款。如不同意，请立即停止使用。

---

## ✨ 功能总览

<table>
<tr>
<td width="50%" valign="top">

### 👤 用户端

| 能力 | 说明 |
|---|---|
| 🖼️ **图片生成** | 文生图 · 图生图 · 智能增强 · 背景移除 · 图生文 |
| ✏️ **矢量生成** | AI SVG 流式输出 · SSE 实时预览 · 无损缩放 |
| 💎 **提示词工具** | AI 智能润色 · 多风格预设 · 批量出图 |
| 🏪 **用户中心** | 注册登录 · API Key 管理 · 用量仪表盘 · 每日签到 |
| 📦 **账户体系** | 订阅套餐 · 令牌桶限流 · 邀请裂变 · 积分商城 · 兑换码 · 优惠券 |
| 💳 **支付集成** | 支付宝 · Linux Do Credit |
| 🌐 **开发者 API** | OpenAI 兼容 · RESTful · Webhook 回调 · Python SDK |
| 📢 **消息通知** | SMTP 邮件验证 · 公告 Banner · 弹窗推送 |

</td>
<td width="50%" valign="top">

### 🛠️ 运营后台

| 模块 | 能力 |
|---|---|
| 📊 **数据看板** | 用户 · 订单 · 生成量 · 收入 · 转化率 · ARPU |
| 📡 **系统监控** | SSE 实时推送 QPS · 性能 · 号池 · 定时器 |
| 📜 **调用日志** | 实时流 + 历史分页 · **Web/API 来源区分** · 调用详情 |
| 🛡️ **风险评分** | 四维加权 · **全参数可调** · 阶梯封禁 · 防误封默认 |
| 🤖 **号池管理** | 批量导入 · 健康监控 · 异常清理 · 智能补号 · 注册机 |
| 📣 **公告管理** | Banner + 弹窗双模式 · 类型 · 优先级 · 时间窗 |
| ⚙️ **系统设置** | 存储模式 · 调度并发 · 限速 · 缓存 · 风险阈值（热更新） |
| 🗑️ **内容治理** | 图片瀑布管理 · 分享审核 · 批量删除 |

</td>
</tr>
</table>

---

## 🏗️ 技术架构

<div align="center">

```
┌────────────────────────────────────────────────────┐
│  🌐 Nginx · SSL 终端 · 反向代理 · 静态资源            │
├────────────────────────────────────────────────────┤
│  ⚛️  Next.js 16 · React 19 · Tailwind CSS 4         │
│  🎬  Framer Motion · Recharts · shadcn/ui · Sonner  │
├────────────────────────────────────────────────────┤
│  🔧  Go 1.24 · net/http(标准库) · SSE · Webhook     │
│  🗄️  MySQL 8 (InnoDB·utf8mb4) · Redis 7            │
│  📦  S3 兼容 · 本地文件 · 数据库 三态存储            │
├────────────────────────────────────────────────────┤
│  🐳  Docker Compose · 单命令部署                     │
└────────────────────────────────────────────────────┘
```

</div>

| 分层 | 选型 |
|---|---|
| 后端 | `Go 1.24` · 纯标准库 `net/http`（Go 1.22+ method-pattern 路由，无 Web 框架） |
| 前端 | `Next.js 16` · `React 19` · `TypeScript` · `Tailwind CSS 4` · `shadcn/ui` |
| 存储 | `MySQL 8` · `Redis 7` · S3/本地/DB 可插拔图片存储 |
| 关键依赖 | `go-redis/v9` · `go-sql-driver/mysql` · `refraction-networking/utls`（TLS 指纹） · `golang.org/x/crypto`（bcrypt） |
| 安全 | Redis 会话 Token · Cloudflare Turnstile · bcrypt · IP 信任链 · CSP/HSTS |
| 部署 | `Docker` · `Docker Compose` · Nginx 反代 |

---

## ⚡ 高并发设计

> 核心约束：请求热路径只做原子操作，写操作全部异步批量，读操作带缓存。每个被采集请求复用单个 `APICallInfo` 结构体（指针经中间件链透传，原地填充，避免逐层值拷贝）。

<details open>
<summary><b>🔥 请求热路径</b></summary>

| 机制 | 实现 |
|---|---|
| QPS 采集 | `sync/atomic` 环形桶（`[60]int64`），60s 窗口，`Swap` 原子置换桶归属，写路径仅一次 `Add` |
| API 限流 | Redis `INCR`+`EXPIRE` 固定窗口计数，三级链：套餐速率 → 后台默认 → 内置兜底（30/min），命中风控再降级 |
| 中间件传参 | `*APICallInfo` 指针经 `context.Value` 透传，各层原地写同一指针，避免逐层值拷贝 |

</details>

<details>
<summary><b>📨 异步化</b></summary>

| 机制 | 实现 |
|---|---|
| 日志落库 | `apilog.Writer` — 1024 缓冲 channel，`Submit` 非阻塞投递，200 条或 2s 触发批量 `INSERT`，满即丢弃 |
| 实时广播 | `Broadcaster` — 256 缓冲 per-sub，`select default` 非阻塞 send，掉队自动跳过 |
| 风险采集 | `RiskRecorder` — 每请求几次 Redis 原子累加，定时器（默认 5min，**后台可调**）批量评分落库 |

</details>

<details>
<summary><b>🗄️ 数据与系统层</b></summary>

| 机制 | 实现 |
|---|---|
| 批量写入 | 事务内 `SET NAMES utf8mb4`，200 条/批，容量预分配 |
| 配置缓存 | `sync.RWMutex` 保护 + TTL，写后失效，DB 查询大幅减少 |
| 公开接口缓存 | `sync.Map` 短 TTL 进程内缓存：`/api/plans` `/gallery` `/announcements` 等 |
| DB 连接池 | `MaxOpenConns=25` `MaxIdleConns=5` `ConnMaxLifetime=5min`，`db_max_open_conns` 可热调 |
| 热更新 DDL | `columnExists` 守卫，`ALTER TABLE` 仅首次执行，后续启动零开销跳过 |
| 生图并发闸门 | `GenerationScheduler` 三级闸门：全局、单用户（进程内 `atomic`/`mutex`）+ 单账号（Redis 槽位，多实例可跨进程协同） |
| 优雅退出 | `defer` 链：排空日志 channel → `mysql.Close()` → `redis.Close()` |

</details>

---

## 🛡️ 风险评分系统

四维加权模型，所有参数**后台可调、保存即热更新**，默认值偏保守（宁可漏放，不轻易误封）。

| 维度 | 信号 | 默认权重 |
|---|---|---|
| API 滥用 | 请求频率 · 错误率 · IP 数 · 令牌消耗 | 40% |
| 内容滥用 | 重复 prompt · 失败率 | 25% |
| 积分滥用 | 邀请裂变作弊比例 | 20% |
| 账号异常 | 同 IP 关联号 · 被封历史 · 新账号 | 15% |

- **总分 = Σ(维度分 × 权重) / 100**，单一维度满分也只贡献其权重值 → 封禁需多维度共振，天然防误封。
- **三级处置（阈值可调）**：≥40 标记观察 · ≥65 限流降级（速率减半）· ≥85 自动封禁。
- **阶梯封禁**：默认 1h → 1天 → 7天，全部临时、到期自动解封；永久封禁交由管理员手动决定。
- **防误判**：上游 5xx / 402 / 429 不计入用户错误率；错误率需达最小样本量才计分；采集窗口、灵敏度、申诉联系方式均可配。

---

## 🚀 快速开始

<details open>
<summary><b>💻 本地开发</b></summary>

```bash
# 1️⃣ 起 MySQL + Redis（容器，避开本地端口冲突）
docker compose up -d
# → MySQL :3307   Redis :6380

# 2️⃣ 后端
cd server
cp .env.example .env
# 编辑 .env：MYSQL_PORT=3307  REDIS_PORT=6380  JWT_SECRET=任意随机串
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
<summary><b>🚢 生产部署（Docker Compose）</b></summary>

```bash
# 1. 配置环境变量
cp .env.prod.example .env.prod
# 编辑 .env.prod：MYSQL_ROOT_PASSWORD、JWT_SECRET 必须改为强随机值
#   openssl rand -hex 32      → JWT_SECRET
#   openssl rand -base64 24   → 数据库 / Redis 密码

# 2. 一键部署（mysql + redis + backend + frontend）
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 3. 首次重置管理员密码
docker compose -f docker-compose.prod.yml exec backend /app/reset_admin admin '你的强密码'
```

> 容器仅绑定 `127.0.0.1`（默认 backend `:8080`、frontend `:3000`）。生产建议用 Nginx 反代：
> `/api/` `/uploads/` → `127.0.0.1:8080`，其余 → `127.0.0.1:3000`。
> 端口冲突可在 `.env.prod` 用 `BACKEND_PORT` / `FRONTEND_PORT` 覆盖。

</details>

---

## ⚙️ 环境变量

<details open>
<summary><b>后端</b></summary>

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | MySQL 连接 |
| `MYSQL_USER` / `MYSQL_PASS` / `MYSQL_DB` | `root` / _(空)_ / `chatgpt2api_pro` | 数据库认证 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASS` | `127.0.0.1` / `6379` / _(空)_ | Redis 连接 |
| `JWT_SECRET` | `change-me` | 🔐 图片 URL 签名密钥，**生产必须改强随机值** |
| `SUPERADMIN_EMAIL` | _(空)_ | 超级管理员邮箱（用此邮箱注册的账号登录后自动获最高权限） |
| `ALLOWED_ORIGINS` | _(空)_ | 额外 CORS 来源（逗号分隔；同源部署留空） |
| `HTTP_READ_HEADER_TIMEOUT_SEC` | `15` | 读请求头超时（防 slowloris） |
| `HTTP_IDLE_TIMEOUT_SEC` | `120` | keep-alive 空闲回收 |

> [!IMPORTANT]
> 后端**刻意不设 `WriteTimeout`**——SSE 长连接（实时日志 / 系统监控 / 注册机）依赖无限写入时限，设置它会掐断流式响应。

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
| `GET` | `/api/plans` | 套餐列表 |
| `GET` | `/api/settings` | 站点配置 |
| `GET` | `/api/announcements` | 当前公告 |
| `GET` | `/api/gallery` | 作品广场 |
| `GET` | `/api/images/{id}` | 图片代理 |

</details>

<details>
<summary><b>🔐 用户接口</b>（Bearer Token）</summary>

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` · `/api/auth/login` | 注册 / 登录 |
| `POST` | `/api/user/keys` | 创建 API Key |
| `GET` | `/api/user/api-usage/summary` · `/logs` | 用量概览 / 明细 |
| `POST` | `/api/generations` | 创建生图 |
| `POST` | `/api/vector` | 创建矢量 |

</details>

<details>
<summary><b>🛡️ 管理接口</b>（管理员鉴权）</summary>

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/stats` | 数据统计 |
| `GET` | `/api/admin/system/events` | 系统监控 SSE |
| `GET` | `/api/admin/api-logs` · `/events` | 全站调用日志 / 实时流 SSE |
| `GET` | `/api/admin/risk/scores` · `/detail` | 风险评分 / 用户详情 |
| `POST` | `/api/admin/risk/unban` | 解封 |

</details>

<details>
<summary><b>🧩 开发者 API（OpenAI 兼容）</b></summary>

```bash
# OpenAI 兼容同步生图
curl -X POST https://your-domain.com/v1/images/generations \
  -H "Authorization: Bearer sk-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A cute cat","n":1,"size":"1:1"}'
```

> 另支持原生异步生图、矢量、图生文、智能增强、背景移除。完整文档见站内 `/docs`，Python SDK 见 [`sdk/python`](./sdk/python)。

</details>

---

## 🔒 安全机制

| 措施 | 说明 |
|---|---|
| 🔑 会话鉴权 | 登录签发随机 Token 存 Redis（`token:user:<t>`，24h TTL），用户与管理员统一通道，封禁/改权即时生效 |
| 🗝️ API Key | `sk-` 前缀，用户自管启用/禁用，独立限流 |
| 🤖 人机验证 | Cloudflare Turnstile（注册 · 登录 · 支付） |
| 🔐 密码策略 | bcrypt 哈希 · 失败限流 · 邮箱验证码 |
| 🌐 IP 信任链 | X-Real-IP → X-Forwarded-For → RemoteAddr |
| 🧱 安全头 | CSP · HSTS · X-Content-Type-Options |
| 🕵️ 密钥保护 | 公开接口抹除敏感字段 · 回写保留旧值防覆盖 |
| 🛡️ 风控联动 | Web 与 API 调用统一采集，四维评分自动限流 / 封禁 |

> [!NOTE]
> **`JWT_SECRET` 的真实用途**：仅用于图片代理 URL 的签名校验，以及上游 ChatGPT account token 处理；**用户登录态本身是 Redis 不透明会话 Token，并非 JWT**。变量名为历史保留。

---

## 📂 项目结构

```
📦 chatgpt2api-pro
├── 📁 server/                   # Go 后端
│   ├── 📄 main.go               # 入口 · 依赖注入 · 优雅退出
│   ├── 📁 internal/
│   │   ├── 📁 api/              # HTTP handler（按领域拆分）+ 路由
│   │   ├── 📁 apilog/           # 调用日志异步批量写入 + SSE 广播
│   │   ├── 📁 config/           # 环境变量加载
│   │   ├── 📁 metrics/          # QPS 滑动窗口
│   │   ├── 📁 middleware/       # 鉴权 · 限流 · 安全头 · 风险采集
│   │   ├── 📁 model/            # 数据模型
│   │   ├── 📁 service/          # 调度 · 监控 · 注册机 · 风控 · 生图
│   │   ├── 📁 storage/          # DB / Local / S3 存储后端
│   │   └── 📁 store/            # MySQL · Redis（按领域拆分）
│   ├── 📁 cmd/reset_admin/      # 管理员密码重置 CLI
│   └── 🐳 Dockerfile
├── 📁 web/                      # Next.js 前端
│   └── 📁 src/{app,components,lib}/
├── 📁 sdk/python/               # Python SDK
├── 🐳 docker-compose.yml        # 本地依赖（MySQL/Redis）
├── 🐳 docker-compose.prod.yml   # 生产编排
└── 📄 .env.prod.example         # 生产环境变量模板
```

---

## 📌 注意事项

> [!IMPORTANT]
> 部署前请逐项确认：

- **🔐 密钥**：`JWT_SECRET`、`MYSQL_ROOT_PASSWORD`、`REDIS_PASS` 生产环境务必改强随机值，且 `.env.prod` 切勿提交 git。
- **🌐 IP 信任链**：风控与限流依赖真实客户端 IP。必须由可信反代（Nginx）写入 `X-Real-IP`，否则 IP 类信号可被伪造绕过。
- **📊 日志体量**：Web 生成调用已纳入采集，`api_call_logs` 增长较快，请在后台设置合理的日志保留天数（自动清理）。
- **⏱️ SSE 与超时**：勿给后端设 `WriteTimeout`；反代侧也需关闭对 `/api/admin/*/events` 的响应缓冲与读超时。
- **🛡️ 风控阈值**：首次上线建议先用默认值观察一段时间，再按实际流量调整阈值与权重，避免误伤正常用户。
- **🗄️ 数据备份**：MySQL 与本地 `uploads` 卷需纳入备份策略；切换 S3 存储不会自动迁移历史本地文件。

---

## 📄 开源许可

<div align="center">

本项目基于 **MIT License** 开源 · [LICENSE](./LICENSE)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

<sub>Made with ❤️ by Specia1z</sub>

</div>
