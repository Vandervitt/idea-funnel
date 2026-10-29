export interface Statement {
  text: string;
  params?: unknown[];
}

/** Minimal driver surface so the app runs on Neon (HTTP) in production and PGlite locally. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs all statements in one transaction; returns each statement's rows. */
  transaction(statements: Statement[]): Promise<Record<string, unknown>[][]>;
}

export async function createNeonDb(url: string): Promise<Db> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return {
    query: async <T,>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
    transaction: async (statements) =>
      (await sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? [])))) as Record<string, unknown>[][],
  };
}
