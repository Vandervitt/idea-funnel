# CLAUDE.md · Idea Funnel

个人用的「灵感漏斗」：想法 快速记录 → 每周筛选 → 少量落地。需求见 [docs/prd.md](docs/prd.md)，实施计划见 [docs/plan.md](docs/plan.md)。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/shared/` | 前后端共用：ICE 计算（`ice.ts`）、阶段状态机（`stage.ts`）、`#标签` 解析（`capture.ts`）、Zod 校验（`schema.ts`）、纯类型（`types.ts`） |
| `src/server/` | Hono API（`app.ts`）、SQL（`repo.ts`）、认证与限流（`auth.ts`）、数据库适配（`db.ts` = Neon，`pglite.ts` = 本地/测试） |
| `src/entry/` | 平台入口：`node.ts`（本地开发）、`cloudflare.ts`（Workers） |
| `api/index.ts` | Vercel Functions 入口 |
| `src/web/` | React SPA（Vite 根目录） |
| `prisma/` | `schema.prisma` + `migrations/`：**仅用 Prisma Migrate 管理表结构**，业务查询仍是 `repo.ts` 里的 SQL |
| `scripts/` | `vercel-build.mjs`（构建时迁移）、`pg-local.mjs`（本地 Postgres）、`verify-vercel-function.mjs`、`hash-password.ts` |
| `.github/workflows/ci.yml` | PR / main 推送时跑全部检查 |
| `e2e/` | Playwright 用例 |

## 核心约定

- **与平台无关**：业务代码只用 Web 标准 API；平台差异只能出现在 `src/entry/*` 和 `api/index.ts`。
- **比率一律向下截断**：ICE 和百分比都用 `src/shared/ice.ts`，不要另写 `toFixed` / `Math.round`。数据库里的 `ice_x10` 是生成列，用整数除法，规则保持一致。
- **阶段规则只有一份**：`checkTransition()`。服务端在 `repo.moveStage` 中强制校验，前端只用来决定是否弹出评分或结论弹窗。
- 所有 SQL 都用参数化查询；列表使用游标分页，查询要能走索引（`app.test.ts` 中有 `EXPLAIN` 断言）。
- **服务端相对 import 必须带 `.js` 后缀**（`api/`、`src/server`、`src/shared`、`src/entry`）：Vercel 逐文件编译、不打包，Node ESM 找不到不带后缀的模块。`npm run verify:vercel` 会模拟这个过程做检查。
- 前端只能以 `import type` 方式引用 `shared/schema.ts`，否则会把 zod 打进前端包；运行时常量放在 `shared/types.ts`。
- 单用户：`owner_id` 固定为 `'me'`，字段保留，供以后扩展多用户。

## 数据库迁移（本项目覆盖全局「手动 SQL 脚本」规则）

用户于 2026-10-29 决定：本项目使用 **Prisma Migrate**，并在 CI/CD 中自动执行。

- 改表：修改 `schema.prisma` → `npm run db:local`（另开终端）→ 设置 `DATABASE_URL` / `SHADOW_DATABASE_URL` 指向本地 → `npx prisma migrate dev --create-only --name <名称>` → **人工审阅生成的 SQL** 后再提交。
- Prisma 表达不了的内容（`ice_x10` 生成列、CHECK 约束、pg_trgm 表达式索引、`NULLS LAST`）手写在迁移 SQL 里。`npm run db:check` 用来确认 schema 与迁移历史一致；CI 会强制执行这项检查。
- 已提交的迁移不得修改，只能新增。
- 执行时机：Vercel 构建时由 `scripts/vercel-build.mjs` 执行。生产环境迁移生产库；预览环境迁移各自的 Neon 分支；如果预览连到的是生产库（例如没开启预览分支），**构建会直接失败**。本地开发和测试使用 PGlite，按顺序执行迁移（记录在 `_local_migrations` 表中）。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | API :8787 + Vite :5173，数据存在 `.data/pglite`，默认密码 `idea-funnel` |
| `npm test` | 单元测试 + 基于 PGlite 的 API 集成测试 |
| `npm run typecheck` / `npm run build` | 类型检查 / 构建 SPA 到 `dist/` |
| `npm run test:e2e` | 自动启动 :8788/:5174 的独立实例跑 E2E，产物在 `.playwright/` |
| `npm run verify:vercel` | 按 Vercel 的方式（逐文件编译 + Node ESM）加载函数，并请求一次 `/api/health` |
| `npm run hash-password` | 生成 `PASSWORD_HASH` |

| `npm run db:local` / `db:check` / `db:migrate` | 本地 Postgres / schema 与迁移一致性检查 / 执行迁移 |

**交付门槛**：`typecheck`、`test`、`build`、`verify:vercel`、`db:check`、`test:e2e` 全部通过（CI 中同样执行）。
