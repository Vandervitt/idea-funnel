# 测试结果：第二期（概览、导入导出）

日期：2026-10-29，分支 `feat_20261029_概览与导入导出`。设计见 [design.md](design.md)。

## 交付门槛（本地，全部重新执行）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 49 个通过（原有 34 个 + 新增 15 个） |
| `npm run build` | 通过，前端 JS gzip 后 151 KB |
| `npm run verify:vercel` | `/api/health` → 200 |
| `npm run db:check` | No difference detected（新增迁移 `20261029073758_idea_events_type_created_idx`） |
| `npm run test:e2e` | 11 个通过，连续 3 轮无失败 |

## TDD 记录

- `src/shared/phase2.test.ts`（6 个）：先运行，因模块不存在而失败 → 实现 `insights.ts`、`parseBatch`、`export.ts` 后通过。
- `src/server/app.test.ts` 中新增的 9 个用例：先运行，全部失败（路由不存在）→ 实现 repo 和路由后剩 1 个失败（`EXPLAIN` 走的是 Bitmap Heap Scan，没有用上新索引）→ 加上 Prisma 迁移后全部通过。

## 覆盖点

| 场景 | 用例 |
| --- | --- |
| 阶段数量；曾经到达（从验证中放弃、直接从收集箱放弃、一路走到已落地）；转化率截断（2/3 → 66.6%） | `insights › counts current stages…` |
| 按周一分周 + 时区（上海周一 01:00 = UTC 周日 17:00，分属不同的周） | `insights › buckets weeks…` |
| 非法时区、注入字符返回 400；未登录返回 401 | `insights › rejects…` |
| 每周统计的事件查询走 `idea_events_type_created_idx` | `insights › uses an index…` |
| 导出 → 清空 → 导入 → 再导出，内容完全一致；重复导入时全部跳过 | `export and import › round-trips…` |
| 只补入缺少的想法；文件中没有时间线时自动补一条 created 事件；新标签会被创建 | `export and import › imports only the missing…` |
| 违反业务规则的文件（验证中但未评分、ICE 只填一部分、已放弃但没有结论、来源不对、id 重复）返回 400 | `export and import › rejects…` |
| Markdown 导出以附件形式下载 | `export and import › exports Markdown…` |
| 批量导入保持粘贴顺序，写入收集箱并带 created 事件；空列表和非法标签返回 400 | `export and import › batch-imports…` |
| E2E：概览页的数字随新增的想法变化、点击跳到列表、数据表 | `insights: counts follow new ideas…` |
| E2E：批量导入的预览标出错误行，只导入合法的行 | `batch import: …` |
| E2E：导出的 JSON 再导回时全部跳过；改过的备份能恢复出新的想法 | `export JSON and import it back…` |
| E2E：375px 宽度下概览页没有横向滚动 | `mobile: insights fits the screen` |

## 图表配色

两个系列的颜色（亮色 `#2f4fd8 / #d06a1a`，暗色 `#5b74e6 / #d27a1e`）都用 dataviz 的 `validate_palette.js` 校验过：明度、彩度、色盲区分度（ΔE 31.1 / 29.2）、对比度全部通过。

## 未覆盖 / 说明

- 线上验证要等合入 `main` 并部署之后才能做。
- 暗色模式只校验了配色，没有截图检查。
