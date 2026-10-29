# Idea Funnel

个人灵感漏斗：随手记下想法，每周筛选一次，用 ICE 评分决定先做哪个。

- 需求：[docs/prd.md](docs/prd.md) · 实施计划：[docs/plan.md](docs/plan.md) · 开发约定：[CLAUDE.md](CLAUDE.md)

## 本地运行

```bash
npm install
npm run dev          # http://localhost:5173 ，默认密码 idea-funnel
```

本地默认使用内嵌的 PGlite（数据存在 `.data/pglite`），不需要任何云账号。如需自定义，把 `.env.example` 复制为 `.env.local` 再修改。

## 部署

当前使用 **Vercel + Neon**（Vercel Marketplace 集成）。推送到 `main` 会自动部署到生产环境，其他分支会生成预览部署。

**构建流程**（`npm run vercel-build`）：先执行 `prisma migrate deploy`，再构建前端。预览部署会迁移自己的 Neon 分支；如果连到的是生产库，构建会直接失败。

**首次配置（只需一次）**

1. 在 Vercel 中添加 Neon 集成，并开启 **Create database branch for deployment → Preview**（预览分支）。
2. 环境变量：`DATABASE_URL` / `DATABASE_URL_UNPOOLED` 由集成自动注入；需要手动添加的有：
   - `SESSION_SECRET`：`openssl rand -base64 48`
   - `PASSWORD_HASH`：`npm run hash-password`
   - `PRODUCTION_NEON_ENDPOINT`：生产库的 endpoint id（`ep-xxx`），用于判断预览是否误连生产库
3. 如果生产库里已经有表、但没有 Prisma 迁移记录，先执行一次基线标记：`npx prisma migrate resolve --applied 20261029000000_init`

**CI**：`.github/workflows/ci.yml` 在 PR 和 `main` 推送时执行类型检查、单元/集成测试、构建、Vercel 函数加载检查、Prisma 一致性检查（真实 Postgres）和 E2E。

**Cloudflare Workers（备用）**：入口和配置都保留了（`wrangler.jsonc`）。注意免费版每个请求的 CPU 时间只有约 10ms，登录时的 PBKDF2 哈希大概率会超时。
