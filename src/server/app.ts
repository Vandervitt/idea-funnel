import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Db } from './db.js';
import { createRepo, TransitionError } from './repo.js';
import {
  createLoginLimiter,
  signSession,
  verifyPassword,
  verifySession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from './auth.js';
import { createIdeaInput, listQuery, noteInput, stageInput, updateIdeaInput } from '../shared/schema.js';

export interface AppConfig {
  passwordHash: string;
  sessionSecret: string;
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

// Single-user product: every row belongs to this owner. Kept as a column for a future multi-user version.
const OWNER = 'me';

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
  const app = new Hono().basePath('/api');

  app.use(secureHeaders());
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

  app.post('/auth/login', validate('json', z.object({ password: z.string().min(1).max(200), remember: z.boolean().optional() })), async (c) => {
    const db = await deps.getDb(c);
    const cfg = deps.getConfig(c);
    const limiter = createLoginLimiter(db);
    const ip = deps.getClientIp(c);
    if (await limiter.isLocked(ip)) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);

    const { password, remember } = c.req.valid('json');
    if (!(await verifyPassword(password, cfg.passwordHash))) {
      const left = await limiter.recordFailure(ip);
      if (left === 0) return c.json({ error: 'locked', message: '尝试次数过多，请 15 分钟后再试' }, 429);
      return c.json({ error: 'wrong_password', attemptsLeft: left }, 401);
    }
    await limiter.reset(ip);
    setCookie(c, SESSION_COOKIE, await signSession(cfg.sessionSecret), {
      httpOnly: true,
      secure: cfg.secureCookie,
      sameSite: 'Lax',
      path: '/',
      ...(remember === false ? {} : { maxAge: SESSION_TTL_SECONDS }),
    });
    return c.json({ ok: true });
  });

  app.post('/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.getConfig(c).secureCookie });
    return c.json({ ok: true });
  });

  // Everything below requires a valid session.
  app.use('*', async (c, next) => {
    if (c.req.path === '/api/health' || c.req.path === '/api/auth/login' || c.req.path === '/api/auth/logout') return next();
    const ok = await verifySession(deps.getConfig(c).sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!ok) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  const repo = async (c: Context) => createRepo(await deps.getDb(c));

  app.get('/me', (c) => c.json({ ok: true }));

  app.get('/ideas', validate('query', listQuery), async (c) => c.json(await (await repo(c)).listIdeas(OWNER, c.req.valid('query'))));

  app.get(
    '/board',
    validate('query', listQuery.pick({ tags: true, scored: true })),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(await (await repo(c)).board(OWNER, { tags: q.tags, scored: q.scored === '1' }));
    },
  );

  app.get('/stats', async (c) => c.json(await (await repo(c)).stats(OWNER)));
  app.get('/tags', async (c) => c.json(await (await repo(c)).listTags(OWNER)));

  app.post('/ideas', validate('json', createIdeaInput), async (c) =>
    c.json(await (await repo(c)).createIdea(OWNER, c.req.valid('json')), 201),
  );

  app.get('/ideas/:id', validate('param', uuidParam), async (c) => {
    const idea = await (await repo(c)).getIdea(OWNER, c.req.valid('param').id);
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.patch('/ideas/:id', validate('param', uuidParam), validate('json', updateIdeaInput), async (c) => {
    const idea = await (await repo(c)).updateIdea(OWNER, c.req.valid('param').id, c.req.valid('json'));
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.delete('/ideas/:id', validate('param', uuidParam), async (c) =>
    (await (await repo(c)).deleteIdea(OWNER, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
  );

  app.post('/ideas/:id/stage', validate('param', uuidParam), validate('json', stageInput), async (c) => {
    const idea = await (await repo(c)).moveStage(OWNER, c.req.valid('param').id, c.req.valid('json'));
    return idea ? c.json(idea) : c.json({ error: 'not_found' }, 404);
  });

  app.get('/ideas/:id/events', validate('param', uuidParam), async (c) => {
    const events = await (await repo(c)).listEvents(OWNER, c.req.valid('param').id);
    return events ? c.json(events) : c.json({ error: 'not_found' }, 404);
  });

  app.post('/ideas/:id/events', validate('param', uuidParam), validate('json', noteInput), async (c) => {
    const event = await (await repo(c)).addNote(OWNER, c.req.valid('param').id, c.req.valid('json').note);
    return event ? c.json(event, 201) : c.json({ error: 'not_found' }, 404);
  });

  app.delete(
    '/ideas/:id/events/:eventId',
    validate('param', z.object({ id: z.uuid(), eventId: z.uuid() })),
    async (c) => {
      const { id, eventId } = c.req.valid('param');
      return (await (await repo(c)).deleteNote(OWNER, id, eventId)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
    },
  );

  app.all('*', (c) => c.json({ error: 'not_found' }, 404));

  return app;
}
