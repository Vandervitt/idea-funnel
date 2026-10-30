import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { createPgliteDb } from './pglite.js';
import { createRepo } from './repo.js';

let db: Awaited<ReturnType<typeof createPgliteDb>>;
const ideaId = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => { db = await createPgliteDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE users CASCADE');
  await db.query(`INSERT INTO users (id, username, password_hash) VALUES ('alice', 'alice', 'test'), ('bob', 'bob', 'test')`);
  await db.query(`INSERT INTO ideas (id, owner_id, title) VALUES ($1, 'alice', 'Original')`, [ideaId]);
});

// An import can reuse a deleted UUID. Schedule that replacement exactly after the initial
// ownership read so the regression is deterministic rather than dependent on timing.
function replacingDb(stage = 'inbox'): Db {
  let replaced = false;
  return {
    query: async <T,>(text: string, params?: unknown[]): Promise<T[]> => {
      const rows = await db.query<T>(text, params);
      if (!replaced && text.includes('FROM ideas i WHERE i.owner_id = $1 AND i.id = $2')) {
        replaced = true;
        await db.transaction([
          { text: 'DELETE FROM ideas WHERE id = $1', params: [ideaId] },
          { text: `INSERT INTO ideas (id, owner_id, title, stage) VALUES ($1, 'bob', 'Private replacement', $2)`, params: [ideaId, stage] },
          { text: `INSERT INTO tags (id, owner_id, name) VALUES ('00000000-0000-4000-8000-000000000002', 'bob', 'private')` },
          { text: `INSERT INTO idea_tags (idea_id, tag_id) VALUES ($1, '00000000-0000-4000-8000-000000000002')`, params: [ideaId] },
          { text: `INSERT INTO idea_events (idea_id, type, note) VALUES ($1, 'note', 'Bob private note')`, params: [ideaId] },
        ]);
      }
      return rows;
    },
    transaction: (statements) => db.transaction(statements),
  };
}

describe('ownership remains enforced after a concurrent UUID replacement', () => {
  it('does not change another owner’s tags or score history after a stale edit', async () => {
    await createRepo(replacingDb()).updateIdea('alice', ideaId, { tags: ['injected'], ice: { impact: 5, confidence: 6, ease: 7 } });
    expect((await createRepo(db).getIdea('bob', ideaId))?.tags).toEqual(['private']);
    expect((await createRepo(db).listEvents('bob', ideaId))?.map((event) => event.note)).toEqual(['Bob private note']);
  });

  it('does not write another owner’s stage or score history after a stale transition', async () => {
    await expect(createRepo(replacingDb('evaluating')).moveStage('alice', ideaId, {
      to: 'evaluating', ice: { impact: 5, confidence: 6, ease: 7 },
    })).rejects.toThrow('same');
    expect((await createRepo(db).listEvents('bob', ideaId))?.map((event) => event.note)).toEqual(['Bob private note']);
  });

  it('never returns another owner’s events after an ownership read', async () => {
    const events = await createRepo(replacingDb()).listEvents('alice', ideaId);
    expect(events?.some((event) => event.note === 'Bob private note') ?? false).toBe(false);
  });
});
