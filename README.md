<div align="center">

# 🎨 ChatGPT2API Pro

**AI 图片与矢量生成平台** · 用户系统 · 订阅计费 · 运营后台 · 开发者 API

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)

</div>

---

> [!WARNING]
> **免责声明**：本项目仅供学习、研究与个人非商业用途。项目自身不提供任何 AI 模型服务，所有生成能力依赖使用者自行配置的第三方账户/API，相关费用、合规与风险由使用者自行承担。软件按「现状」提供，不作任何担保。名称中的「ChatGPT」仅描述 API 格式兼容性，与 OpenAI 等任何公司无关联。使用即表示同意以上条款。

---

## 简介

一个开箱即用的 AI 生图 SaaS 全栈方案：用户端生图/矢量创作 + 完整的订阅计费与账户体系 + 功能齐全的运营后台 + OpenAI 兼容的开发者 API。Go 后端（纯标准库）+ Next.js 前端 + MySQL + Redis，Docker 一键部署。

## ✨ 核心功能

**用户端**
- 图片生成：文生图 / 图生图 / 智能增强 / 背景移除 / 图生文
- 矢量生成：AI SVG 流式输出、SSE 实时预览
- 账户体系：订阅套餐 · 令牌桶限流 · 月配额 · 邀请裂变 · 积分商城 · 兑换码 · 优惠券
- 支付：支付宝 · Linux Do Credit
- 开发者 API：OpenAI 兼容 · Webhook 回调 · Python SDK

**运营后台**
- 数据看板、系统监控（SSE 实时）、调用日志（Web/API 来源区分）
- 风险评分（四维加权 · 全参数可调 · AI 智能研判可选）
- 配额防护（防二次分发：月配额 · 撞额降速 · 多 IP 告警）
- 号池管理、注册机、套餐/订单/兑换码、公告、风格预设、内容审核

## 🏗️ 技术栈

| 分层 | 选型 |
|---|---|
| 后端 | Go 1.24 · 标准库 net/http · SSE · Webhook |
| 前端 | Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui |
| 存储 | MySQL 8 · Redis 7 · S3/本地/数据库 三态图片存储 |
| 部署 | Docker Compose · Nginx 反向代理 |

## 🚀 快速开始

**本地开发**

```bash
# 起依赖（MySQL + Redis）
docker compose up -d

# 后端
cd server && cp .env.example .env && go run .

# 前端
cd web && npm install && npm run dev   # → http://localhost:3000
```

**生产部署**

```bash
cp .env.prod.example .env.prod   # 改 MYSQL_ROOT_PASSWORD、JWT_SECRET、SUPERADMIN_EMAIL
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> 📖 完整部署指南（Docker / 裸机 / Nginx 反代 / SSE 配置 / 排错）见 **[DEPLOY.md](./DEPLOY.md)**。

## 📂 项目结构

```
├── server/          Go 后端（internal: api / service / store / middleware / model）
├── web/             Next.js 前端（src: app / components / lib）
├── sdk/python/      Python SDK
├── docker-compose.prod.yml
└── DEPLOY.md        部署文档
```

## 📄 许可

[MIT License](./LICENSE) · Made by Specia1z
