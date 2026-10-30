import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'idea-funnel'; // dev fallback password of src/entry/node.ts
const uid = () => Math.random().toString(36).slice(2, 7);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '看板' })).toBeVisible();
}

async function capture(page: Page, text: string) {
  await page.getByRole('textbox', { name: '记下一个想法' }).fill(text);
  await page.getByRole('textbox', { name: '记下一个想法' }).press('Enter');
  // Saved = the box is cleared (toasts can stack, so don't key on them).
  await expect(page.getByRole('textbox', { name: '记下一个想法' })).toHaveValue('');
  await expect(page.getByText('已记到收集箱').first()).toBeVisible();
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 15 });
  await page.mouse.up();
  // dnd-kit swallows clicks and text selection for 50 ms after a drop (so the dropped card isn't "clicked").
  // A person never clicks that fast; the test must not either.
  await page.waitForTimeout(100);
}

/** Advances everything left in the inbox through the review page, batch by batch, so a test starts from an empty inbox. */
async function emptyInbox(page: Page) {
  await page.goto('/review');
  const finished = page.getByRole('heading', { name: /筛选完成|收集箱是空的/ });
  const nextBatch = page.getByRole('button', { name: /继续下一批/ });
  const progressbar = page.getByRole('progressbar');
  // Non-waiting read: after the last advance the bar is replaced by the summary, and
  // getAttribute() would wait for it forever.
  const progress = () => progressbar.evaluateAll((els) => els[0]?.getAttribute('aria-valuenow') ?? null);
  await expect(finished.or(progressbar)).toBeVisible();
  for (;;) {
    if (await nextBatch.isVisible()) {
      await nextBatch.click();
      await expect(progressbar).toBeVisible();
    } else if (await finished.isVisible()) {
      break;
    }
    const before = await progress();
    await page.getByRole('button', { name: /推进到评估中/ }).click();
    await expect.poll(progress).not.toBe(before);
  }
}

/** Batch-imports titles into the inbox through the API (in the page, so the session cookie applies). */
async function importLines(page: Page, titles: string[]) {
  const status = await page.evaluate(async (items) => {
    const res = await fetch('/api/import/lines', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items.map((title) => ({ title })) }),
    });
    return res.status;
  }, titles);
  expect(status).toBe(200);
}

test('redirects to login, rejects a wrong password, then logs in', async ({ page }) => {
  await page.goto('/list');
  await expect(page).toHaveURL(/\/login\?next=%2Flist/);
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert')).toContainText('还可以试 4 次');
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/list$/);
});

