import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Db } from './db.js';
import { createRepo, TransitionError } from './repo.js';
import { createAccounts, type Account } from './accounts.js';
import {
  createLoginLimiter,
  hashPassword,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from './auth.js';
import {
  createIdeaInput, exportQuery, importFile, importLinesInput, insightsQuery, listQuery, noteInput, renameTagInput, stageInput, tagName,
  updateIdeaInput,
  EXPORT_VERSION, type ExportFile, type ExportIdea,
} from '../shared/schema.js';
import { toMarkdown } from '../shared/export.js';

export interface AppConfig {
  passwordHash: string;
  /** false only for plain-http local development. */
  secureCookie: boolean;
}

export interface AppDeps {
  /** Resolved per request so platform bindings (env) can be read lazily. */
  getDb(c: Context): Promise<Db>;
  getConfig(c: Context): AppConfig;
  /**
   * Client IP for login rate limiting. Each platform entry must read only the source its
   * proxy guarantees (never a header the client can set), or the lockout can be bypassed.
   */
  getClientIp(c: Context): string;
}

type AppEnv = { Variables: { user: Account } };
const usernameInput = z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9_-]+$/);
const newPasswordInput = z.string().min(10).max(200);
const owner = (c: Context<AppEnv>) => c.get('user').id;
// Equal-cost verification for unknown accounts without revealing whether a username exists.
let dummyHash: Promise<string> | undefined;

const uuidParam = z.object({ id: z.uuid() });

// Turns zod failures into a uniform 400 instead of the validator's default payload.
const validate = <T extends z.ZodType>(target: 'json' | 'query' | 'param', schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid_input', issues: result.error.issues }, 400);
  });

