// Local development and tests only — never imported by a production entry.
import { mkdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import type { Db } from './db.js';

const MIGRATIONS = ['20261029_init.sql'];

export async function createPgliteDb(dataDir?: string): Promise<Db & { close(): Promise<void> }> {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const pg = await PGlite.create({ dataDir, extensions: { pg_trgm } });
  for (const file of MIGRATIONS) {
    await pg.exec(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
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
