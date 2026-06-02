# syntax=docker/dockerfile:1
# ─── Go 1.24 后端，多阶段静态编译 ───

# 1) 构建层
FROM golang:1.24-alpine AS builder
WORKDIR /src
# 先拉依赖（缓存层）
COPY go.mod go.sum ./
RUN go mod download
# 再拷源码编译
COPY . .
# 纯 Go（go-sql-driver/utls 均无需 CGO）→ 静态二进制，目标 linux/amd64
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -trimpath -ldflags="-s -w" -o /out/server . && \
    go build -trimpath -ldflags="-s -w" -o /out/reset_admin ./cmd/reset_admin

# 2) 运行层（极简 alpine）
FROM alpine:3.20
WORKDIR /app
# ca-certificates：后端需对 OpenAI/邮箱/支付宝发 HTTPS 出站请求
# tzdata：时间格式化用；wget：healthcheck 用
RUN apk add --no-cache ca-certificates tzdata wget && \
    addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
COPY --from=builder /out/server /out/reset_admin /app/
# migrations 供参考（实际建表由程序 autoMigrate 负责，此处仅留存）
COPY --from=builder /src/migrations /app/migrations
# 本地图片存储目录（与 storage 配置的 local_path 对应，挂载持久化卷）
RUN mkdir -p /app/uploads && chown -R app:app /app
USER app
EXPOSE 8080
# 不打包 .env：配置全部由 docker-compose 的 environment/env_file 注入
CMD ["/app/server"]