const TRANSITION_MESSAGES = {
  score: '进入这个阶段前需要先打 ICE 分',
  conclusion: '进入这个阶段需要填写结论',
  reopen: '已结束的想法只能重新打开到「评估中」',
  same: '想法已经在这个阶段了，或者刚被其他操作改动过',
};

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(secureHeaders());
  app.use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next(); });
  // Rejects cross-origin form-style posts; JSON bodies additionally require a CORS preflight we never grant.
  app.use(csrf());
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof TransitionError) {
      return c.json({ error: 'transition_blocked', need: err.need, message: TRANSITION_MESSAGES[err.need] }, 409);
    }
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/auth/login', validate('json', z.object({ username: usernameInput, password: z.string().min(1).max(200), remember: z.boolean().optional() }).strict()), async (c) => {
    const db = await deps.getDb(c);
    const cfg = deps.getConfig(c);
    const limiter = createLoginLimiter(db);
    const ip = deps.getClientIp(c);
    const { username, password, remember } = c.req.valid('json');
    if (await limiter.isLocked(ip, username)) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);

    const accounts = createAccounts(db);
    if (username === 'admin') await accounts.initializeAdmin(cfg.passwordHash);
    const user = await accounts.credentials(username);
    const stored = user?.password_hash ?? await (dummyHash ??= hashPassword(crypto.randomUUID()));
    const valid = await verifyPassword(password, stored);
    if (!user || !valid) {
      const left = await limiter.recordFailure(ip, username);
      if (left === 0) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);
      return c.json({ error: 'wrong_password', attemptsLeft: left }, 401);
    }
    const token = await accounts.openSession(user);
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    await limiter.reset(username);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cfg.secureCookie,
      sameSite: 'Lax',
      path: '/',
      ...(remember === false ? {} : { maxAge: SESSION_TTL_SECONDS }),
    });
    return c.json({ ok: true });
  });

  app.post('/auth/logout', async (c) => {
    await createAccounts(await deps.getDb(c)).closeSession(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.getConfig(c).secureCookie });
    return c.json({ ok: true });
  });

  // Everything below requires a valid session.
  app.use('*', async (c, next) => {
    if (c.req.path === '/api/health' || c.req.path === '/api/auth/login' || c.req.path === '/api/auth/logout') return next();
    const user = await createAccounts(await deps.getDb(c)).authenticate(getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  });

  const repo = async (c: Context) => createRepo(await deps.getDb(c));

  app.get('/me', (c) => c.json(c.get('user')));

  app.post('/auth/password', validate('json', z.object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordInput }).strict()), async (c) => {
    const db = await deps.getDb(c);
    const accounts = createAccounts(db);
    const limiter = createLoginLimiter(db, 'password');
    const ip = deps.getClientIp(c);
    const username = c.get('user').username;
    if (await limiter.isLocked(ip, username)) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);
    const user = await accounts.credentials(username);
    const { currentPassword, newPassword } = c.req.valid('json');
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      if (await limiter.recordFailure(ip, username) === 0) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);
      return c.json({ error: 'wrong_password', message: '原密码不正确' }, 401);
    }
    if (!(await accounts.changePassword(user, await hashPassword(newPassword)))) return c.json({ error: 'unauthorized' }, 401);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.getConfig(c).secureCookie });
    return c.json({ ok: true });
  });

  app.use('/admin/*', async (c, next) => {
    if (c.get('user').role !== 'admin') return c.json({ error: 'forbidden', message: '仅管理员可管理账号' }, 403);
    await next();
  });
  app.get('/admin/users', validate('query', z.object({ cursor: usernameInput.optional() })), async (c) =>
    c.json(await createAccounts(await deps.getDb(c)).list(c.req.valid('query').cursor)));
  app.post('/admin/users', validate('json', z.object({ username: usernameInput, password: newPasswordInput }).strict()), async (c) => {
    const { username, password } = c.req.valid('json');
    const user = await createAccounts(await deps.getDb(c)).create(username, await hashPassword(password));
    return user ? c.json(user, 201) : c.json({ error: 'username_taken', message: '用户名已存在' }, 409);
  });

  app.get('/ideas', validate('query', listQuery), async (c) => c.json(await (await repo(c)).listIdeas(owner(c), c.req.valid('query'))));

  app.get(
    '/board',
    validate('query', listQuery.pick({ tags: true, scored: true })),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await (await repo(c)).board(owner(c), { tags: q.tags, scored: q.scored === '1' }));
    },
  );

  app.get('/stats', async (c) => c.json(await (await repo(c)).stats(owner(c))));
  app.get('/tags', async (c) => c.json(await (await repo(c)).listTags(owner(c))));
  const tagParam = z.object({ name: tagName });
  app.patch('/tags/:name', validate('param', tagParam), validate('json', renameTagInput), async (c) =>
    (await (await repo(c)).renameTag(owner(c), c.req.valid('param').name, c.req.valid('json').name))
      ? c.json({ ok: true })
      : c.json({ error: 'not_found' }, 404),
  );
  app.delete('/tags/:name', validate('param', tagParam), async (c) =>
    (await (await repo(c)).deleteTag(owner(c), c.req.valid('param').name)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
  );
  app.get('/insights', validate('query', insightsQuery), async (c) =>
    c.json(await (await repo(c)).insights(owner(c), c.req.valid('query').tz)),
  );

  app.get('/export', validate('query', exportQuery), async (c) => {
    const { format } = c.req.valid('query');
    const exportedAt = new Date().toISOString();
    const ideas = await (await repo(c)).exportIdeas(owner(c));
    const filename = `idea-funnel-${exportedAt.slice(0, 10).replaceAll('-', '')}.${format}`;
    c.header('content-disposition', `attachment; filename="${filename}"`);
    c.header('cache-control', 'no-store');
    if (format === 'md') {
      c.header('content-type', 'text/markdown; charset=utf-8');
      return c.body(toMarkdown(ideas, exportedAt));
    }
    return c.json({ app: 'idea-funnel', version: EXPORT_VERSION, exportedAt, ideas } satisfies ExportFile);
  });

  // Vercel caps request bodies at 4.5 MB; reject earlier with a clear error.
  const importLimit = bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: 'too_large', message: '文件太大（上限 4 MB）' }, 413) });

  app.post('/import/json', importLimit, validate('json', importFile), async (c) =>
    c.json(await (await repo(c)).importIdeas(owner(c), c.req.valid('json').ideas)),
  );

  app.post('/import/lines', importLimit, validate('json', importLinesInput), async (c) => {
    // Consecutive milliseconds keep the pasted order under "oldest first".
    const start = Date.now();
    const ideas = c.req.valid('json').items.map((item, i): ExportIdea => {
      const at = new Date(start + i).toISOString();
      return {
        id: crypto.randomUUID(), title: item.title, description: '', stage: 'inbox', impact: null, confidence: null, ease: null,
        source: '', links: [], conclusion: '', hypothesis: '', successCriteria: '', tags: item.tags, stageChangedAt: at, createdAt: at, updatedAt: at, events: [],
      };
    });
    return c.json(await (await repo(c)).importIdeas(owner(c), ideas));
  });

  app.post('/ideas', validate('json', createIdeaInput), async (c) =>
    c.json(await (await repo(c)).createIdea(owner(c), c.req.valid('json')), 201),
  );

  app.get('/ideas/:id', validate('param', uuidParam), async (c) => {
    const idea = await (await repo(c)).getIdea(owner(c), c.req.valid('param').id);
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.patch('/ideas/:id', validate('param', uuidParam), validate('json', updateIdeaInput), async (c) => {
    const idea = await (await repo(c)).updateIdea(owner(c), c.req.valid('param').id, c.req.valid('json'));
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.delete('/ideas/:id', validate('param', uuidParam), async (c) =>
    (await (await repo(c)).deleteIdea(owner(c), c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
  );

  app.post('/ideas/:id/stage', validate('param', uuidParam), validate('json', stageInput), async (c) => {
    const idea = await (await repo(c)).moveStage(owner(c), c.req.valid('param').id, c.req.valid('json'));
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.get('/ideas/:id/events', validate('param', uuidParam), async (c) => {
    const events = await (await repo(c)).listEvents(owner(c), c.req.valid('param').id);
    return events ? c.json(events) : c.json({ error: 'not_found' }, 404);
  });

  app.post('/ideas/:id/events', validate('param', uuidParam), validate('json', noteInput), async (c) => {
    const event = await (await repo(c)).addNote(owner(c), c.req.valid('param').id, c.req.valid('json').note);
    return event ? c.json(event, 201) : c.json({ error: 'not_found' }, 404);
  });

  app.delete(
    '/ideas/:id/events/:eventId',
    validate('param', z.object({ id: z.uuid(), eventId: z.uuid() })),
    async (c) => {
      const { id, eventId } = c.req.valid('param');
      return (await (await repo(c)).deleteNote(owner(c), id, eventId)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
    },
  );

  app.all('*', (c) => c.json({ error: 'not_found' }, 404));

  return app;
}
