import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'idea-funnel';

async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '看板', exact: true })).toBeVisible();
}

async function logout(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
}

async function capture(page: Page, title: string) {
  await page.getByRole('textbox', { name: '记下一个想法' }).fill(title);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '记下一个想法' })).toHaveValue('');
}

test('admin creates an account; ordinary users retain business features with private data and password changes', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const username = `user_${suffix}`;
  const adminTitle = `admin-private-${suffix}`;
  const ownTitle = `user-private-${suffix}`;
  await login(page, 'admin');
  await capture(page, adminTitle);
  await page.goto('/settings');
  const accounts = page.getByRole('region', { name: '账号管理' });
  await expect(accounts).toBeVisible();
  await accounts.getByLabel('新账号用户名', { exact: true }).fill(username);
  await accounts.getByLabel('初始密码', { exact: true }).fill(PASSWORD);
  await accounts.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(accounts.getByText(username, { exact: true })).toBeVisible();
  await logout(page);

  await login(page, username);
  await expect(page.getByRole('link', { name: new RegExp(adminTitle) })).toHaveCount(0);
  await capture(page, ownTitle);
  await expect(page.getByRole('link', { name: new RegExp(ownTitle) })).toBeVisible();
  for (const [path, title] of [['/list', '列表'], ['/review', ownTitle], ['/insights', '概览'], ['/settings', '设置']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: '账号管理' })).toHaveCount(0);
  const denied = await page.request.get('/api/admin/users');
  expect(denied.status()).toBe(403);
  await page.getByLabel('每行一条想法', { exact: false }).fill(`import-${suffix} #测试`);
  await page.getByRole('button', { name: /导入.*条/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '新增 1 条' })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^idea-funnel-.*\.json$/);
  const exported = await (await page.request.get('/api/export')).json();
  expect(exported.ideas.map((idea: { title: string }) => idea.title).sort()).toEqual([ownTitle, `import-${suffix}`].sort());

  await page.getByLabel('原密码', { exact: true }).fill(PASSWORD);
  await page.getByLabel('新密码', { exact: true }).fill('new-account-password');
  await page.getByLabel('确认新密码', { exact: true }).fill('new-account-password');
  await page.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, username, 'new-account-password');
  await expect(page.getByRole('link', { name: new RegExp(ownTitle) })).toBeVisible();
  await logout(page);
  await login(page, 'admin');
  await expect(page.getByRole('link', { name: new RegExp(ownTitle) })).toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(adminTitle) })).toBeVisible();
});
