// Local development server: API on :8787, Vite proxies /api here.
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createNeonDb, type Db } from '../server/db.js';
import { createPgliteDb } from '../server/pglite.js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const DEV_PASSWORD = 'idea-funnel';
const port = Number(process.env.API_PORT ?? 8787);

let passwordHash = process.env.PASSWORD_HASH;
if (!passwordHash) {
  passwordHash = await hashPassword(DEV_PASSWORD);
  console.warn(`[dev] PASSWORD_HASH 未设置，本地开发密码为 "${DEV_PASSWORD}"`);
}

const db: Db = process.env.DATABASE_URL
  ? await createNeonDb(process.env.DATABASE_URL)
  : await createPgliteDb(process.env.PGLITE_DIR ?? '.data/pglite');

const app = createApp({
  getDb: async () => db,
  getConfig: () => ({ passwordHash, secureCookie: false }),
  // Socket address (through the Vite proxy this is localhost — fine for local dev).
  getClientIp: (c) => getConnInfo(c).remote.address ?? 'unknown',
});

serve({ fetch: app.fetch, port }, () => console.log(`[api] http://localhost:${port}`));
