# 管理员初始化与恢复

账号 `admin` 的内部 ID 为 `me`，继承旧系统的灵感数据。登录只验证数据库凭据，不读取 `PASSWORD_HASH` 或自动创建账号。

## 新数据库

1. 先执行 Prisma 迁移（部署构建仍由 `prisma migrate deploy` 管理）。
2. 在目标数据库 SQL Editor 执行 [prisma/init.sql](../prisma/init.sql) 的完整内容。
3. 用户名 `admin`，临时密码 `IdeaFunnel-Init-2026!`。
4. 登录后在「设置 → 修改密码」修改临时密码。

初始化 SQL 只插入缺失的管理员或填充其空密码。重复执行不覆盖已有密码，不修改密码版本，不撤销现有会话，也不修改灵感数据。若需自定义初始密码，运行 `npm run hash-password`，将输出替换到 SQL 的 `password_hash` 值中；登录使用生成哈希时输入的明文密码。

## 已有管理员密码未知

在已经完成账号迁移的目标数据库（如 preview）SQL Editor 手动执行 [20261031_reset_admin.sql](../prisma/operations/20261031_reset_admin.sql)。无需重新部署，旧版本账号体系也可使用这份恢复 SQL。

脚本会将 `admin` 密码重设为 `IdeaFunnel-Init-2026!`，递增密码版本，撤销管理员全部会话，并清除管理员账号级的失败累计。普通账号、其他用户会话以及全部想法、标签和时间线不受影响。若管理员不存在则整个操作报错，不进行部分修改。

这是显式恢复操作，每次执行都会再次重置；不要加入自动迁移或部署流程。IP 级限流仍保留，若此前因多次输错密码被锁定，需等 15 分钟后再登录。

## 本地与部署

- 未配置 `DATABASE_URL` 时，`npm run dev` 仅对本地内嵌 PGlite 自动执行同一份 `init.sql`；已有本地账号密码不变。
- 配置 `DATABASE_URL` 时不自动初始化或重置连接的数据库。
- 生产及预览部署只自动执行表结构迁移，初始化/恢复 SQL 必须手动执行到选定数据库。
- 从旧方式升级时可移除 Vercel/Workers 的 `PASSWORD_HASH` 配置；它不再改变任何账号密码。
