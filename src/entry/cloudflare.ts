// Cloudflare Workers entry. Static assets are served by Workers Assets; only /api/* reaches this code.
import { createApp } from '../server/app';
import { createNeonDb, type Db } from '../server/db';

interface Env {
  DATABASE_URL: string;
  PASSWORD_HASH: string;
  SESSION_SECRET: string;
}

let db: Promise<Db> | undefined;

const app = createApp({
  getDb: (c) => (db ??= createNeonDb((c.env as Env).DATABASE_URL)),
  getConfig: (c) => {
    const env = c.env as Env;
    return { passwordHash: env.PASSWORD_HASH, sessionSecret: env.SESSION_SECRET, secureCookie: true };
  },
});

export default { fetch: app.fetch };
