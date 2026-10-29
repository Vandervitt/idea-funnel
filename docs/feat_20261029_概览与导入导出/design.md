# 第二期（M4）设计：概览、导入导出

范围：PRD F5.1–F5.3、F6.1–F6.2。修改密码不做（仍然通过环境变量 `PASSWORD_HASH` 修改）。

## 已确认的口径（用户，2026-10-29）

| # | 问题 | 结论 |
| --- | --- | --- |
| D1 | JSON 导入时遇到同 id 的想法 | **跳过**：只补入库里没有的想法，已有的保持不动；同一个文件重复导入是安全的。导入完成后提示新增 N 条、跳过 M 条 |
| D2 | 转化率口径 | **按「曾经到达」计算**：主路径为 收集箱 → 评估中 → 验证中 → 执行中 → 已落地。每个想法按它走到过的最远阶段计（取当前阶段和时间线 `stage` 事件中最远的那个）；已放弃的想法按放弃前走到的最远阶段计。第 k 步的转化率 = 曾到达第 k 阶段的数量 ÷ 曾到达第 k−1 阶段的数量，用 `truncateRate` 向下截断，保留 1 位小数 |
| D3 | F5.3 中的「处理」 | 想法**离开收集箱**（推进或放弃，即时间线中 `from_stage = inbox` 的事件）。同一个想法在同一周内多次离开收集箱只计 1 次 |
| D4 | 周的划分 | 每周从周一开始，按浏览器所在时区计算（前端传入 IANA 时区名，服务端校验后交给 Postgres 的 `AT TIME ZONE` 处理） |

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/insights?tz=Asia/Shanghai` | `{ stages: {stage,count}[6], funnel: {stage,reached,rate}[5], weeks: {week,created,processed}[12] }`。`rate` 为截断后的字符串，第一步为 `null` |
| GET | `/api/export?format=json\|md` | 以附件形式下载（`Content-Disposition`）。JSON 带 `app`/`version`，每个想法内嵌 `events` |
| POST | `/api/import/json` | 请求体为导出文件。返回 `{ inserted, skipped }`。请求体上限 4 MB（Vercel 函数的上限是 4.5 MB） |
| POST | `/api/import/lines` | `{ items: {title, tags}[] }`，最多 500 条，由前端用 `parseCapture` 逐行解析，解析结果同时用于预览 |

所有接口都需要登录（沿用全局的认证中间件）；写操作经过 CSRF 中间件。

## 数据与 SQL

- **导入**：一条语句完成，使用数据修改型 CTE。`jsonb_to_recordset` 展开输入 → `INSERT ideas … ON CONFLICT (id) DO NOTHING RETURNING id` → 只为这一步真正插入的想法写入 tags、idea_tags、idea_events。按集合批量写入，不逐行执行。
  - 导出文件的校验（Zod）：阶段枚举；ICE 要么三项都有、要么都没有；处于 验证中 / 执行中 的想法必须已评分；处于 已落地 / 已放弃 的想法必须填写结论；时间必须是 ISO 格式。文件里没有时间线的想法，自动补一条 `created` 事件。
- **概览**：
  - 阶段数量：`GROUP BY stage`，走 `(owner_id, stage, …)` 索引。
  - 曾经到达：`ideas LEFT JOIN idea_events`，用 `array_position` 求每个想法到过的最远阶段。
  - 每周数据：`generate_series` 生成 12 个周，新增数走 `ideas_owner_created_idx`；处理数需要按时间筛选事件，为此新增索引 `idea_events (type, created_at)`。这是一个 Prisma 迁移，Vercel 构建时会自动执行。

## 前端

- 新页面 `/insights`「概览」，加到导航中（移动端底部导航改为 5 列）：
  - 阶段数量：横向条形图，点击跳到列表页并带上该阶段的筛选条件。
  - 转化：逐步显示「曾到达数量 + 转化率」。
  - 每周数据：12 周的分组柱状图（新增 / 处理），附带可访问的数据表格。
- 设置页：
  - 导出：两个下载链接。
  - 导入 JSON：选择文件，导入后提示结果。
  - 批量导入：文本框 + 实时预览（标题超过 200 字的行标为错误，不导入）+ 导入按钮。

## 测试策略

- `shared` 单元测试（TDD）：转化率计算、批量文本解析、Markdown 渲染。
- API 集成测试：
  - 概览：阶段数量；曾经到达（包括从验证中放弃、重新打开的情况）；每周分桶和时区处理；非法时区返回 400。
  - 导出 → 清空 → 导入 → 再导出，前后完全一致。
  - 重复导入时跳过已有想法；非法文件返回 400；批量导入。
  - 未登录访问返回 401。
  - 用 `EXPLAIN` 确认每周统计查询走索引。
- E2E：概览页的数字、批量导入（含预览）、导出后再导入 JSON。
