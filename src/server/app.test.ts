import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword, signSession, SESSION_COOKIE, MAX_GLOBAL_FAILURES } from './auth';
import { createPgliteDb } from './pglite';
import type { Idea, IdeaEvent, IdeaPage, BoardColumn } from '../shared/schema';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'test-secret-test-secret-test-secret-0123';
const ORIGIN = 'http://localhost';

let db: Awaited<ReturnType<typeof createPgliteDb>>;
let app: ReturnType<typeof createApp>;
let cookie: string;

beforeAll(async () => {
  db = await createPgliteDb();
  const passwordHash = await hashPassword(PASSWORD);
  app = createApp({
    getDb: async () => db,
    getConfig: () => ({ passwordHash, sessionSecret: SECRET, secureCookie: true }),
    getClientIp: (c) => c.req.header('x-real-ip') ?? 'unknown',
  });
  cookie = `${SESSION_COOKIE}=${await signSession(SECRET)}`;
});

afterAll(() => db.close());

beforeEach(async () => {
  await db.query('TRUNCATE ideas, tags, idea_tags, idea_events, login_attempts CASCADE');
});

function call(path: string, init: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'x-real-ip': '1.1.1.1', ...init.headers };
  if (init.auth !== false) headers.cookie = cookie;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function create(title: string, tags: string[] = []): Promise<Idea> {
  const res = await call('/api/ideas', { body: { title, tags } });
  expect(res.status).toBe(201);
  return res.json();
}

const ice = (impact: number, confidence: number, ease: number) => ({ ice: { impact, confidence, ease } });

