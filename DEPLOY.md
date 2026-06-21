# 🚀 部署文档

ChatGPT2API Pro 部署指南 —— 涵盖 **Docker Compose 一键部署**、**裸机手动部署**、**Nginx 反向代理配置**。

> 技术栈：Go 1.24 后端 + Next.js 16 前端 + MySQL 8 + Redis 7。
> 前后端同源部署，由 Nginx 统一入口反代：`/api` `/uploads` → 后端(8080)，其余 → 前端(3000)。

---

## 目录

- [一、架构与端口](#一架构与端口)
- [二、环境变量](#二环境变量)
- [三、Docker Compose 部署（推荐）](#三docker-compose-部署推荐)
- [四、裸机手动部署](#四裸机手动部署)
- [五、Nginx 反向代理配置](#五nginx-反向代理配置)
- [六、首次初始化与超级管理员](#六首次初始化与超级管理员)
- [七、升级 / 回滚 / 备份](#七升级--回滚--备份)
- [八、常见问题排查](#八常见问题排查)

---

## 一、架构与端口

```
                    ┌─────────────────────────────┐
   用户浏览器  ───▶ │  Nginx (443/80) · SSL 终端   │
                    └──────────────┬──────────────┘
                       /api /uploads │ 其余路径
                          ▼          ▼
                ┌──────────────┐  ┌──────────────┐
                │ 后端 :8080   │  │ 前端 :3000   │
                │ Go net/http  │  │ Next.js      │
                └──────┬───────┘  └──────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
        ┌──────────┐      ┌──────────┐
        │ MySQL 8  │      │ Redis 7  │
        └──────────┘      └──────────┘
```

| 服务 | 默认端口 | 对外 | 说明 |
|---|---|---|---|
| Nginx | 80 / 443 | ✅ 公网 | 唯一对外入口，SSL 终端 + 反代 |
| 后端 backend | 8080 | ❌ 仅 127.0.0.1 | Go API 服务 |
| 前端 frontend | 3000 | ❌ 仅 127.0.0.1 | Next.js 页面 |
| MySQL | 3306 | ❌ 内网 | 数据库 |
| Redis | 6379 | ❌ 内网 | 缓存 / 会话 / 令牌桶 |

> [!IMPORTANT]
> 后端、前端、数据库**绝不要直接暴露公网**。只有 Nginx 的 80/443 对外。Docker 部署默认已把 backend/frontend 绑定到 `127.0.0.1`。

---

## 二、环境变量

生产环境变量集中在根目录 `.env.prod`（从 `.env.prod.example` 复制）。

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MYSQL_ROOT_PASSWORD` | ✅ | — | MySQL root 密码，容器初始化 + 后端连接共用 |
| `MYSQL_DB` | | `chatgpt2api_pro` | 数据库名 |
| `REDIS_PASS` | 公网建议 | _(空)_ | Redis 密码，留空=不启用 |
| `JWT_SECRET` | ✅ | — | 🔐 图片 URL 签名密钥，**务必强随机** |
| `SUPERADMIN_EMAIL` | ✅ | — | 超级管理员邮箱（用此邮箱注册的账号登录后自动获最高权限） |
| `ALLOWED_ORIGINS` | | _(空)_ | 额外 CORS 来源（同源部署留空） |
| `FRONTEND_PORT` / `BACKEND_PORT` | | `3000` / `8080` | 宿主机映射端口（绑 127.0.0.1，避端口冲突可改） |
| `HTTP_READ_HEADER_TIMEOUT_SEC` | | `15` | 读请求头超时（防 slowloris） |
| `HTTP_IDLE_TIMEOUT_SEC` | | `120` | keep-alive 空闲回收 |

生成强随机密钥：

```bash
openssl rand -hex 32       # JWT_SECRET
openssl rand -base64 24    # MySQL / Redis 密码
```

> [!WARNING]
> - `.env.prod` 含密钥，**已在 .gitignore，切勿提交 git**。
> - 后端**刻意不设 `WriteTimeout`**——SSE 长连接（实时日志/系统监控/注册机）依赖无限写入时限。

---

## 三、Docker Compose 部署（推荐）

最省事，一条命令起全套（MySQL + Redis + 后端 + 前端）。

### 前置

- Docker 20.10+ 与 Docker Compose v2
- 一台 Linux 服务器（2C2G 起步，生图并发高建议 4C8G）

### 步骤

```bash
# 1. 拉取代码（或上传源码包解压）
git clone <仓库地址> chatgpt2api-pro && cd chatgpt2api-pro

# 2. 配置环境变量
cp .env.prod.example .env.prod
vim .env.prod
#   必改：MYSQL_ROOT_PASSWORD、JWT_SECRET、SUPERADMIN_EMAIL

# 3. 一键构建并启动
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 4. 查看状态（等 mysql/redis healthy，backend/frontend 起来）
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

启动后：
- 后端监听 `127.0.0.1:8080`
- 前端监听 `127.0.0.1:3000`
- MySQL/Redis 仅在 compose 内网，数据持久化到具名卷
- 后端首次启动自动建表（`autoMigrate`），无需手动导入 SQL

### 数据持久化

| 卷 | 内容 |
|---|---|
| `mysql_data` | 数据库数据 |
| `redis_data` | Redis AOF 持久化 |
| `uploads` | 本地图片存储（对应后台 storage 的 `local_path=/app/uploads`） |

> [!NOTE]
> 镜像不打包 `.env`，配置全部由 compose 的 `environment` 注入。`migrations/` 目录仅留存参考，实际建表由程序 `autoMigrate` 负责。

接下来配置 [Nginx 反代](#五nginx-反向代理配置) 和 [超级管理员](#六首次初始化与超级管理员)。

---

## 四、裸机手动部署

不想用 Docker、或想精细控制时使用。需自行准备 MySQL 8、Redis 7。

### 4.1 准备依赖

```bash
# MySQL 8（utf8mb4）、Redis 7 自行安装，略
# 创建数据库
mysql -uroot -p -e "CREATE DATABASE chatgpt2api_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

工具链：Go 1.24+、Node.js 22+。

### 4.2 编译后端

```bash
cd server
# 配置环境变量（裸机用 server/.env，或导出到环境）
cp .env.example .env
vim .env   # 填 MYSQL_*, REDIS_*, JWT_SECRET, SUPERADMIN_EMAIL

# 编译（CGO 无关，纯静态）
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o server .
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o reset_admin ./cmd/reset_admin

# 运行（建议用 systemd 托管，见下）
./server
```

### 4.3 构建前端

```bash
cd web
npm ci
# 同源部署：不要设 NEXT_PUBLIC_API_URL，前端走相对路径 /api
npm run build

# standalone 产物自包含，启动：
node .next/standalone/server.js   # 监听 3000
# 静态资源需在 standalone 同级：
#   .next/standalone/.next/static  ← 由 .next/static 拷入
#   public/  ← 如有静态文件也拷入 standalone
```

> 裸机前端启动前，把 `.next/static` 拷到 `.next/standalone/.next/static`，`public`（若有）拷到 `.next/standalone/public`，否则静态资源 404。

### 4.4 systemd 托管（推荐）

`/etc/systemd/system/c2a-backend.service`：

```ini
[Unit]
Description=ChatGPT2API Pro Backend
After=network.target mysql.service redis.service

[Service]
Type=simple
WorkingDirectory=/opt/chatgpt2api-pro/server
ExecStart=/opt/chatgpt2api-pro/server/server
EnvironmentFile=/opt/chatgpt2api-pro/server/.env
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/c2a-frontend.service`：

```ini
[Unit]
Description=ChatGPT2API Pro Frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chatgpt2api-pro/web/.next/standalone
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now c2a-backend c2a-frontend
systemctl status c2a-backend
```

---

## 五、Nginx 反向代理配置

核心规则：**`/api` 与 `/uploads` 反代到后端 8080，其余全部到前端 3000**。

> [!CAUTION]
> 这几条 `proxy_set_header` **缺一不可**，尤其 `X-Real-IP`——风控的同 IP 检测、多 IP 告警、IP 限流全依赖它取真实客户端 IP。漏配会导致所有用户 IP 记成网关地址、IP 风控失效。

```nginx
server {
    listen 80;
    server_name your-domain.com;
    # HTTP 强制跳转 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（宝塔/certbot 申请后填实际路径）
    ssl_certificate     /etc/nginx/ssl/your-domain.com.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 上传大小（图生图/增强需传图，放宽）
    client_max_body_size 20m;

    # ── 后端 API ──
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ── SSE 实时流（日志/监控/注册机）关键配置 ──
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;          # 关闭缓冲，否则 SSE 不实时
        proxy_read_timeout 3600s;     # SSE 长连接，勿用默认 60s
    }

    # ── 图片代理 / 本地存储 ──
    location /uploads/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host      $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # ── 前端页面（其余全部） ──
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
nginx -t && nginx -s reload
```

### 宝塔面板用户

宝塔 → 网站 → 添加站点 → 反向代理。但宝塔默认反代模板只代理一个上游，需手动改配置文件按上面的 `location` 拆分 `/api`、`/uploads`、`/`。**务必确认 `proxy_set_header X-Real-IP $remote_addr` 存在**，并对 `/api/` 关闭 `proxy_buffering`、调大 `proxy_read_timeout`（否则 SSE 实时功能失效）。

> [!IMPORTANT]
> **SSE 注意事项**：`/api/` 必须 `proxy_buffering off` + `proxy_read_timeout 3600s`。否则系统监控、实时日志、注册机实时进度等 SSE 功能会卡住或断流。

---

## 六、首次初始化与超级管理员

### 超级管理员（推荐方式）

1. 配置 `.env.prod` 的 `SUPERADMIN_EMAIL=you@example.com`
2. 在站点正常**注册**一个使用该邮箱的普通账号
3. 该账号登录后**自动获得最高权限**（可授予/撤销其他用户的管理员）

改超管只需改 `SUPERADMIN_EMAIL` 的值并重启后端，无需动数据库。

### 站点配置

登录后台后，在 **系统设置** 中按需配置：
- 模型 / 号池（生图能力依赖上游账户）
- 存储模式（数据库 / 本地 / S3）
- 支付、邮件、风控阈值等

---

## 七、升级 / 回滚 / 备份

### Docker 升级

```bash
git pull                       # 或上传新源码包
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# 只重建后端：
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build backend
```

> 数据库 schema 变更由后端 `autoMigrate` 自动执行（guarded ALTER，幂等），无需手动迁移。

### 裸机升级

```bash
cd server && git pull && CGO_ENABLED=0 go build -o server . && systemctl restart c2a-backend
cd web && git pull && npm ci && npm run build && systemctl restart c2a-frontend
```

### 备份（重要）

```bash
# MySQL
docker exec c2a-mysql mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" chatgpt2api_pro > backup_$(date +%F).sql

# 本地图片卷
docker run --rm -v chatgpt2api-pro_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
```

> [!NOTE]
> 切换到 S3 存储**不会**自动迁移历史本地图片，需自行迁移 `uploads` 内容。

---

## 八、常见问题排查

| 现象 | 原因 / 排查 |
|---|---|
| 页面打开空白 / 静态资源 404 | 裸机部署漏拷 `.next/static`、`public` 到 standalone 目录 |
| 所有用户 IP 相同 / IP 风控失效 | Nginx 漏配 `proxy_set_header X-Real-IP $remote_addr` |
| 系统监控/实时日志卡住不刷新 | `/api/` 未关 `proxy_buffering` 或 `proxy_read_timeout` 太短（SSE 断流） |
| 图生图/增强传图报 413 | `client_max_body_size` 太小，调大到 20m+ |
| 后端起不来，连不上 DB | 检查 `.env.prod` 的 `MYSQL_*`；Docker 下等 mysql healthy 再起 backend（compose 已配 depends_on） |
| `JWT_SECRET` 报警告 | 生产必须改强随机值，别用默认 |
| 登录后不是管理员 | 确认注册邮箱与 `SUPERADMIN_EMAIL` 完全一致，且改后重启了后端 |
| CORS 报错（跨域直连） | 同源部署应走 Nginx 反代（前端相对路径 /api）；跨域才需配 `ALLOWED_ORIGINS` |

### 常用命令

```bash
# Docker 日志
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend

# 进 MySQL
docker exec -it c2a-mysql mysql -uroot -p chatgpt2api_pro

# 重启单个服务
docker compose -f docker-compose.prod.yml restart backend
```

---

<div align="center">
<sub>部署遇到问题，先看「八、常见问题排查」，多数坑都在 Nginx 反代的 X-Real-IP 与 SSE 配置上。</sub>
</div>
