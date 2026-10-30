# 管理员通过 SQL 初始化

用户确认替换 PASSWORD_HASH 初始化机制，并通过独立 SQL 处理 preview 已有未知密码。当前工作继续在账号体系原功能分支；不修改已提交的 Prisma 迁移，不执行共享数据库 SQL，不自动推送或部署。

## 行为与文件

- `prisma/init.sql`：在迁移执行后运行，admin 内部 ID 仍为 me；插入缺失账号或填充空密码，已有密码不覆盖。临时密码 `IdeaFunnel-Init-2026!`，SQL 存 PBKDF2 哈希并在注释说明登录密码。
- `prisma/operations/20261031_reset_admin.sql`：手动重置已存在 admin 为同一临时密码，递增密码版本、撤销其全部会话、清除该账号的失败累计；不删除业务数据，不影响其他用户。账号不存在则报错。重复执行表示再次重置，不属于初始化自动流程。
- 删除 `createAccounts.initializeAdmin` 和登录路径的写入行为；平台入口不再读取 PASSWORD_HASH。未初始化账号返回通用登录失败。
- 本地内嵌 PGlite 开发实例启动后执行同一份 init.sql（已有密码不变）；指定 DATABASE_URL 时不自动初始化远程数据库。
- Prisma 继续仅负责 schema 迁移；部署不会自动执行初始化或重置 SQL。已存在账号继续使用当前密码。
- 保留 `npm run hash-password` 作为自定义 SQL 密码哈希生成工具，更新文案和 README。

## 验证计划

1. 先验证未 init 的 admin 登录不应由旧配置自动初始化（红测已实际返回200，预期401）。
2. SQL 初始化后登录、缺失账号初始化、重复执行保持改密和业务数据、独立 reset 撤销会话并隔离其他用户、缺失admin的reset显式失败。
3. 既有API测试改为直接准备数据库凭据；E2E使用SQL约定密码。
4. 执行项目六项交付门槛，自审 SQL、入口、部署脚本；确认所有自行启动服务退出。
