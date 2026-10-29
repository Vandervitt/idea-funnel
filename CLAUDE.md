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
| `migrations/` | 手写 SQL，文件名带日期，内容幂等，**手动执行** |
| `e2e/` | Playwright 用例 |

## 核心约定

- **与平台无关**：业务代码只用 Web 标准 API；平台差异只能出现在 `src/entry/*` 和 `api/index.ts`。
- **比率一律向下截断**：ICE 和百分比都用 `src/shared/ice.ts`，不要另写 `toFixed` / `Math.round`。数据库里的 `ice_x10` 是生成列，用整数除法，规则保持一致。
- **阶段规则只有一份**：`checkTransition()`。服务端在 `repo.moveStage` 中强制校验，前端只用来决定是否弹出评分或结论弹窗。
- 所有 SQL 都用参数化查询；列表使用游标分页，查询要能走索引（`app.test.ts` 中有 `EXPLAIN` 断言）。
- **服务端相对 import 必须带 `.js` 后缀**（`api/`、`src/server`、`src/shared`、`src/entry`）：Vercel 逐文件编译、不打包，Node ESM 找不到不带后缀的模块。`npm run verify:vercel` 会模拟这个过程做检查。
- 前端只能以 `import type` 方式引用 `shared/schema.ts`，否则会把 zod 打进前端包；运行时常量放在 `shared/types.ts`。
- 单用户：`owner_id` 固定为 `'me'`，字段保留，供以后扩展多用户。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | API :8787 + Vite :5173，数据存在 `.data/pglite`，默认密码 `idea-funnel` |
| `npm test` | 单元测试 + 基于 PGlite 的 API 集成测试 |
| `npm run typecheck` / `npm run build` | 类型检查 / 构建 SPA 到 `dist/` |
| `npm run test:e2e` | 自动启动 :8788/:5174 的独立实例跑 E2E，产物在 `.playwright/` |
| `npm run verify:vercel` | 按 Vercel 的方式（逐文件编译 + Node ESM）加载函数，并请求一次 `/api/health` |
| `npm run hash-password` | 生成 `PASSWORD_HASH` |

**交付门槛**：`typecheck`、`test`、`build`、`verify:vercel`、`test:e2e` 全部通过。
