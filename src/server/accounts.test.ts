import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccounts } from './accounts.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { createPgliteDb } from './pglite.js';

const PASSWORD = 'account-password-123';
let db: Awaited<ReturnType<typeof createPgliteDb>>;
let app: ReturnType<typeof createApp>;
let admin: string;

function request(path: string, cookie = '', body?: unknown, method?: string, ip = '1.2.3.4') {
  return app.request(`http://localhost/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie, 'x-real-ip': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(username = 'admin', password = PASSWORD, ip?: string) {
  const res = await request('/auth/login', '', { username, password }, undefined, ip);
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}
async function user(username: string) {
  const res = await request('/admin/users', admin, { username, password: PASSWORD });
  expect(res.status).toBe(201);
  return { profile: await res.json(), cookie: await login(username) };
}

beforeAll(async () => {
  db = await createPgliteDb();
  const passwordHash = await hashPassword(PASSWORD);
  app = createApp({ getDb: async () => db,
    getConfig: () => ({ passwordHash, secureCookie: true }),
    getClientIp: (c) => c.req.header('x-real-ip') ?? 'unknown' });
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE ideas, tags, idea_tags, idea_events, login_attempts CASCADE');
  // Also runs against the pre-feature schema, so the red test fails on HTTP behavior.
  await db.query(`DO $$ BEGIN IF to_regclass('public.users') IS NOT NULL THEN TRUNCATE users CASCADE; END IF; END $$`);
  admin = await login();
});

describe('accounts and ownership', () => {
  it('identifies the legacy admin and only lets admin create ordinary users', async () => {
    expect(await (await request('/me', admin)).json()).toEqual({ id: 'me', username: 'admin', role: 'admin' });
    const alice = await user('Alice');
    expect(alice.profile).toMatchObject({ username: 'alice', role: 'user' });
    expect(Object.keys(alice.profile).sort()).toEqual(['createdAt', 'id', 'role', 'username']);
    expect((await request('/admin/users', alice.cookie)).status).toBe(403);
    expect((await request('/admin/users', alice.cookie, { username: 'bob', password: PASSWORD })).status).toBe(403);
    expect((await request('/admin/users')).status).toBe(401);
    expect((await request('/admin/users', admin, { username: 'ALICE', password: PASSWORD })).status).toBe(409);
    expect((await request('/admin/users', admin, { username: 'root', password: PASSWORD, role: 'admin' })).status).toBe(400);
    const list = await (await request('/admin/users', admin)).json();
    expect(list.items.map((item: { username: string }) => item.username).sort()).toEqual(['admin', 'alice']);
    expect(list.nextCursor).toBeNull();
    expect(JSON.stringify(list)).not.toMatch(/password|hash|session/);
  });
  it('isolates all business reads and rejects cross-account mutations', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const made = await request('/ideas', alice.cookie, { title: 'Alice private', tags: ['secret'] });
    expect(made.status).toBe(201);
    const idea = await made.json();
    const noteRes = await request(`/ideas/${idea.id}/events`, alice.cookie, { note: 'private note' });
    expect(noteRes.status).toBe(201);
    const note = await noteRes.json();
    for (const cookie of [bob.cookie, admin]) {
      expect((await (await request('/ideas', cookie)).json()).items).toEqual([]);
      expect((await (await request('/board', cookie)).json()).every((col: { count: number }) => col.count === 0)).toBe(true);
      expect((await (await request('/stats', cookie)).json()).inbox).toBe(0);
      expect(await (await request('/tags', cookie)).json()).toEqual([]);
      expect((await (await request('/export', cookie)).json()).ideas).toEqual([]);
      expect((await (await request('/insights', cookie)).json()).stages.every((stage: { count: number }) => stage.count === 0)).toBe(true);
      expect((await request(`/ideas/${idea.id}`, cookie)).status).toBe(404);
      expect((await request(`/ideas/${idea.id}/events`, cookie)).status).toBe(404);
      expect((await request(`/ideas/${idea.id}`, cookie, { title: 'stolen' }, 'PATCH')).status).toBe(404);
      expect((await request(`/ideas/${idea.id}`, cookie, undefined, 'DELETE')).status).toBe(404);
      expect((await request(`/ideas/${idea.id}/stage`, cookie, { to: 'evaluating' })).status).toBe(404);
      expect((await request(`/ideas/${idea.id}/events`, cookie, { note: 'stolen' })).status).toBe(404);
      expect((await request(`/ideas/${idea.id}/events/${note.id}`, cookie, undefined, 'DELETE')).status).toBe(404);
      expect((await request('/tags/secret', cookie, { name: 'stolen' }, 'PATCH')).status).toBe(404);
      expect((await request('/tags/secret', cookie, undefined, 'DELETE')).status).toBe(404);
    }
    expect((await (await request(`/ideas/${idea.id}`, alice.cookie)).json()).title).toBe('Alice private');
    const exported = await (await request('/export', alice.cookie)).json();
    // Global UUID conflicts must not overwrite the existing owner's data or attach foreign events/tags.
    expect(await (await request('/import/json', bob.cookie, exported)).json()).toEqual({ inserted: 0, skipped: 1 });
    expect((await (await request('/ideas', bob.cookie)).json()).items).toEqual([]);
    expect((await request('/import/lines', bob.cookie, { items: [{ title: 'Bob private', tags: ['secret'] }] })).status).toBe(200);
    expect((await (await request('/export', bob.cookie)).json()).ideas.map((i: { title: string }) => i.title)).toEqual(['Bob private']);
    expect((await request(`/ideas/${idea.id}/stage`, alice.cookie, { to: 'evaluating' })).status).toBe(200);
    expect((await request(`/ideas/${idea.id}`, alice.cookie, { ice: { impact: 7, confidence: 8, ease: 9 } }, 'PATCH')).status).toBe(200);
    expect((await request(`/ideas/${idea.id}`, alice.cookie, undefined, 'DELETE')).status).toBe(204);
  });

  it('revokes only the logged-out session and rejects fabricated or expired sessions', async () => {
    const second = await login();
    expect(second).not.toBe(admin);
    expect((await request('/auth/logout', admin, {}, 'POST')).status).toBe(200);
    expect((await request('/me', admin)).status).toBe(401);
    expect((await request('/me', second)).status).toBe(200);
    expect((await request('/me', 'if_session=9999999999.' + 'A'.repeat(43))).status).toBe(401);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await request('/me', second)).status).toBe(401);
  });

  it('requires the current password and revokes every session after changing it', async () => {
    const alice = await user('alice');
    const second = await login('alice');
    expect((await request('/auth/password', alice.cookie, { currentPassword: 'wrong', newPassword: 'new-password-123' })).status).toBe(401);
    expect((await request('/me', alice.cookie)).status).toBe(200);
    expect((await request('/auth/password', alice.cookie, { currentPassword: PASSWORD, newPassword: 'new-password-123' })).status).toBe(200);
    expect((await request('/me', alice.cookie)).status).toBe(401);
    expect((await request('/me', second)).status).toBe(401);
    expect((await request('/me', admin)).status).toBe(200);
    expect((await request('/auth/login', '', { username: 'alice', password: PASSWORD })).status).toBe(401);
    expect((await request('/me', await login('ALICE', 'new-password-123'))).status).toBe(200);
  });

  it('never resets an existing admin password from the bootstrap configuration', async () => {
    expect((await request('/auth/password', admin, { currentPassword: PASSWORD, newPassword: 'changed-admin-password' })).status).toBe(200);
    expect((await request('/auth/login', '', { username: 'admin', password: PASSWORD })).status).toBe(401);
    expect(await (await request('/me', await login('admin', 'changed-admin-password'))).json()).toEqual({ id: 'me', username: 'admin', role: 'admin' });
  });

  it('rejects invalid account inputs and password-only login', async () => {
    expect((await request('/auth/login', '', { password: PASSWORD })).status).toBe(400);
    for (const body of [
      { username: 'ab', password: PASSWORD }, { username: 'has spaces', password: PASSWORD },
      { username: 'x'.repeat(33), password: PASSWORD }, { username: 'alice', password: 'short' },
      { username: 'alice', password: 'x'.repeat(201) },
    ]) expect((await request('/admin/users', admin, body)).status).toBe(400);
    expect((await request('/auth/password', admin, { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
  });

  it('limits one attacked username without globally locking unrelated accounts', async () => {
    await user('alice');
    await user('bob');
    for (let i = 0; i < 30; i++) {
      const res = await request('/auth/login', '', { username: 'ALICE', password: 'wrong' }, undefined, `10.0.0.${i}`);
      expect(res.status).toBe(i === 29 ? 429 : 401);
    }
    expect((await request('/auth/login', '', { username: 'alice', password: PASSWORD }, undefined, '10.0.1.1')).status).toBe(429);
    expect((await request('/me', await login('bob', PASSWORD, '10.0.1.2'))).status).toBe(200);
  });

  it('stores a session digest instead of its bearer token', async () => {
    const token = admin.slice(admin.indexOf('=') + 1);
    const rows = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(rows[0].token_hash).toBe(expected);
    // A database hash leaked as a cookie is not itself a valid credential.
    expect((await request('/me', `if_session=${rows[0].token_hash}`)).status).toBe(401);
    expect((await request('/me', admin)).status).toBe(200);
  });

  it('paginates accounts in stable pages of 50 without duplicates or omissions', async () => {
    const hash = await hashPassword(PASSWORD);
    const names = Array.from({ length: 101 }, (_, i) => `user_${String(i).padStart(3, '0')}`);
    await db.query('INSERT INTO users (username, password_hash) SELECT unnest($1::text[]), $2', [names, hash]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const res = await request(`/admin/users${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, admin);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(page < 2 ? 50 : 2);
      seen.push(...body.items.map((item: { username: string }) => item.username));
      cursor = body.nextCursor;
      if (page < 2) expect(cursor).not.toBeNull();
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual(['admin', ...names]);
  });

  it('refuses session creation using credentials read before a password change', async () => {
    const accounts = createAccounts(db);
    const before = (await accounts.credentials('admin'))!;
    expect(await accounts.openSession(before)).toEqual(expect.any(String));
    expect(await accounts.changePassword(before, await hashPassword('changed-password-123'))).toBe(true);
    expect(await accounts.openSession(before)).toBeNull();
    const after = (await accounts.credentials('admin'))!;
    expect(after.password_version).toBe(before.password_version + 1);
    const token = await accounts.openSession(after);
    expect(token).toEqual(expect.any(String));
    expect((await request('/me', `if_session=${token}`)).status).toBe(200);
  });

});
