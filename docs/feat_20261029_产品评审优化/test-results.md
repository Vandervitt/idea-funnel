# 产品评审优化 · 测试结果（2026-10-29）

## 交付门槛（全部在本分支最终代码上执行）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 62 / 62 通过（3 个文件） |
| `npm run build` | 通过，首屏 JS gzip 后 ≈ 155 KB |
| `npm run verify:vercel` | 通过（`/api/health → 200`） |
| `npm run db:check`（本地 `db:local`） | 通过，schema 与迁移无差异；`prisma migrate deploy` 在空库上成功执行全部 3 个迁移 |
| `npm run test:e2e` | 17 / 17 通过，连续 3 轮 |

## 缺陷：先复现、后修复

| 缺陷 | 复现测试（先红） | 修复后 |
| --- | --- | --- |
| #1 未评分可直接进入已落地 | `domain.test.ts`「requires a score before shipped…」、`app.test.ts`「requires a score to ship…」，修复前均失败 | 通过 |
| #3 收集箱 > 50 条时小结数量错误 | E2E「a big inbox is reviewed in batches…」：旧实现在跳过 50 条后显示「收集箱还剩 50 条」，实际是 52 条 | 通过 |
| #12 登录过期后导出得到错误文件 | E2E「exporting with an expired session…」：旧实现是 `<a download>`，不会跳转登录页 | 通过 |
| 新发现：拖到需要弹窗的列并取消后，卡片被拖拽影子盖住，无法再拖 | E2E「dragging an unscored idea…」：修复前稳定失败（`elementFromPoint` 命中的是 `DragOverlay` 的影子卡片） | `dropAnimation={null}` 后连续多轮通过 |

## 测试本身的修正

- `paginates by creation time` / `lists least recently updated first`：同一毫秒内创建的想法 `created_at` 相同，顺序只能取决于随机 uuid，是偶发失败。改为显式设置时间。
- E2E 拖拽辅助函数：dnd-kit 在松手后约 50 ms 内会吞掉点击和文字选择。测试在这个窗口期内点「取消」时点击会丢失；加 100 ms 等待，并在第二次拖拽前等弹窗真正关闭。
- 已有断言更新为新的预期行为：`/api/tags` 不再返回 0 条的标签；导出按钮由链接改为按钮。
