# 账号体系

用户已确认：用户名和密码登录；admin 创建普通账号；普通账号具备全部业务功能；每个账号只访问自己的灵感，旧数据归 admin。

## 契约与存储

- `POST /api/auth/login`：`{username,password,remember?}`，成功返回 `{ok:true}`。
- `GET /api/me`：`{id,username,role}`，role 为 admin/user。
- `POST /api/auth/password`：`{currentPassword,newPassword}`，成功撤销该用户全部会话，返回 `{ok:true}`。
- `GET /api/admin/users`：返回 `{items: [{id,username,role,createdAt}], nextCursor}`，接受 cursor，最多 50 条。
- `POST /api/admin/users`：`{username,password}`，只能创建 user，返回用户信息，201；重复用户名 409。
- 未登录 401，非管理员访问管理接口 403，跨账号资源 404。
- 用户名规范化小写，3–32 位 ASCII 字母、数字、下划线、连字符；新密码 10–200 字符，兼容原管理员密码登录。
- 新增 users、sessions。admin 内部 id 沿用 me，避免重写旧业务数据；迁移插入无密码 admin 占位并建立 owner 外键，首次登录用部署 PASSWORD_HASH 原子初始化，之后不会覆盖用户修改的密码。
- Cookie 使用随机 256 位令牌，数据库只存 SHA-256 哈希；服务端记录用户、密码版本、到期时间。改密更新版本并撤销会话，防止并发登录恢复旧密码会话。
- 登录按 IP 与用户名分别限流；成功登录不清除其他账号的失败累计。
- 不开放注册、角色修改、删除账号、邮箱找回。管理员无查看其他用户灵感的特权。

## 数据流

浏览器 -> 登录校验/限流 -> users -> sessions -> HttpOnly Cookie

业务请求 -> 会话/用户校验 -> 当前 user.id -> repo(owner) -> 私有数据

管理请求 -> 会话/role 校验 -> 创建普通用户

## 验证

API 集成覆盖管理员初始化、用户名冲突、权限提升、双用户隔离、改密/退出撤销、旧会话拒绝、独立限流。E2E 覆盖创建账号、普通用户全部导航及导入导出、私有数据、修改密码。执行 typecheck、test、build、verify:vercel、db:check、test:e2e。
