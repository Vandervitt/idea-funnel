import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import type { Db } from './db.js';
import { expect, it } from 'vitest';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { createPgliteDb } from './pglite.js';

it('does not initialize an admin password from application configuration during login', async () => {
  const db = await createPgliteDb();
  try {
    const cfg = { passwordHash: await hashPassword('old-config-password'), secureCookie: true };
    const app = createApp({ getDb: async () => db, getConfig: () => cfg, getClientIp: () => '127.0.0.1' });
    const res = await app.request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ username: 'admin', password: 'old-config-password' }),
    });
    expect(res.status).toBe(401);
    expect((await db.query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = 'me'"))[0].password_hash).toBeNull();
  } finally { await db.close(); }
});

const INITIAL_PASSWORD = 'IdeaFunnel-Init-2026!';
const initSql = () => readFile(new URL('../../prisma/init.sql', import.meta.url), 'utf8');
const resetSql = () => readFile(new URL('../../prisma/operations/20261031_reset_admin.sql', import.meta.url), 'utf8');

async function sqlFixture() {
  const pg = await PGlite.create({ extensions: { pg_trgm } });
  const dir = new URL('../../prisma/migrations/', import.meta.url);
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await pg.exec(await readFile(new URL(`${entry.name}/migration.sql`, dir), 'utf8'));
  }
  const db: Db = {
    query: async <T,>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    transaction: (statements) => pg.transaction(async (tx) => {
      const rows: Record<string, unknown>[][] = [];
      for (const statement of statements) rows.push((await tx.query<Record<string, unknown>>(statement.text, statement.params ?? [])).rows);
      return rows;
    }),
  };
  const app = createApp({ getDb: async () => db, getConfig: () => ({ secureCookie: true }), getClientIp: () => '127.0.0.1' });
  const request = (path: string, cookie = '', body?: unknown) => app.request(`http://localhost/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = async (username = 'admin', password = INITIAL_PASSWORD) => {
    const res = await request('/auth/login', '', { username, password });
    expect(res.status).toBe(200);
    return res.headers.get('set-cookie')!.split(';')[0];
  };
  return { pg, db, request, login };
}

it('initializes admin through SQL and repeating init preserves changed passwords, sessions and private data', async () => {
  const { pg, db, request, login } = await sqlFixture();
  try {
    // This data predates password initialization, as it does in an upgraded single-user instance.
    await db.query("INSERT INTO ideas (owner_id, title) VALUES ('me', 'legacy private idea')");
    await pg.exec(await initSql());
    const initialSession = await login();
    expect(await (await request('/me', initialSession)).json()).toEqual({ id: 'me', username: 'admin', role: 'admin' });
    expect((await request('/auth/password', initialSession, {
      currentPassword: INITIAL_PASSWORD, newPassword: 'my-changed-admin-password',
    })).status).toBe(200);
    const changedSession = await login('admin', 'my-changed-admin-password');
    const beforeUser = await db.query("SELECT * FROM users WHERE id = 'me'");
    const beforeSessions = await db.query('SELECT * FROM sessions ORDER BY token_hash');
    const beforeIdeas = await db.query('SELECT * FROM ideas ORDER BY id');
    await pg.exec(await initSql());
    await pg.exec(await initSql());
    expect(await db.query("SELECT * FROM users WHERE id = 'me'")).toEqual(beforeUser);
    expect(await db.query('SELECT * FROM sessions ORDER BY token_hash')).toEqual(beforeSessions);
    expect(await db.query('SELECT * FROM ideas ORDER BY id')).toEqual(beforeIdeas);
    expect((await request('/me', changedSession)).status).toBe(200);
    expect((await request('/auth/login', '', { username: 'admin', password: INITIAL_PASSWORD })).status).toBe(401);
    expect((await request('/me', await login('admin', 'my-changed-admin-password'))).status).toBe(200);
  } finally { await pg.close(); }
});

it('explicit reset changes only admin credentials and invalidates all admin sessions', async () => {
  const { pg, db, request, login } = await sqlFixture();
  try {
    await pg.exec(await initSql());
    const initial = await login();
    expect((await request('/admin/users', initial, { username: 'alice', password: 'alice-private-password' })).status).toBe(201);
    const alice = await login('alice', 'alice-private-password');
    expect((await request('/ideas', initial, { title: 'admin idea', tags: ['admin-tag'] })).status).toBe(201);
    expect((await request('/ideas', alice, { title: 'alice idea', tags: ['alice-tag'] })).status).toBe(201);
    expect((await request('/auth/password', initial, {
      currentPassword: INITIAL_PASSWORD, newPassword: 'lost-admin-password',
    })).status).toBe(200);
    const first = await login('admin', 'lost-admin-password');
    const second = await login('admin', 'lost-admin-password');
    const [before] = await db.query<{ password_version: number; password_hash: string }>("SELECT password_version, password_hash FROM users WHERE id = 'me'");
    const others = await db.query("SELECT * FROM users WHERE id <> 'me' ORDER BY id");
    const otherSessions = await db.query("SELECT * FROM sessions WHERE user_id <> 'me' ORDER BY token_hash");
    const snapshots = await Promise.all(['ideas', 'tags', 'idea_tags', 'idea_events'].map((table) => db.query(`SELECT * FROM ${table}`)));
    await pg.exec(await resetSql());
    const [after] = await db.query<{ password_version: number; password_hash: string }>("SELECT password_version, password_hash FROM users WHERE id = 'me'");
    expect(after.password_version).toBe(before.password_version + 1);
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(await db.query("SELECT * FROM sessions WHERE user_id = 'me'")).toEqual([]);
    expect((await request('/me', first)).status).toBe(401);
    expect((await request('/me', second)).status).toBe(401);
    expect((await request('/auth/login', '', { username: 'admin', password: 'lost-admin-password' })).status).toBe(401);
    expect((await request('/me', await login())).status).toBe(200);
    expect(await db.query("SELECT * FROM users WHERE id <> 'me' ORDER BY id")).toEqual(others);
    expect(await db.query("SELECT * FROM sessions WHERE user_id <> 'me' ORDER BY token_hash")).toEqual(otherSessions);
    expect((await request('/me', alice)).status).toBe(200);
    for (const [index, table] of ['ideas', 'tags', 'idea_tags', 'idea_events'].entries()) {
      expect(await db.query(`SELECT * FROM ${table}`)).toEqual(snapshots[index]);
    }
  } finally { await pg.close(); }
});

it('fails explicitly instead of silently succeeding when reset has no admin account', async () => {
  const { pg, db } = await sqlFixture();
  try {
    await db.query("DELETE FROM users WHERE id = 'me'");
    await expect(pg.exec(await resetSql())).rejects.toThrow(/admin|管理员/i);
    expect(await db.query('SELECT * FROM users')).toEqual([]);
  } finally { await pg.close(); }
});
