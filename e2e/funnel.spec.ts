import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'idea-funnel'; // dev fallback password of src/entry/node.ts
const uid = () => Math.random().toString(36).slice(2, 7);

async function login(page: Page) {
  await page.goto('/login');
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
}

test('redirects to login, rejects a wrong password, then logs in', async ({ page }) => {
  await page.goto('/list');
  await expect(page).toHaveURL(/\/login\?next=%2Flist/);
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
  await expect(column(page, '收集箱').getByRole('link', { name: new RegExp(title) })).toBeVisible();

  // Score 9 / 5 / 3 → 5.6 (truncated), then it moves.
  await drag(page, column(page, '收集箱').getByRole('link', { name: new RegExp(title) }), column(page, '验证中'));
  await dialog.getByLabel(/Impact/).fill('9');
  await dialog.getByLabel(/Confidence/).fill('5');
  await dialog.getByLabel(/Ease/).fill('3');
  await expect(dialog.getByTestId('gate-ice')).toHaveText('5.6');
  await dialog.getByRole('button', { name: '保存并移到验证中' }).click();
  const moved = column(page, '验证中').getByRole('link', { name: new RegExp(title) });
  await expect(moved).toBeVisible();
  await expect(moved).toContainText('ICE 5.6');
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
  await page.goto('/review');
  const finished = page.getByRole('heading', { name: /筛选完成|收集箱是空的/ });
  await expect(finished.or(page.getByRole('progressbar'))).toBeVisible();
  while (!(await finished.isVisible())) {
    const before = await page.getByRole('progressbar').getAttribute('aria-valuenow');
    await page.getByRole('button', { name: /推进到评估中/ }).click();
    await expect(async () => {
      expect((await finished.isVisible()) || (await page.getByRole('progressbar').getAttribute('aria-valuenow')) !== before).toBe(true);
    }).toPass();
  }
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
