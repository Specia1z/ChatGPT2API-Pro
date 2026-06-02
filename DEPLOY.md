# 生产部署指南（amd64 Linux + Docker + 宝塔反代）

单机 Docker Compose 全栈：MySQL + Redis + Go 后端 + Next 前端。
对外仅暴露 `127.0.0.1:8080`(后端) 与 `127.0.0.1:3000`(前端)，由**宝塔面板 Nginx** 反代并处理域名/HTTPS。

```
宝塔 Nginx (你的域名, HTTPS)
   ├── /api/      → 127.0.0.1:8080   (backend 容器)
   ├── /uploads/  → 127.0.0.1:8080   (backend 容器)
   └── /          → 127.0.0.1:3000   (frontend 容器)
```

前端走相对路径（同源），无 CORS 问题。

---

## 一、前置要求

服务器装好 Docker 与 Compose 插件：

```bash
docker --version            # ≥ 20.10
docker compose version      # v2
```

宝塔已装且能管理 Nginx（用于反代）。

---

## 二、配置密钥

```bash
cd /path/to/chatgpt2api-pro
cp .env.prod.example .env.prod
```

编辑 `.env.prod`，按注释填入（生成命令已写在模板里）：

- `MYSQL_ROOT_PASSWORD` — 数据库密码，`openssl rand -base64 24`
- `JWT_SECRET` — `openssl rand -hex 32`（**必须改，否则任何人可伪造登录**）
- `REDIS_PASS` — 公网建议设置
- `ALLOWED_ORIGINS` — 同源反代部署留空即可

---

## 三、构建并启动

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

首次构建约 3–8 分钟（编译 Go + 构建 Next）。查看状态：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

四个容器 `c2a-mysql / c2a-redis / c2a-backend / c2a-frontend` 均 `healthy/running` 即正常。

## 四、宝塔 Nginx 反代配置

宝塔 → 网站 → 添加站点（绑定你的域名）→ 申请/部署 SSL → 进入站点「反向代理」或「配置文件」。

在站点的 server 块里加入以下 location（**顺序重要**：`/api`、`/uploads` 在前，`/` 兜底在后）：

```nginx
# 后端 API
location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE（监控实时日志）需要：关闭缓冲、长超时
    proxy_buffering off;
    proxy_read_timeout 3600s;
}

# 本地图片
location /uploads/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}

# 前端（兜底）
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 生图参考图 base64 较大，放宽上传体积
client_max_body_size 20m;
```

> SSE 那段（`proxy_buffering off` + 长 `proxy_read_timeout`）是后台「账号监控」实时日志能推送的关键，别漏。

保存并 reload Nginx。访问 `https://你的域名` 即可。

---

## 五、初始化 / 重置管理员

镜像内置 `reset_admin` 工具（连同一套 DB）：

```bash
docker compose -f docker-compose.prod.yml exec backend /app/reset_admin <用户名> <密码>
```

例：`... exec backend /app/reset_admin admin 'YourStrongPass!'`
（程序默认建 `admin/admin123`，**上线后立即用此命令改掉**）

---

## 六、后台存储配置

登录后台 → 存储设置，若用本地存储：

- 存储类型：`local`
- 本地路径(local_path)：`/app/uploads`（与 compose 挂载的持久卷一致）
- 本地URL(local_url)：可留空，前端统一通过 `/api/images/{id}` 代理读取

> 过期清理按 `local_path` 工作；保留天数在后台设置，0=不清理。

---

## 七、运维常用命令

```bash
# 更新代码后重新构建上线
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 重启某服务
docker compose -f docker-compose.prod.yml restart backend

# 看日志
docker compose -f docker-compose.prod.yml logs -f backend frontend

# 停止/启动（保留数据）
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# ⚠ 连数据一起删（危险：清空 MySQL/Redis/上传图片）
docker compose -f docker-compose.prod.yml down -v
```

数据持久化在卷 `mysql_data / redis_data / uploads`，`down`（不带 `-v`）不丢数据。

---

## 八、备份建议

```bash
# 备份数据库
docker compose -f docker-compose.prod.yml exec mysql \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" chatgpt2api_pro > backup_$(date +%F).sql

# 备份上传图片卷（卷名前缀为项目目录名，docker volume ls 确认）
docker run --rm -v chatgpt2api-pro_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
```