describe('auth', () => {
  it('rejects API calls without a valid session', async () => {
    expect((await call('/api/ideas', { auth: false })).status).toBe(401);
    expect((await call('/api/me', { auth: false })).status).toBe(401);
    const forged = await call('/api/ideas', { auth: false, headers: { cookie: `${SESSION_COOKIE}=9999999999.${'A'.repeat(43)}` } });
    expect(forged.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const old = await signSession(SECRET, Date.now() - 31 * 24 * 3600 * 1000);
    expect((await call('/api/me', { auth: false, headers: { cookie: `${SESSION_COOKIE}=${old}` } })).status).toBe(401);
  });

  it('logs in with the right password and sets a hardened cookie', async () => {
    const res = await call('/api/auth/login', { auth: false, body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    const session = setCookie.split(';')[0];
    expect((await call('/api/me', { auth: false, headers: { cookie: session } })).status).toBe(200);
  });

  it('locks an IP after 5 wrong passwords, even for the right one', async () => {
    for (let left = 4; left >= 1; left--) {
      const res = await call('/api/auth/login', { auth: false, body: { password: 'nope' } });
      expect(res.status).toBe(401);
      expect((await res.json()).attemptsLeft).toBe(left);
    }
    expect((await call('/api/auth/login', { auth: false, body: { password: 'nope' } })).status).toBe(429);
    expect((await call('/api/auth/login', { auth: false, body: { password: PASSWORD } })).status).toBe(429);
    // Another IP is unaffected.
    const other = await call('/api/auth/login', { auth: false, body: { password: PASSWORD }, headers: { 'x-real-ip': '2.2.2.2' } });
    expect(other.status).toBe(200);
  });

  it('cannot dodge the lockout by forging other IP headers', async () => {
    // The entry decides which header is trustworthy (x-real-ip in this test app); others are attacker-controlled.
    for (let i = 0; i < 5; i++) {
      await call('/api/auth/login', {
        auth: false,
        body: { password: 'nope' },
        headers: { 'cf-connecting-ip': `9.9.9.${i}`, 'x-forwarded-for': `8.8.8.${i}` },
      });
    }
    expect((await call('/api/auth/login', { auth: false, body: { password: PASSWORD } })).status).toBe(429);
  });

  it('locks all logins after too many failures across IPs', async () => {
    for (let i = 0; i < MAX_GLOBAL_FAILURES; i++) {
      await call('/api/auth/login', { auth: false, body: { password: 'nope' }, headers: { 'x-real-ip': `10.0.${i >> 8}.${i & 255}` } });
    }
    const fresh = await call('/api/auth/login', { auth: false, body: { password: PASSWORD }, headers: { 'x-real-ip': '3.3.3.3' } });
    expect(fresh.status).toBe(429);
  });

  it('blocks cross-site form posts', async () => {
    const res = await app.request(`${ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'x=1',
    });
    expect(res.status).toBe(403);
  });
});

describe('ideas CRUD', () => {
  it('creates an idea in the inbox with tags and a created event', async () => {
    const idea = await create('做个记账小程序', ['工具', '小程序']);
    expect(idea.stage).toBe('inbox');
    expect(idea.tags).toEqual(['小程序', '工具'].sort());
    expect(idea.iceX10).toBeNull();
    const events: IdeaEvent[] = await (await call(`/api/ideas/${idea.id}/events`)).json();
    expect(events.map((e) => e.type)).toEqual(['created']);
  });

  it('validates input', async () => {
    expect((await call('/api/ideas', { body: { title: '   ' } })).status).toBe(400);
    expect((await call('/api/ideas', { body: { title: 'x'.repeat(201) } })).status).toBe(400);
    expect((await call('/api/ideas', { body: { title: 'ok', tags: ['有 空格'] } })).status).toBe(400);
    expect((await call('/api/ideas/not-a-uuid')).status).toBe(400);
    const idea = await create('a');
    const bad = await call(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { links: ['javascript:alert(1)'] } });
    expect(bad.status).toBe(400);
  });

  it('updates fields, replaces tags and computes a truncated ICE', async () => {
    const idea = await create('a', ['x', 'y']);
    const res = await call(`/api/ideas/${idea.id}`, {
      method: 'PATCH',
      body: { title: 'b', tags: ['y', 'z'], links: ['https://example.com'], ...ice(7, 8, 8) },
    });
    const updated: Idea = await res.json();
    expect(updated.title).toBe('b');
    expect(updated.tags).toEqual(['y', 'z']);
    expect(updated.links).toEqual(['https://example.com']);
    expect(updated.iceX10).toBe(76);
    const tags = await (await call('/api/tags')).json();
    expect(tags).toEqual(expect.arrayContaining([{ name: 'x', count: 0 }, { name: 'y', count: 1 }]));
  });

  it('returns 404 for unknown ideas and deletes with cascade', async () => {
    const idea = await create('a', ['x']);
    expect((await call(`/api/ideas/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await call(`/api/ideas/${idea.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/ideas/${idea.id}`)).status).toBe(404);
    expect(await db.query('SELECT 1 FROM idea_events')).toHaveLength(0);
  });
});

describe('stage transitions', () => {
  it('requires a score before validating, accepting one inline', async () => {
    const idea = await create('a');
    const blocked = await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'validating' } });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).need).toBe('score');

    const moved: Idea = await (await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'validating', ...ice(9, 5, 3) } })).json();
    expect(moved.stage).toBe('validating');
    expect(moved.iceX10).toBe(56);
  });

  it('refuses to clear the score of an idea that needs one', async () => {
    const idea = await create('a');
    await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'building', ...ice(5, 5, 5) } });
    expect((await call(`/api/ideas/${idea.id}`, { method: 'PATCH', body: { ice: null } })).status).toBe(409);
  });

  it('requires a conclusion to drop, then reopens to evaluating only', async () => {
    const idea = await create('a');
    expect((await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'dropped' } })).status).toBe(409);
    const dropped: Idea = await (await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'dropped', conclusion: '有成熟竞品' } })).json();
    expect(dropped.conclusion).toBe('有成熟竞品');

    expect((await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'inbox' } })).status).toBe(409);
    const reopened: Idea = await (await call(`/api/ideas/${idea.id}/stage`, { body: { to: 'evaluating' } })).json();
    expect(reopened.stage).toBe('evaluating');
    expect(reopened.conclusion).toBe('');

    const events: IdeaEvent[] = await (await call(`/api/ideas/${idea.id}/events`)).json();
    expect(events.map((e) => [e.fromStage, e.toStage])).toEqual([
      ['dropped', 'evaluating'],
      ['inbox', 'dropped'],
      [null, 'inbox'],
    ]);
    expect(events[0].note).toContain('有成熟竞品');
  });
});

