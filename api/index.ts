// Vercel Functions entry. vercel.json rewrites /api/* here; the SPA is served from dist/.
import { handle } from 'hono/vercel';
import { createApp } from '../src/server/app';
import { createNeonDb, type Db } from '../src/server/db';

let db: Promise<Db> | undefined;

const app = createApp({
  getDb: () => (db ??= createNeonDb(process.env.DATABASE_URL!)),
  getConfig: () => ({
    passwordHash: process.env.PASSWORD_HASH!,
    sessionSecret: process.env.SESSION_SECRET!,
    secureCookie: true,
  }),
  // Set by Vercel's proxy to the real client address; a client-sent value is not passed through.
  getClientIp: (c) => c.req.header('x-real-ip') ?? 'unknown',
});

const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
