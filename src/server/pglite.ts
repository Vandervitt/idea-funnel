// Local development and tests only — never imported by a production entry.
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import type { Db } from './db.js';

const MIGRATIONS_DIR = new URL('../../prisma/migrations/', import.meta.url);

/** Applies prisma/migrations in order, once each (the dev database persists across restarts). */
async function migrate(pg: PGlite) {
  await pg.exec(`CREATE TABLE IF NOT EXISTS _local_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await pg.query<{ name: string }>('SELECT name FROM _local_migrations')).rows.map((r) => r.name));
  const names = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await readFile(new URL(`${name}/migration.sql`, MIGRATIONS_DIR), 'utf8');
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO _local_migrations (name) VALUES ($1)', [name]);
    });
  }
}

export async function createPgliteDb(dataDir?: string): Promise<Db & { close(): Promise<void> }> {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const pg = await PGlite.create({ dataDir, extensions: { pg_trgm } });
  await migrate(pg);
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows as never,
    transaction: (statements) =>
      pg.transaction(async (tx) => {
        const out: Record<string, unknown>[][] = [];
        for (const s of statements) out.push((await tx.query<Record<string, unknown>>(s.text, s.params ?? [])).rows);
        return out;
      }),
    close: () => pg.close(),
  };
}
