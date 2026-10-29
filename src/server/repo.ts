import type { Db, Statement } from './db.js';
import type { CreateIdeaInput, Idea, IdeaEvent, IdeaPage, ListQuery, BoardColumn, Stats, UpdateIdeaInput } from '../shared/schema.js';
import { BACKLOG_DAYS } from '../shared/schema.js';
import { STAGES, CLOSED_STAGES, checkTransition, type Stage, type TransitionNeed } from '../shared/stage.js';

const BOARD_COLUMN_LIMIT = 50;

const IDEA_COLUMNS = `
  i.id, i.title, i.description, i.stage, i.impact, i.confidence, i.ease, i.ice_x10, i.source, i.links,
  i.conclusion, i.stage_changed_at, i.created_at, i.updated_at,
  COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM idea_tags it JOIN tags t ON t.id = it.tag_id
            WHERE it.idea_id = i.id), '{}') AS tags`;

type Row = Record<string, unknown>;

const iso = (v: unknown) => new Date(v as string).toISOString();

function toIdea(r: Row): Idea {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    stage: r.stage as Stage,
    impact: (r.impact as number | null) ?? null,
    confidence: (r.confidence as number | null) ?? null,
    ease: (r.ease as number | null) ?? null,
    iceX10: (r.ice_x10 as number | null) ?? null,
    source: r.source as string,
    links: (r.links as string[]) ?? [],
    conclusion: r.conclusion as string,
    tags: (r.tags as string[]) ?? [],
    stageChangedAt: iso(r.stage_changed_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toEvent(r: Row): IdeaEvent {
  return {
    id: r.id as string,
    type: r.type as IdeaEvent['type'],
    fromStage: (r.from_stage as Stage | null) ?? null,
    toStage: (r.to_stage as Stage | null) ?? null,
    note: r.note as string,
    createdAt: iso(r.created_at),
  };
}

/** Replaces an idea's tag set: upsert names, unlink the rest, link the given ones. */
function setTagsStatements(owner: string, ideaId: string, tags: string[]): Statement[] {
  return [
    {
      text: `INSERT INTO tags (owner_id, name) SELECT $1, unnest($2::text[]) ON CONFLICT (owner_id, name) DO NOTHING`,
      params: [owner, tags],
    },
    {
      text: `DELETE FROM idea_tags it USING tags t
             WHERE it.idea_id = $1 AND t.id = it.tag_id AND NOT (t.name = ANY($2::text[]))`,
      params: [ideaId, tags],
    },
    {
      text: `INSERT INTO idea_tags (idea_id, tag_id)
             SELECT $1, t.id FROM tags t WHERE t.owner_id = $2 AND t.name = ANY($3::text[])
             ON CONFLICT DO NOTHING`,
      params: [ideaId, owner, tags],
    },
  ];
}

export class TransitionError extends Error {
  constructor(public need: TransitionNeed) {
    super(need);
  }
}

// Cursor = the sort key of the last row plus its id, so pages are stable under inserts.
interface Cursor {
  v: string | number | null;
  id: string;
}
const encodeCursor = (c: Cursor) => btoa(JSON.stringify(c)).replace(/=+$/, '');
function decodeCursor(s: string): Cursor | null {
  try {
    const c = JSON.parse(atob(s));
    if (typeof c?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(c.id)) return null;
    if (!(c.v === null || typeof c.v === 'string' || typeof c.v === 'number')) return null;
    return c;
  } catch {
    return null;
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function createRepo(db: Db) {
  async function getIdea(owner: string, id: string): Promise<Idea | null> {
    const rows = await db.query(`SELECT ${IDEA_COLUMNS} FROM ideas i WHERE i.owner_id = $1 AND i.id = $2`, [owner, id]);
    return rows[0] ? toIdea(rows[0]) : null;
  }

  return {
    getIdea,

    async createIdea(owner: string, input: CreateIdeaInput): Promise<Idea> {
      const id = crypto.randomUUID();
      await db.transaction([
        {
          text: `INSERT INTO ideas (id, owner_id, title, description, source) VALUES ($1, $2, $3, $4, $5)`,
          params: [id, owner, input.title, input.description ?? '', input.source ?? ''],
        },
        ...(input.tags?.length ? setTagsStatements(owner, id, input.tags) : []),
        { text: `INSERT INTO idea_events (idea_id, type, to_stage) VALUES ($1, 'created', 'inbox')`, params: [id] },
      ]);
      return (await getIdea(owner, id))!;
    },

    async updateIdea(owner: string, id: string, input: UpdateIdeaInput): Promise<Idea | null> {
      const current = await getIdea(owner, id);
      if (!current) return null;
      if (input.ice === null && (current.stage === 'validating' || current.stage === 'building')) {
        throw new TransitionError('score');
      }
      const sets: string[] = [];
      const params: unknown[] = [owner, id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.title !== undefined) set('title', input.title);
      if (input.description !== undefined) set('description', input.description);
      if (input.source !== undefined) set('source', input.source);
      if (input.links !== undefined) set('links', JSON.stringify(input.links));
      if (input.ice !== undefined) {
        set('impact', input.ice?.impact ?? null);
        set('confidence', input.ice?.confidence ?? null);
        set('ease', input.ice?.ease ?? null);
      }
      const statements: Statement[] = [
        { text: `UPDATE ideas SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE owner_id = $1 AND id = $2`, params },
      ];
      if (input.tags !== undefined) statements.push(...setTagsStatements(owner, id, input.tags));
      await db.transaction(statements);
      return getIdea(owner, id);
    },

    async deleteIdea(owner: string, id: string): Promise<boolean> {
      const rows = await db.query(`DELETE FROM ideas WHERE owner_id = $1 AND id = $2 RETURNING id`, [owner, id]);
      return rows.length > 0;
    },

    async moveStage(
      owner: string,
      id: string,
      input: { to: Stage; ice?: { impact: number; confidence: number; ease: number }; conclusion?: string },
    ): Promise<Idea | null> {
      const current = await getIdea(owner, id);
      if (!current) return null;
      const reopening = CLOSED_STAGES.has(current.stage);
      const conclusion = CLOSED_STAGES.has(input.to) ? (input.conclusion ?? current.conclusion) : '';
      const check = checkTransition(
        { stage: current.stage, scored: input.ice != null || current.iceX10 != null, conclusion },
        input.to,
      );
      if (!check.ok) throw new TransitionError(check.need);

      const note = CLOSED_STAGES.has(input.to) ? conclusion : reopening ? `重新打开（原结论：${current.conclusion}）` : '';
      const [updated] = await db.transaction([
        {
          // Guarded by the stage we validated against, so a concurrent move cannot slip past the rules.
          text: `UPDATE ideas SET stage = $3, conclusion = $4, stage_changed_at = now(), updated_at = now(),
                   impact = COALESCE($5, impact), confidence = COALESCE($6, confidence), ease = COALESCE($7, ease)
                 WHERE owner_id = $1 AND id = $2 AND stage = $8 RETURNING id`,
          params: [owner, id, input.to, conclusion, input.ice?.impact ?? null, input.ice?.confidence ?? null,
            input.ice?.ease ?? null, current.stage],
        },
        {
          text: `INSERT INTO idea_events (idea_id, type, from_stage, to_stage, note)
                 SELECT $1, 'stage', $2, $3, $4 WHERE EXISTS (SELECT 1 FROM ideas WHERE id = $1 AND stage = $3)`,
          params: [id, current.stage, input.to, note],
        },
      ]);
      if (updated.length === 0) throw new TransitionError('same');
      return getIdea(owner, id);
    },

    async listIdeas(owner: string, q: ListQuery): Promise<IdeaPage> {
      const where = ['i.owner_id = $1'];
      const params: unknown[] = [owner];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.stage.length) where.push(`i.stage = ANY(${p(q.stage)}::text[])`);
      if (q.scored) where.push('i.ice_x10 IS NOT NULL');
      if (q.q) where.push(`(i.title || ' ' || i.description) ILIKE ${p(`%${escapeLike(q.q)}%`)}`);
      if (q.tags.length) {
        // All selected tags must be present.
        where.push(`i.id IN (SELECT it.idea_id FROM idea_tags it JOIN tags t ON t.id = it.tag_id
                    WHERE t.owner_id = $1 AND t.name = ANY(${p(q.tags)}::text[])
                    GROUP BY it.idea_id HAVING count(*) = ${p(q.tags.length)})`);
      }

      const sortCol = { updated: 'i.updated_at', created: 'i.created_at', created_asc: 'i.created_at', ice: 'i.ice_x10' }[q.sort];
      const asc = q.sort === 'created_asc';
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      if (cursor) {
        if (q.sort === 'ice') {
          where.push(
            cursor.v === null
              ? `(i.ice_x10 IS NULL AND i.id < ${p(cursor.id)}::uuid)`
              : `(i.ice_x10 < ${p(cursor.v)} OR (i.ice_x10 = $${params.length} AND i.id < ${p(cursor.id)}::uuid) OR i.ice_x10 IS NULL)`,
          );
        } else {
          where.push(`(${sortCol}, i.id) ${asc ? '>' : '<'} (${p(cursor.v)}::timestamptz, ${p(cursor.id)}::uuid)`);
        }
      }
      const order =
        q.sort === 'ice' ? 'i.ice_x10 DESC NULLS LAST, i.id DESC' : `${sortCol} ${asc ? 'ASC' : 'DESC'}, i.id ${asc ? 'ASC' : 'DESC'}`;

      const rows = await db.query(
        `SELECT ${IDEA_COLUMNS} FROM ideas i WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${p(q.limit + 1)}`,
        params,
      );
      const items = rows.slice(0, q.limit).map(toIdea);
      const last = items.at(-1);
      const nextCursor =
        rows.length > q.limit && last
          ? encodeCursor({
              id: last.id,
              v: q.sort === 'ice' ? last.iceX10 : q.sort === 'updated' ? last.updatedAt : last.createdAt,
            })
          : null;
      return { items, nextCursor };
    },

    async board(owner: string, filter: { tags: string[]; scored: boolean }): Promise<BoardColumn[]> {
      const params: unknown[] = [owner, BOARD_COLUMN_LIMIT];
      const where = ['i.owner_id = $1'];
      if (filter.scored) where.push('i.ice_x10 IS NOT NULL');
      if (filter.tags.length) {
        params.push(filter.tags, filter.tags.length);
        where.push(`i.id IN (SELECT it.idea_id FROM idea_tags it JOIN tags t ON t.id = it.tag_id
                    WHERE t.owner_id = $1 AND t.name = ANY($3::text[]) GROUP BY it.idea_id HAVING count(*) = $4)`);
      }
      const rows = await db.query(
        `SELECT ${IDEA_COLUMNS}, ranked.cnt FROM (
           SELECT i.id, count(*) OVER (PARTITION BY i.stage)::int AS cnt,
                  row_number() OVER (PARTITION BY i.stage ORDER BY i.updated_at DESC, i.id DESC) AS rn
           FROM ideas i WHERE ${where.join(' AND ')}
         ) ranked JOIN ideas i ON i.id = ranked.id
         WHERE ranked.rn <= $2
         ORDER BY i.updated_at DESC, i.id DESC`,
        params,
      );
      const columns = new Map<Stage, BoardColumn>(STAGES.map((s) => [s, { stage: s, count: 0, items: [] }]));
      for (const r of rows) {
        const col = columns.get(r.stage as Stage)!;
        col.count = r.cnt as number;
        col.items.push(toIdea(r));
      }
      return [...columns.values()];
    },

    async stats(owner: string): Promise<Stats> {
      const [r] = await db.query<{ inbox: number; backlog: number }>(
        `SELECT count(*)::int AS inbox,
                (count(*) FILTER (WHERE created_at < now() - make_interval(days => $2)))::int AS backlog
         FROM ideas WHERE owner_id = $1 AND stage = 'inbox'`,
        [owner, BACKLOG_DAYS],
      );
      return r;
    },

    async listTags(owner: string): Promise<{ name: string; count: number }[]> {
      return db.query(
        `SELECT t.name, count(it.idea_id)::int AS count FROM tags t
         LEFT JOIN idea_tags it ON it.tag_id = t.id
         WHERE t.owner_id = $1 GROUP BY t.name ORDER BY count DESC, t.name`,
        [owner],
      );
    },

    async listEvents(owner: string, ideaId: string): Promise<IdeaEvent[] | null> {
      if (!(await getIdea(owner, ideaId))) return null;
      const rows = await db.query(
        `SELECT id, type, from_stage, to_stage, note, created_at FROM idea_events
         WHERE idea_id = $1 ORDER BY created_at DESC, id DESC`,
        [ideaId],
      );
      return rows.map(toEvent);
    },

    async addNote(owner: string, ideaId: string, note: string): Promise<IdeaEvent | null> {
      const rows = await db.query(
        `INSERT INTO idea_events (idea_id, type, note)
         SELECT id, 'note', $3 FROM ideas WHERE owner_id = $1 AND id = $2
         RETURNING id, type, from_stage, to_stage, note, created_at`,
        [owner, ideaId, note],
      );
      return rows[0] ? toEvent(rows[0]) : null;
    },

    async deleteNote(owner: string, ideaId: string, eventId: string): Promise<boolean> {
      // Only free-text notes can be removed; stage history stays.
      const rows = await db.query(
        `DELETE FROM idea_events e USING ideas i
         WHERE e.id = $3 AND e.idea_id = $2 AND e.type = 'note' AND i.id = e.idea_id AND i.owner_id = $1
         RETURNING e.id`,
        [owner, ideaId, eventId],
      );
      return rows.length > 0;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
