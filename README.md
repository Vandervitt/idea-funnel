# Idea Funnel

个人灵感漏斗：随手记下想法，每周筛选一次，用 ICE 评分决定先做哪个。

- 需求：[docs/prd.md](docs/prd.md) · 实施计划：[docs/plan.md](docs/plan.md) · 开发约定：[CLAUDE.md](CLAUDE.md)

## 本地运行

```bash
npm install
npm run dev          # http://localhost:5173 ，初始账号 admin，初始密码 idea-funnel
```

本地默认使用内嵌的 PGlite（数据存在 `.data/pglite`），不需要任何云账号。如需自定义，把 `.env.example` 复制为 `.env.local` 再修改。

## 部署

当前使用 **Vercel + Neon**（Vercel Marketplace 集成），由 Vercel 的 Git 集成部署（Vercel 项目连接 GitHub 仓库 `Vandervitt/idea-funnel`）：

- 推送到 `main` → 部署到**生产**环境。
- 推送到 `preview` → 部署为**预览**（Neon 会为它创建独立的数据库分支）。
- 其他分支不部署（`vercel.json` 中的 `git.deploymentEnabled` 只允许这两个分支）。功能分支在本地合入 `preview` 或 `main` 后推送即可。

**区域**：函数固定在新加坡（`vercel.json` 中的 `regions: ["sin1"]`），与 Neon 数据库（`ap-southeast-1`）在同一区域。不要删掉这一项，否则会回到默认的 `iad1`（美国东部），每次查询都要跨太平洋。

**构建流程**（`npm run vercel-build`）：先执行 `prisma migrate deploy`，再构建前端。预览部署会迁移自己的 Neon 分支；如果连到的是生产库，构建会直接失败。

**首次配置（只需一次）**

1. Vercel 项目 → Settings → Git 连接 GitHub 仓库 `Vandervitt/idea-funnel`。如果列表里没有这个仓库，先到 GitHub → Settings → Applications → Vercel → Configure，在 Repository access 中授权它。注意：从 Vercel 导入时自动创建的 `idea-funnel-vitt` 是另一个仓库，不要连它。
2. 在 Vercel 中添加 Neon 集成，并开启 **Create database branch for deployment → Preview**（预览分支）。
3. 环境变量：`DATABASE_URL` / `DATABASE_URL_UNPOOLED` 由集成自动注入；需要手动添加的有：
   - `PASSWORD_HASH`：`npm run hash-password`，仅用于首次初始化 `admin`，后续在设置页修改密码
   - `PRODUCTION_NEON_ENDPOINT`：生产库的 endpoint id（`ep-xxx`），用于判断预览是否误连生产库
4. 如果生产库里已经有表、但没有 Prisma 迁移记录，先执行一次基线标记：`npx prisma migrate resolve --applied 20261029000000_init`

**CI**：`.github/workflows/ci.yml` 只做检查，不负责部署；在 PR 和 `main` / `preview` 推送时执行类型检查、单元/集成测试、构建、Vercel 函数加载检查、Prisma 一致性检查（真实 Postgres）和 E2E。

**Cloudflare Workers（备用）**：入口和配置都保留了（`wrangler.jsonc`）。注意免费版每个请求的 CPU 时间只有约 10ms，登录时的 PBKDF2 哈希大概率会超时。

## 账号与数据

使用用户名和密码登录。`admin` 在设置页创建普通账号；普通账号具备全部灵感管理、每周筛选、统计、标签、导入导出及修改密码功能。账号之间的数据完全隔离，管理员也不能查看其他账号的灵感。

升级时旧数据归 `admin`，初始密码沿用原 `PASSWORD_HASH`。旧登录会话失效，需要重新登录；新的会话保存在数据库，退出立即撤销当前会话，修改密码撤销该账号所有会话。`SESSION_SECRET` 不再用于认证，可以移除。部署仍由 Prisma Migrate 执行新增迁移，已有迁移不变。

用户名为 3–32 位英文字母、数字、下划线或连字符，不区分大小写。新密码为 10–200 个字符。首版不开放注册、账号删除、角色修改或密码找回。JSON 导入保持原有 UUID 冲突跳过规则，不会覆盖其他账号的数据。