describe('listing', () => {
  it('filters by stage, all selected tags, scored and search text', async () => {
    const a = await create('中文播客搜索引擎', ['AI', '搜索']);
    const b = await create('播客转文字插件', ['AI']);
    await create('记账小程序', ['工具']);
    await call(`/api/ideas/${a.id}`, { method: 'PATCH', body: ice(9, 5, 3) });
    await call(`/api/ideas/${b.id}/stage`, { body: { to: 'evaluating' } });

    const titles = async (qs: string) => ((await (await call(`/api/ideas?${qs}`)).json()) as IdeaPage).items.map((i) => i.title).sort();
    expect(await titles('tags=AI')).toEqual(['中文播客搜索引擎', '播客转文字插件'].sort());
    expect(await titles('tags=AI,搜索')).toEqual(['中文播客搜索引擎']);
    expect(await titles('scored=1')).toEqual(['中文播客搜索引擎']);
    expect(await titles('stage=evaluating')).toEqual(['播客转文字插件']);
    expect(await titles('q=播客')).toEqual(['中文播客搜索引擎', '播客转文字插件'].sort());
    expect(await titles('q=%25')).toEqual([]); // "%" is matched literally
    expect((await call('/api/ideas?stage=bogus')).status).toBe(400);
  });

  it('sorts by ICE with unscored last and paginates without gaps', async () => {
    const scores: Array<[number, number, number] | null> = [[9, 9, 9], null, [5, 5, 5], [9, 9, 9], null, [1, 1, 1], [7, 8, 8]];
    for (const [i, s] of scores.entries()) {
      const idea = await create(`idea ${i}`);
      if (s) await call(`/api/ideas/${idea.id}`, { method: 'PATCH', body: ice(...s) });
    }
    const seen: Idea[] = [];
    let cursor: string | null = null;
    do {
      const page: IdeaPage = await (await call(`/api/ideas?sort=ice&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json();
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(scores.length);
    expect(new Set(seen.map((i) => i.id)).size).toBe(scores.length);
    expect(seen.map((i) => i.iceX10)).toEqual([90, 90, 76, 50, 10, null, null]);
  });

  it('paginates by creation time in both directions', async () => {
    for (let i = 0; i < 5; i++) await create(`n${i}`);
    const walk = async (sort: string) => {
      const out: string[] = [];
      let cursor: string | null = null;
      do {
        const page: IdeaPage = await (await call(`/api/ideas?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json();
        out.push(...page.items.map((i) => i.title));
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    };
    expect(await walk('created_asc')).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(await walk('created')).toEqual(['n4', 'n3', 'n2', 'n1', 'n0']);
  });

  it('builds the board with per-stage counts', async () => {
    const a = await create('a');
    await create('b');
    await call(`/api/ideas/${a.id}/stage`, { body: { to: 'evaluating' } });
    const board: BoardColumn[] = await (await call('/api/board')).json();
    expect(board.map((c) => [c.stage, c.count])).toEqual([
      ['inbox', 1], ['evaluating', 1], ['validating', 0], ['building', 0], ['shipped', 0], ['dropped', 0],
    ]);
  });

  it('counts inbox ideas older than 14 days as backlog', async () => {
    const old = await create('old');
    await create('new');
    await db.query(`UPDATE ideas SET created_at = now() - interval '15 days' WHERE id = $1`, [old.id]);
    expect(await (await call('/api/stats')).json()).toEqual({ inbox: 2, backlog: 1 });
  });

  it('uses indexes for the list queries', async () => {
    await db.query('SET enable_seqscan = off');
    try {
      const plan = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM ideas i WHERE owner_id = 'me' AND stage = ANY('{inbox}') ORDER BY updated_at DESC, id DESC LIMIT 51`,
      );
      expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/Index/);
      const search = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM ideas i WHERE (i.title || ' ' || i.description) ILIKE '%播客搜索%'`,
      );
      expect(search.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/ideas_search_trgm_idx/);
    } finally {
      await db.query('SET enable_seqscan = on');
    }
  });
});

describe('timeline notes', () => {
  it('adds and deletes notes but never stage history', async () => {
    const idea = await create('a');
    const note: IdeaEvent = await (await call(`/api/ideas/${idea.id}/events`, { body: { note: '访谈了 3 个人' } })).json();
    expect(note.type).toBe('note');
    const [created] = (await (await call(`/api/ideas/${idea.id}/events`)).json() as IdeaEvent[]).filter((e) => e.type === 'created');
    expect((await call(`/api/ideas/${idea.id}/events/${created.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call(`/api/ideas/${idea.id}/events/${note.id}`, { method: 'DELETE' })).status).toBe(204);
  });
});
