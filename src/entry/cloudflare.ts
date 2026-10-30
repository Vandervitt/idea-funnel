// Cloudflare Workers entry. Static assets are served by Workers Assets; only /api/* reaches this code.
import { createApp } from '../server/app.js';
import { createNeonDb, type Db } from '../server/db.js';

interface Env {
  DATABASE_URL: string;
}

let db: Promise<Db> | undefined;

const app = createApp({
  getDb: (c) => (db ??= createNeonDb((c.env as Env).DATABASE_URL)),
  getConfig: () => ({ secureCookie: true }),
  // Set by Cloudflare's edge on every request; a client-sent value is overwritten.
  getClientIp: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
});

export default { fetch: app.fetch };
