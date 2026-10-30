// Local development server: API on :8787, Vite proxies /api here.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from '../server/app.js';
import { createNeonDb, type Db } from '../server/db.js';
import { createPgliteDb } from '../server/pglite.js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const port = Number(process.env.API_PORT ?? 8787);

const db: Db = process.env.DATABASE_URL
  ? await createNeonDb(process.env.DATABASE_URL)
  : await createPgliteDb(process.env.PGLITE_DIR ?? '.data/pglite');

// Seed only the local embedded database. Remote databases require manual SQL initialization.
if (!process.env.DATABASE_URL) {
  await db.query(await readFile(new URL('../../prisma/init.sql', import.meta.url), 'utf8'));
}

const app = createApp({
  getDb: async () => db,
  getConfig: () => ({ secureCookie: false }),
  // Socket address (through the Vite proxy this is localhost — fine for local dev).
  getClientIp: (c) => getConnInfo(c).remote.address ?? 'unknown',
});

serve({ fetch: app.fetch, port }, () => console.log(`[api] http://localhost:${port}`));