test('captures with N shortcut and #tags, shows parse preview', async ({ page }) => {
  await login(page);
  const title = `记账小程序 ${uid()}`;
  await page.locator('body').press('n');
  await expect(page.getByRole('textbox', { name: '记下一个想法' })).toBeFocused();
  await page.keyboard.type(`${title} #工具 #小程序`);
  await expect(page.getByText('将会保存为：')).toContainText(title);
  await page.keyboard.press('Enter');
  const card = column(page, '收集箱').getByRole('link', { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card).toContainText('#工具');
  await expect(card).toContainText('#小程序');
  await expect(card).toContainText('未评分');
});

test('dragging an unscored idea into 验证中 asks for a score first', async ({ page }) => {
  await login(page);
  const title = `播客搜索 ${uid()}`;
  await capture(page, title);
  const card = column(page, '收集箱').getByRole('link', { name: new RegExp(title) });

  // Cancel puts it back.
  await drag(page, card, column(page, '验证中'));
  const dialog = page.getByRole('dialog', { name: /进入「验证中」之前/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消，放回原处' }).click();
  // Wait for the modal to really close: while it is open, the next drag lands on its backdrop.
  await expect(dialog).toBeHidden();
  await expect(column(page, '收集箱').getByRole('link', { name: new RegExp(title) })).toBeVisible();

  // Score 9 / 5 / 3 → 5.6 (truncated), then it moves.
  await drag(page, column(page, '收集箱').getByRole('link', { name: new RegExp(title) }), column(page, '验证中'));
  await dialog.getByLabel(/Impact/).fill('9');
  await dialog.getByLabel(/Confidence/).fill('5');
  await dialog.getByLabel(/Ease/).fill('3');
  await expect(dialog.getByTestId('gate-ice')).toHaveText('5.6');
  await dialog.getByLabel('验证假设').fill('有人愿意为中文播客搜索付费');
  await dialog.getByRole('button', { name: '保存并移到验证中' }).click();
  const moved = column(page, '验证中').getByRole('link', { name: new RegExp(title) });
  await expect(moved).toBeVisible();
  await expect(moved).toContainText('ICE 5.6');
  await moved.click();
  await expect(page.getByRole('dialog', { name: '想法详情' }).getByLabel('验证假设')).toHaveValue('有人愿意为中文播客搜索付费');
});

test('detail drawer autosaves, sanitizes markdown and records notes', async ({ page }) => {
  await login(page);
  const title = `详情 ${uid()}`;
  await capture(page, title);
  await column(page, '收集箱').getByRole('link', { name: new RegExp(title) }).click();
  const drawer = page.getByRole('dialog', { name: '想法详情' });
  await expect(drawer).toBeVisible();

  await drawer.getByLabel('标题').fill(`${title} 改`);
  await expect(drawer.getByRole('status').filter({ hasText: '已保存' })).toBeVisible({ timeout: 5000 });

  await drawer.getByLabel('描述（支持 Markdown）').fill('**重点** <img src=x onerror="window.__xss=1">');
  await drawer.getByRole('tab', { name: '预览' }).click();
  const preview = drawer.getByTestId('desc-preview');
  await expect(preview.locator('strong')).toHaveText('重点');
  await expect(preview.locator('img')).not.toHaveAttribute('onerror');
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

  await drawer.getByLabel('添加备注').fill('访谈了 3 个人');
  await drawer.getByRole('button', { name: '添加' }).click();
  await expect(drawer.getByText('访谈了 3 个人')).toBeVisible();

  // Survives a reload (the drawer is addressable by URL).
  await page.reload();
  await expect(page.getByRole('dialog', { name: '想法详情' }).getByLabel('标题')).toHaveValue(`${title} 改`);
});

test('list filters live in the URL and search works', async ({ page }) => {
  await login(page);
  const tag = `t${uid()}`;
  await capture(page, `列表搜索目标 #${tag}`);
  await page.getByRole('link', { name: '列表' }).first().click();
  await page.getByRole('searchbox', { name: '搜索标题和描述' }).fill('列表搜索目标');
  await expect(page).toHaveURL(/q=/);
  await page.getByRole('button', { name: '收集箱', exact: true }).click();
  await expect(page).toHaveURL(/stage=inbox/);
  await expect(page.getByRole('link', { name: '列表搜索目标' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索标题和描述' })).toHaveValue('列表搜索目标');
  await expect(page.getByRole('button', { name: '收集箱', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: '搜索标题和描述' }).fill('完全不存在的关键词zzz');
  await expect(page.getByText('没有符合条件的想法')).toBeVisible();
});

test('weekly review: advance, drop with reason, skip, then summary', async ({ page }) => {
  await login(page);
  // Empty the inbox left by earlier tests (advancing, since skipped ideas stay) so the queue is predictable.
  await emptyInbox(page);
  for (const t of ['筛选 A', '筛选 B', '筛选 C']) await capture(page, `${t} ${uid()}`);
  await page.goto('/list');
  await page.goto('/review');
  await expect(page.getByText('1 / 3')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 / 3')).toBeVisible();

  await page.keyboard.press('d');
  const dialog = page.getByRole('dialog', { name: '为什么放弃？' });
  await dialog.getByLabel('结论').fill('有成熟竞品');
  await dialog.getByLabel('结论').press('Enter');
  await expect(page.getByText('3 / 3')).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '本周筛选完成' })).toBeVisible();
  await expect(page.getByTestId('summary-advanced')).toHaveText('1');
  await expect(page.getByTestId('summary-dropped')).toHaveText('1');
  await expect(page.getByTestId('summary-skipped')).toHaveText('1');
  await expect(page.getByText('放弃 · 有成熟竞品')).toBeVisible();
  await expect(page.getByTestId('summary-remaining')).toHaveText('本次看了 3 条想法，收集箱还剩 1 条（含跳过的 1 条）');
});

test('weekly review: a big inbox is reviewed in batches with a correct remaining count', async ({ page }) => {
  await login(page);
  await emptyInbox(page);
  const tag = uid();
  await importLines(page, Array.from({ length: 52 }, (_, i) => `大收集箱 ${tag} ${i + 1}`));
  await page.goto('/review');
  await expect(page.getByText('1 / 50')).toBeVisible();
  for (let i = 0; i < 50; i++) await page.keyboard.press('Space');

  await expect(page.getByRole('heading', { name: '这一批筛选完成' })).toBeVisible();
  await expect(page.getByTestId('summary-remaining')).toHaveText('本次看了 50 条想法，收集箱还剩 52 条（含跳过的 50 条）');
  await page.getByRole('button', { name: '继续下一批（还有 2 条没看过）' }).click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: `大收集箱 ${tag} 51` })).toBeVisible();
});

test('weekly review: edit in the detail drawer, then exit with a summary', async ({ page }) => {
  await login(page);
  await emptyInbox(page);
  const title = `筛选补充 ${uid()}`;
  await capture(page, title);
  await capture(page, `${title} 二`);
  await page.goto('/review');
  await page.getByRole('link', { name: /打开详情/ }).click();
  const drawer = page.getByRole('dialog', { name: '想法详情' });
  await drawer.getByLabel('描述（支持 Markdown）').fill('**要点**：先问 5 个人');
  await expect(drawer.getByRole('status').filter({ hasText: '已保存' })).toBeVisible({ timeout: 5000 });
  await drawer.getByRole('button', { name: '关闭' }).click();
  // The card follows the edit and renders Markdown.
  await expect(page.getByRole('article').locator('strong')).toHaveText('要点');

  await expect(drawer).toBeHidden(); // shortcuts are ignored while a dialog is open
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 / 2')).toBeVisible();
  await page.getByRole('button', { name: '退出筛选' }).click();
  await expect(page.getByRole('heading', { name: '已退出筛选' })).toBeVisible();
  await expect(page.getByTestId('summary-advanced')).toHaveText('1');
  await expect(page.getByTestId('summary-remaining')).toHaveText('本次看了 1 条想法，收集箱还剩 1 条');
});

test('shipping needs a score and a conclusion; score changes show on the timeline', async ({ page }) => {
  await login(page);
  const title = `直接落地 ${uid()}`;
  await capture(page, title);
  await column(page, '收集箱').getByRole('link', { name: new RegExp(title) }).click();
  const drawer = page.getByRole('dialog', { name: '想法详情' });
  await drawer.getByLabel('阶段').selectOption('已落地');
  const gate = page.getByRole('dialog', { name: '做成了！结论是什么？' });
  await expect(gate.getByLabel(/Impact/)).toBeVisible();
  await expect(gate.getByRole('button', { name: '确认落地' })).toBeDisabled();
  await gate.getByLabel('结论').fill('上线了，第一周 30 个用户');
  await gate.getByRole('button', { name: '确认落地' }).click();
  await expect(drawer.getByText('已落地：上线了，第一周 30 个用户')).toBeVisible();
  await expect(drawer.getByRole('list').getByText('ICE 评分')).toBeVisible();
  await expect(drawer.getByText('5.0（I 5 / C 5 / E 5）')).toBeVisible();
  await expect(drawer.getByRole('button', { name: '清除评分' })).toHaveCount(0);
  await expect(drawer.getByRole('region', { name: '验证计划' })).toBeVisible();
});

test('capture toast opens the new idea', async ({ page }) => {
  await login(page);
  const title = `马上补充 ${uid()}`;
  await capture(page, title);
  await page.getByRole('status').getByRole('button', { name: '打开' }).first().click();
  await expect(page.getByRole('dialog', { name: '想法详情' }).getByLabel('标题')).toHaveValue(title);
});

test('tags can be renamed, merged and deleted from settings', async ({ page }) => {
  await login(page);
  const a = `甲${uid()}`;
  const b = `乙${uid()}`;
  await capture(page, `标签管理一 #${a}`);
  await capture(page, `标签管理二 #${b}`);
  await page.goto('/settings');
  const tags = page.getByRole('region', { name: '标签' });
  await tags.getByRole('button', { name: `重命名 #${b}` }).click();
  await tags.getByLabel(`#${b} 的新名字`).fill(a);
  await tags.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText(`已合并到 #${a}`)).toBeVisible();
  await expect(tags.getByRole('button', { name: `重命名 #${b}` })).toHaveCount(0);
  await expect(tags.getByRole('listitem').filter({ hasText: `#${a}` })).toContainText('2 条');

  await tags.getByRole('button', { name: `删除 #${a}` }).click();
  await page.getByRole('dialog', { name: `删除标签 #${a}？` }).getByRole('button', { name: '确认删除' }).click();
  await expect(tags.getByRole('button', { name: `删除 #${a}` })).toHaveCount(0);
});

test('exporting with an expired session goes to the login page', async ({ page, context }) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '导出' })).toBeVisible();
  await context.clearCookies();
  await page.getByRole('button', { name: '导出 JSON' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
});

