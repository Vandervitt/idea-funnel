# Idea Funnel

个人灵感漏斗：随手记下想法，每周筛选一次，用 ICE 评分决定先做哪个。

- 需求：[docs/prd.md](docs/prd.md) · 实施计划：[docs/plan.md](docs/plan.md) · 开发约定：[CLAUDE.md](CLAUDE.md)

## 本地运行

```bash
npm install
npm run dev          # http://localhost:5173 ，默认密码 idea-funnel
```

本地默认使用内嵌的 PGlite（数据存在 `.data/pglite`），不需要任何云账号。如需自定义，把 `.env.example` 复制为 `.env.local` 再修改。

## 部署（平台二选一）

两种方式都需要：

1. 一个 Postgres 数据库（推荐 [Neon](https://neon.tech)），执行一次 `psql "$DATABASE_URL" -f migrations/20261029_init.sql`
2. 三个加密环境变量：`DATABASE_URL`、`PASSWORD_HASH`（用 `npm run hash-password` 生成）、`SESSION_SECRET`（`openssl rand -base64 48`）

**Cloudflare Workers**

```bash
npx wrangler login
npx wrangler secret put DATABASE_URL   # PASSWORD_HASH、SESSION_SECRET 同理
npm run build && npx wrangler deploy
```

**Vercel**

```bash
npm i -g vercel && vercel link
vercel env add DATABASE_URL production   # PASSWORD_HASH、SESSION_SECRET 同理
vercel deploy --prod
```
