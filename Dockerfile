# 多人在线猜数竞速游戏 - Dockerfile
FROM node:20-alpine AS base

# ── 构建阶段 ────────────────────────────────────────
WORKDIR /app

# 复制 package.json 并安装依赖
COPY package.json ./
RUN npm ci --only=production

# 复制应用代码
COPY server.js ./
COPY public/ ./public/

# 生产环境配置
ENV NODE_ENV=production
EXPOSE 3000

# ── 运行阶段 ────────────────────────────────────────
FROM base AS runtime

WORKDIR /app

# 设置启动命令
CMD ["npm", "start"]
