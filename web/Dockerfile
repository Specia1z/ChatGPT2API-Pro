# syntax=docker/dockerfile:1
# ─── Next.js 16 前端，standalone 多阶段构建 ───
# 产物为自包含最小运行时，不含完整 node_modules。

# 1) 依赖层（仅装依赖，最大化缓存命中）
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) 构建层
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 同源部署：不注入 NEXT_PUBLIC_API_URL，前端走相对路径 /api（由 Nginx 反代）
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 3) 运行层（极简）
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# 非 root 运行
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
# standalone 产物 + 静态资源
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
