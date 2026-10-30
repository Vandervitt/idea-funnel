# 账号体系实施计划

目标：落实已批准的 [设计](design.md)。技术栈沿用 Hono、SQL、Prisma Migrate、React、PGlite、Vitest、Playwright。

- [x] 测试：新增 accounts.test.ts，通过真实登录请求验证 /me 身份、管理权限、数据隔离、密码/会话撤销。先运行 `npx vitest run src/server/accounts.test.ts` 验证失败。
- [x] 存储：schema.prisma 新增 users/sessions，使用本地 PostgreSQL 协议服务生成 create-only 迁移，审查 SQL，保留 me 作为管理员内部 id，添加 owner 外键。
- [x] 服务端：auth.ts 管理密码与限流；accounts.ts 管理初始化和会话；app.ts 注入身份并接入设计中的接口，业务调用替换固定 OWNER；更新平台配置。
- [x] 前端：LoginPage 增加用户名，SettingsPage 接入账号组件，api.ts 定义用户查询；管理员列表与创建表单、普通用户改密表单，退出或改密清空查询缓存。
- [x] 集成：适配既有 app.test.ts 登录夹具与 e2e 登录，验证全部接口权限；导入保持现有全局 UUID 冲突跳过规则，不覆盖其他账号记录。
- [x] 验证：执行六项交付门槛，自审 diff 和迁移，记录 E2E、测试结果、审查记录，关闭自行启动的本地服务。

全局约束：不在 main 修改，不访问共享数据库，不部署；服务端 import 带 .js，前端禁止运行时导入 shared/schema.ts；查询参数化，列表游标分页；不得添加 AI 提交署名。