test('mobile: no horizontal scroll, stage tabs and capture work', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  const title = `手机 ${uid()}`;
  await capture(page, `${title} #移动`);
  await expect(page.getByRole('tab', { name: /收集箱/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: '.playwright/mvp-20261029/mobile-board.png', fullPage: true });
});

test('insights: counts follow new ideas, rows link to the list, weekly table', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '概览' }).first().click();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  const inbox = page.getByTestId('stage-count-inbox');
  const before = Number(await inbox.textContent());
  const weekRows = page.getByRole('table').getByRole('row');
  await page.getByText('查看数据表').click();
  const thisWeek = () => weekRows.last().getByRole('cell').first();
  const createdBefore = Number(await thisWeek().textContent());

  await capture(page, `概览计数 ${uid()}`);
  await expect(inbox).toHaveText(String(before + 1));
  await expect(page.getByTestId('reached-inbox')).not.toHaveText('0');
  await expect(thisWeek()).toHaveText(String(createdBefore + 1));
  await expect(page.getByRole('list', { name: '图例' })).toContainText('新增');

  await page.getByRole('region', { name: '各阶段数量' }).getByRole('link', { name: `收集箱 ${before + 1} 条` }).click();
  await expect(page).toHaveURL(/\/list\?stage=inbox/);
  await expect(page.getByRole('button', { name: '收集箱', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('batch import: preview flags bad lines, imports the rest into the inbox', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  const tag = `批量${uid()}`;
  await page.getByLabel(/每行一条想法/).fill(`批量甲 #${tag}\n\n批量乙 #${tag} #工具\n#只有标签`);
  const preview = page.getByRole('region', { name: '导入预览' });
  await expect(preview).toContainText('将会导入 2 条，1 行无法导入');
  await expect(preview).toContainText('第 4 行：没有标题');
  await expect(preview.getByText(`#${tag}`)).toHaveCount(2);
  await page.getByRole('button', { name: '导入 2 条' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已导入到收集箱：新增 2 条' })).toBeVisible();
  await expect(page.getByLabel(/每行一条想法/)).toHaveValue('');

  await page.goto(`/list?tags=${encodeURIComponent(tag)}&stage=inbox`);
  await expect(page.getByRole('link', { name: /批量甲/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /批量乙/ })).toBeVisible();
});

test('export JSON and import it back: existing ideas are skipped, new ones restored', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 JSON' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^idea-funnel-\d{8}\.json$/);
  const file = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'));
  expect(file.ideas.length).toBeGreaterThan(0);

  const input = page.getByLabel('选择导出文件');
  await input.setInputFiles({ name: 'same.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByRole('status').filter({ hasText: `导入完成：新增 0 条，跳过 ${file.ideas.length} 条（库里已有）` })).toBeVisible();

  const restoredTitle = `从备份恢复 ${uid()}`;
  const restored = { ...file.ideas[0], id: crypto.randomUUID(), title: restoredTitle, events: [] };
  const path = testInfo.outputPath('restore.json');
  await (await import('node:fs/promises')).writeFile(path, JSON.stringify({ ...file, ideas: [restored] }));
  await input.setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: '导入完成：新增 1 条' })).toBeVisible();
  await page.goto('/list');
  await page.getByRole('searchbox', { name: '搜索标题和描述' }).fill(restoredTitle);
  await expect(page.getByRole('link', { name: new RegExp(restoredTitle) })).toBeVisible();
});

test('mobile: insights fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.getByRole('navigation', { name: '底部导航' }).getByRole('link', { name: '概览' }).click();
  await expect(page.getByRole('heading', { name: '最近 12 周' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: '.playwright/mvp-20261029/mobile-insights.png', fullPage: true });
});
