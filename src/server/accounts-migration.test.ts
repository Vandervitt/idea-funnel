import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { expect, it } from 'vitest';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import type { Db } from './db.js';

it('upgrades real legacy data and assigns ideas, tags and events exclusively to admin', async () => {
  const pg = await PGlite.create({ extensions: { pg_trgm } });
  try {
    for (const migration of ['20261029000000_init', '20261029073758_idea_events_type_created_idx', '20261029090000_review_improvements']) {
      await pg.exec(await readFile(new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'));
    }
    const ideaId = 'd33381f0-0ee9-47f6-8a61-dab72cde364a';
    const tagId = '4f0ccaae-fd73-449a-b963-b3cf6fc00cd7';
    await pg.query("INSERT INTO ideas (id, owner_id, title) VALUES ($1, 'me', 'legacy idea')", [ideaId]);
    await pg.query("INSERT INTO tags (id, owner_id, name) VALUES ($1, 'me', 'legacy-tag')", [tagId]);
    await pg.query('INSERT INTO idea_tags (idea_id, tag_id) VALUES ($1, $2)', [ideaId, tagId]);
    await pg.query("INSERT INTO idea_events (idea_id, type, note) VALUES ($1, 'note', 'legacy note')", [ideaId]);
    const sql = await readFile(new URL('../../prisma/migrations/20261030163050_accounts/migration.sql', import.meta.url), 'utf8');
    // Negative control on an isolated transaction: omitting the admin bootstrap must break the owner FK.
    // The failed transaction rolls back, leaving the original legacy schema/data for the real migration.
    await expect(pg.transaction(async (tx) => {
      await tx.exec(sql.replace("INSERT INTO users (id, username, role) VALUES ('me', 'admin', 'admin');", ''));
    })).rejects.toThrow(/foreign key constraint/);
    await pg.transaction(async (tx) => { await tx.exec(sql); });
    const db: Db = {
      query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
      transaction: (statements) => pg.transaction(async (tx) => {
        const rows: Record<string, unknown>[][] = [];
        for (const statement of statements) rows.push((await tx.query<Record<string, unknown>>(statement.text, statement.params ?? [])).rows);
        return rows;
      }),
    };
    const password = 'legacy-password';
    const passwordHash = await hashPassword(password);
    const app = createApp({ getDb: async () => db,
      getConfig: () => ({ passwordHash, secureCookie: true }),
      getClientIp: () => '127.0.0.1' });
    const request = (path: string, cookie = '', body?: unknown) => app.request(`http://localhost/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username: string) => {
      const res = await request('/auth/login', '', { username, password });
      expect(res.status).toBe(200);
      return res.headers.get('set-cookie')!.split(';')[0];
    };
    const admin = await login('admin');
    expect(await (await request('/me', admin)).json()).toEqual({ id: 'me', username: 'admin', role: 'admin' });
    const idea = await (await request(`/ideas/${ideaId}`, admin)).json();
    expect(idea).toMatchObject({ id: ideaId, title: 'legacy idea', tags: ['legacy-tag'] });
    const events = await (await request(`/ideas/${ideaId}/events`, admin)).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'note', note: 'legacy note' });
    expect((await request('/admin/users', admin, { username: 'newuser', password })).status).toBe(201);
    const ordinary = await login('newuser');
    expect((await (await request('/ideas', ordinary)).json()).items).toEqual([]);
    expect(await (await request('/tags', ordinary)).json()).toEqual([]);
    expect((await request(`/ideas/${ideaId}`, ordinary)).status).toBe(404);
    expect((await request(`/ideas/${ideaId}/events`, ordinary)).status).toBe(404);
    expect((await (await request('/export', ordinary)).json()).ideas).toEqual([]);
  } finally {
    await pg.close();
  }
});
