import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'idea-funnel';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '看板', exact: true })).toBeVisible();
}

test('account switches, logout and password changes clear identity in other tabs', async ({ page, context }) => {
  const username = `tabs_${Date.now().toString(36)}`;
  await login(page, 'admin');
  const created = await page.request.post('/api/admin/users', { data: { username, password: PASSWORD } });
  expect(created.status()).toBe(201);
  const other = await context.newPage();
  await other.goto('/settings');
  const current = other.getByRole('region', { name: '当前账号' });
  await expect(current).toContainText('admin');
  await expect(other.getByRole('region', { name: '账号管理' })).toBeVisible();

  // Same browser cookies, separate in-memory caches. Switching in one tab must update the other.
  await login(page, username);
  await expect(current).toContainText(username);
  await expect(other.getByRole('region', { name: '账号管理' })).toHaveCount(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(other).toHaveURL(/\/login/);
  await expect(other.getByRole('region', { name: '当前账号' })).toHaveCount(0);

  await login(page, username);
  await other.goto('/settings');
  await expect(current).toContainText(username);
  await page.goto('/settings');
  await page.getByLabel('原密码', { exact: true }).fill(PASSWORD);
  await page.getByLabel('新密码', { exact: true }).fill('new-tabs-password');
  await page.getByLabel('确认新密码', { exact: true }).fill('new-tabs-password');
  await page.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(other).toHaveURL(/\/login/);
  await expect(other.getByRole('region', { name: '当前账号' })).toHaveCount(0);
});
