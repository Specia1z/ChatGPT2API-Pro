# ChatGPT2API Pro

基于 OpenAI `gpt-image-2` 的 AI 图片生成服务，含完整的用户系统、订阅计费与运营后台。Go 后端 + Next.js 前端，单机 Docker 一键部署。

> 私有项目。部署细节见 [DEPLOY.md](./DEPLOY.md)。

## 功能特性

**用户端**
- 🎨 AI 图片生成：文生图、图生图、多图融合，17 种尺寸预设，批量提示词（每行一张）
- 🖼️ 作品画廊：瀑布流布局、无限滚动、生成进度显影动画、一键下载/分享到广场
- 👤 账户体系：注册登录、订阅套餐、令牌桶限流、每日签到、兑换码与优惠券
- 💳 支付宝在线支付订阅

**运营后台**
- 📊 数据看板：用户、订单、生成量统计
- 🤖 账号注册机：自动批量注册 OpenAI 账号（PKCE + Sentinel PoW + 临时邮箱验证）
- 🔍 账号健康监控：定时检查、异常清理、可用数不足时智能补号
- 🗂️ 套餐 / 兑换码 / 优惠券 / 用户 / 订单管理
- 💾 存储管理：数据库 / 本地 / S3 三种模式，本地图片过期自动清理

**安全**
- JWT 鉴权、Cloudflare Turnstile 人机验证、接口限流

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.24、原生 `net/http`、MySQL 8、Redis 7 |
| 前端 | Next.js 16、React 19、Tailwind CSS 4、framer-motion、recharts |
| 部署 | Docker Compose、Nginx 反代（宝塔） |

## 目录结构

```
.
├── server/                 # Go 后端
│   ├── main.go             # 入口
│   ├── cmd/reset_admin/    # 管理员重置工具
│   ├── internal/
│   │   ├── api/            # 路由与各业务 handler
│   │   ├── service/        # 注册机、监控、生图、PoW、存储清理
│   │   ├── store/          # MySQL / Redis
│   │   ├── storage/        # 数据库 / 本地 / S3 存储后端
│   │   ├── middleware/     # 鉴权、CORS、限流
│   │   ├── model/          # 数据模型
│   │   └── config/         # 环境变量加载
│   ├── migrations/         # 初始化 SQL（建表主要由程序 autoMigrate 负责）
│   └── Dockerfile
├── web/                    # Next.js 前端
│   ├── src/app/            # 页面（create / gallery / admin / user ...）
│   ├── src/components/     # UI 组件
│   ├── src/lib/            # api 封装、鉴权、工具
│   └── Dockerfile
├── docker-compose.prod.yml # 生产编排
├── .env.prod.example       # 生产环境变量模板
└── DEPLOY.md               # 部署指南
```

## 快速开始

### 本地开发

需要本机有 Go 1.24+、Node 20+、MySQL、Redis（或用根目录 `docker-compose.yml` 起 MySQL+Redis）。

```bash
# 1) 起依赖（仅 MySQL + Redis）
docker compose up -d
# 注意：该 compose 映射到宿主机 MySQL=3307、Redis=6380（避开默认端口冲突）

# 2) 后端
cd server
cp .env.example .env   # 按需修改 MySQL/Redis/JWT（用上面端口则 MYSQL_PORT=3307、REDIS_PORT=6380）
go run .

# 3) 前端
cd web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" > .env.local
npm run dev            # http://localhost:3000
```

前端开发时通过 `web/.env.local` 的 `NEXT_PUBLIC_API_URL` 把 `/api` 代理到后端。生产同源部署则不需要此变量（走相对路径，由 Nginx 反代）。

### 生产部署

详见 [DEPLOY.md](./DEPLOY.md)。概要：

```bash
cp .env.prod.example .env.prod    # 填入 JWT_SECRET / 数据库密码等
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

宝塔 Nginx 反代：`/api/`、`/uploads/` → `127.0.0.1:8080`，`/` → `127.0.0.1:3000`。

首次部署后重置管理员密码：

```bash
docker compose -f docker-compose.prod.yml exec backend /app/reset_admin admin '你的强密码'
```

## 环境变量

后端（`server/.env` 或容器环境）：

| 变量 | 说明 |
|------|------|
| `PORT` | 监听端口，默认 8080 |
| `MYSQL_HOST/PORT/USER/PASS/DB` | MySQL 连接 |
| `REDIS_HOST/PORT/PASS` | Redis 连接 |
| `JWT_SECRET` | JWT 签名密钥（**生产必须改为随机值**） |
| `ALLOWED_ORIGINS` | 额外允许的 CORS 来源，逗号分隔（同源反代部署可留空） |

OpenAI 注册机的代理、邮箱、套餐、存储等运行参数在**后台界面**配置，不走环境变量。

## 许可

私有项目，保留所有权利。

