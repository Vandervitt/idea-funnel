import type { Db, Statement } from './db.js';
import type {
  CreateIdeaInput, ExportIdea, Idea, IdeaEvent, IdeaPage, ImportResult, Insights, ListQuery, BoardColumn, Stats, UpdateIdeaInput,
} from '../shared/schema.js';
import { BACKLOG_DAYS, STALL_DAYS } from '../shared/schema.js';
import { formatIce, iceScoreX10, truncateRate } from '../shared/ice.js';
import { STAGES, CLOSED_STAGES, SCORED_STAGES, checkTransition, type Stage, type TransitionNeed } from '../shared/stage.js';
import { FUNNEL_PATH, funnelSteps, type FunnelStage } from '../shared/insights.js';

const BOARD_COLUMN_LIMIT = 50;
/** Score edits this close to the previous score entry (with nothing in between) update that entry instead of adding one. */
const SCORE_MERGE_MINUTES = 10;

const IDEA_COLUMNS = `
  i.id, i.title, i.description, i.stage, i.impact, i.confidence, i.ease, i.ice_x10, i.source, i.links,
  i.conclusion, i.hypothesis, i.success_criteria, i.stage_changed_at, i.created_at, i.updated_at,
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
    hypothesis: r.hypothesis as string,
    successCriteria: r.success_criteria as string,
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

type Ice = { impact: number; confidence: number; ease: number };

const sameIce = (idea: Idea, ice: Ice | null) =>
  ice ? idea.impact === ice.impact && idea.confidence === ice.confidence && idea.ease === ice.ease : idea.iceX10 == null;

const iceNote = (ice: Ice | null) =>
  ice ? `${formatIce(iceScoreX10(ice.impact, ice.confidence, ice.ease))}（I ${ice.impact} / C ${ice.confidence} / E ${ice.ease}）` : '清除评分';

/**
 * Timeline entry for a score change, merged into the latest entry when that is a recent score entry.
 * `ifStage`: only write it when the idea is (now) in that stage — for moves guarded against concurrent changes.
 */
function scoreEventStatement(ideaId: string, ice: Ice | null, ifStage?: Stage): Statement {
  const guard = 'AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM ideas WHERE id = $1 AND stage = $4))';
  return {
    text: `WITH latest AS (
             SELECT id, type, created_at FROM idea_events WHERE idea_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1
           ),
           merged AS (
             UPDATE idea_events e SET note = $2, created_at = now() FROM latest l
             WHERE e.id = l.id AND l.type = 'score' AND l.created_at > now() - make_interval(mins => $3) ${guard}
             RETURNING e.id
           )
           INSERT INTO idea_events (idea_id, type, note)
           SELECT $1, 'score', $2 WHERE NOT EXISTS (SELECT 1 FROM merged) ${guard}`,
    params: [ideaId, iceNote(ice), SCORE_MERGE_MINUTES, ifStage ?? null],
  };
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

  async function stats(owner: string): Promise<Stats> {
    const [r] = await db.query<{ inbox: number; backlog: number } & Stats['stalled']>(
      `SELECT count(*) FILTER (WHERE stage = 'inbox')::int AS inbox,
              count(*) FILTER (WHERE stage = 'inbox' AND created_at < now() - make_interval(days => $2))::int AS backlog,
              count(*) FILTER (WHERE stage = 'evaluating' AND updated_at < now() - make_interval(days => $3))::int AS evaluating,
              count(*) FILTER (WHERE stage = 'validating' AND updated_at < now() - make_interval(days => $4))::int AS validating,
              count(*) FILTER (WHERE stage = 'building' AND updated_at < now() - make_interval(days => $5))::int AS building
       FROM ideas WHERE owner_id = $1 AND stage IN ('inbox', 'evaluating', 'validating', 'building')`,
      [owner, BACKLOG_DAYS, STALL_DAYS.evaluating, STALL_DAYS.validating, STALL_DAYS.building],
    );
    return {
      inbox: r.inbox,
      backlog: r.backlog,
      stalled: { evaluating: r.evaluating, validating: r.validating, building: r.building },
    };
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
      if (input.ice === null && SCORED_STAGES.has(current.stage)) {
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
      if (input.hypothesis !== undefined) set('hypothesis', input.hypothesis);
      if (input.successCriteria !== undefined) set('success_criteria', input.successCriteria);
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
      if (input.ice !== undefined && !sameIce(current, input.ice)) statements.push(scoreEventStatement(id, input.ice));
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
      input: { to: Stage; ice?: Ice; conclusion?: string; plan?: { hypothesis: string; successCriteria: string } },
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
                   impact = COALESCE($5, impact), confidence = COALESCE($6, confidence), ease = COALESCE($7, ease),
                   hypothesis = COALESCE($9, hypothesis), success_criteria = COALESCE($10, success_criteria)
                 WHERE owner_id = $1 AND id = $2 AND stage = $8 RETURNING id`,
          params: [owner, id, input.to, conclusion, input.ice?.impact ?? null, input.ice?.confidence ?? null,
            input.ice?.ease ?? null, current.stage, input.plan?.hypothesis ?? null, input.plan?.successCriteria ?? null],
        },
        // Before the stage entry, so the move is the latest entry; skipped if the guarded update above did not happen.
        ...(input.ice && !sameIce(current, input.ice) ? [scoreEventStatement(id, input.ice, input.to)] : []),
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

      const sortCol = {
        updated: 'i.updated_at', updated_asc: 'i.updated_at', created: 'i.created_at', created_asc: 'i.created_at', ice: 'i.ice_x10',
      }[q.sort];
      const asc = q.sort.endsWith('_asc');
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
              v: q.sort === 'ice' ? last.iceX10 : sortCol === 'i.updated_at' ? last.updatedAt : last.createdAt,
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

    stats,

    async insights(owner: string, tz: string): Promise<Insights> {
      const [stageRows, furthestRows, weeks, [skipped], [m], current] = await Promise.all([
        db.query<{ stage: Stage; count: number }>(
          `SELECT stage, count(*)::int AS count FROM ideas WHERE owner_id = $1 GROUP BY stage`,
          [owner],
        ),
        // Furthest step on the main path each idea ever reached: its current stage or any stage it moved to.
        db.query<{ stage: FunnelStage; count: number }>(
          `SELECT ($2::text[])[pos] AS stage, count(*)::int AS count FROM (
             SELECT GREATEST(1, COALESCE(array_position($2::text[], i.stage), 0),
                               COALESCE(max(array_position($2::text[], e.to_stage)), 0)) AS pos
             FROM ideas i LEFT JOIN idea_events e ON e.idea_id = i.id AND e.type = 'stage'
             WHERE i.owner_id = $1 GROUP BY i.id
           ) f GROUP BY pos`,
          [owner, FUNNEL_PATH],
        ),
        // Weeks start on Monday in the viewer's time zone. "Processed" = left the inbox (advanced or dropped).
        db.query<Insights['weeks'][number]>(
          `WITH weeks AS (
             SELECT generate_series(date_trunc('week', now() AT TIME ZONE $2) - interval '11 weeks',
                                    date_trunc('week', now() AT TIME ZONE $2), interval '1 week') AS wk
           ),
           since AS (SELECT min(wk) AT TIME ZONE $2 AS t FROM weeks),
           created AS (
             SELECT date_trunc('week', created_at AT TIME ZONE $2) AS wk, count(*)::int AS n
             FROM ideas WHERE owner_id = $1 AND created_at >= (SELECT t FROM since) GROUP BY 1
           ),
           processed AS (
             SELECT date_trunc('week', e.created_at AT TIME ZONE $2) AS wk, count(DISTINCT e.idea_id)::int AS n
             FROM idea_events e JOIN ideas i ON i.id = e.idea_id
             WHERE e.type = 'stage' AND e.from_stage = 'inbox' AND e.created_at >= (SELECT t FROM since) AND i.owner_id = $1
             GROUP BY 1
           )
           SELECT to_char(w.wk, 'YYYY-MM-DD') AS week, COALESCE(c.n, 0) AS created, COALESCE(p.n, 0) AS processed
           FROM weeks w LEFT JOIN created c ON c.wk = w.wk LEFT JOIN processed p ON p.wk = w.wk
           ORDER BY w.wk`,
          [owner, tz],
        ),
        // Forward moves that jumped over at least one step of the main path (dropping is an exit, not a jump).
        db.query<{ n: number }>(
          `SELECT count(DISTINCT e.idea_id)::int AS n FROM idea_events e JOIN ideas i ON i.id = e.idea_id
           WHERE i.owner_id = $1 AND e.type = 'stage'
             AND array_position($2::text[], e.to_stage) - array_position($2::text[], e.from_stage) > 1`,
          [owner, FUNNEL_PATH],
        ),
        db.query<{ scored_total: number; scored: number; closed_total: number; concluded: number }>(
          `SELECT count(*) FILTER (WHERE stage = ANY($2::text[]))::int AS scored_total,
                  count(*) FILTER (WHERE stage = ANY($2::text[]) AND ice_x10 IS NOT NULL)::int AS scored,
                  count(*) FILTER (WHERE stage IN ('shipped', 'dropped'))::int AS closed_total,
                  count(*) FILTER (WHERE stage IN ('shipped', 'dropped') AND btrim(conclusion) <> '')::int AS concluded
           FROM ideas WHERE owner_id = $1`,
          [owner, [...SCORED_STAGES]],
        ),
        stats(owner),
      ]);
      const rate = (part: number, total: number) => (total > 0 ? truncateRate(part, total) : null);
      const counts = new Map(stageRows.map((r) => [r.stage, r.count]));
      return {
        stages: STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
        funnel: funnelSteps(Object.fromEntries(furthestRows.map((r) => [r.stage, r.count]))),
        weeks,
        skipped: skipped.n,
        metrics: {
          backlog: current.backlog,
          stalled: current.stalled.evaluating + current.stalled.validating + current.stalled.building,
          scoredRate: rate(m.scored, m.scored_total),
          concludedRate: rate(m.concluded, m.closed_total),
        },
      };
    },

    async exportIdeas(owner: string): Promise<ExportIdea[]> {
      const rows = await db.query(
        `SELECT ${IDEA_COLUMNS},
           COALESCE((SELECT json_agg(json_build_object('id', e.id, 'type', e.type, 'fromStage', e.from_stage,
                                       'toStage', e.to_stage, 'note', e.note, 'createdAt', e.created_at)
                                     ORDER BY e.created_at, e.id)
                     FROM idea_events e WHERE e.idea_id = i.id), '[]') AS events
         FROM ideas i WHERE i.owner_id = $1 ORDER BY i.created_at, i.id`,
        [owner],
      );
      return rows.map((r) => {
        const { iceX10: _derived, ...idea } = toIdea(r);
        const events = (r.events as Row[]).map((e) => ({ ...(e as unknown as IdeaEvent), createdAt: iso(e.createdAt) }));
        return { ...idea, events };
      });
    },

    /**
     * Inserts ideas (with their tags and timeline) in one statement. Ideas whose id already
     * exists are skipped as a whole, so importing the same file twice changes nothing.
     */
    async importIdeas(owner: string, ideas: ExportIdea[]): Promise<ImportResult> {
      if (!ideas.length) return { inserted: 0, skipped: 0 };
      const rows = ideas.map(({ events: _e, tags: _t, ...idea }) => idea);
      const tags = ideas.flatMap((i) => [...new Set(i.tags)].map((name) => ({ ideaId: i.id, name })));
      const events = ideas.flatMap((i) =>
        (i.events.length
          ? i.events
          : [{ id: crypto.randomUUID(), type: 'created' as const, fromStage: null, toStage: 'inbox' as const, note: '', createdAt: i.createdAt }]
        ).map((e) => ({ ...e, ideaId: i.id })),
      );
      const [r] = await db.query<{ inserted: number }>(
        `WITH ins AS (
           INSERT INTO ideas (id, owner_id, title, description, stage, impact, confidence, ease, source, links, conclusion,
                              hypothesis, success_criteria, stage_changed_at, created_at, updated_at)
           SELECT x.id, $1, x.title, x.description, x.stage, x.impact, x.confidence, x.ease, x.source, x.links, x.conclusion,
                  x.hypothesis, x."successCriteria", x."stageChangedAt", x."createdAt", x."updatedAt"
           FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, title text, description text, stage text, impact smallint,
                confidence smallint, ease smallint, source text, links jsonb, conclusion text, hypothesis text, "successCriteria" text,
                "stageChangedAt" timestamptz, "createdAt" timestamptz, "updatedAt" timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id
         ),
         tag_in AS (
           SELECT x."ideaId" AS idea_id, x.name FROM jsonb_to_recordset($3::jsonb) AS x("ideaId" uuid, name text)
           WHERE x."ideaId" IN (SELECT id FROM ins)
         ),
         new_tags AS (
           INSERT INTO tags (owner_id, name) SELECT DISTINCT $1, name FROM tag_in
           ON CONFLICT (owner_id, name) DO NOTHING RETURNING id, name
         ),
         -- Existing tags come from the statement's snapshot; the ones created above only from RETURNING.
         all_tags AS (
           SELECT id, name FROM new_tags
           UNION ALL SELECT t.id, t.name FROM tags t WHERE t.owner_id = $1 AND t.name IN (SELECT name FROM tag_in)
         ),
         linked AS (
           INSERT INTO idea_tags (idea_id, tag_id)
           SELECT ti.idea_id, at.id FROM tag_in ti JOIN all_tags at ON at.name = ti.name
           ON CONFLICT DO NOTHING
         ),
         timeline AS (
           INSERT INTO idea_events (id, idea_id, type, from_stage, to_stage, note, created_at)
           SELECT x.id, x."ideaId", x.type, x."fromStage", x."toStage", x.note, x."createdAt"
           FROM jsonb_to_recordset($4::jsonb) AS x(id uuid, "ideaId" uuid, type text, "fromStage" text, "toStage" text,
                note text, "createdAt" timestamptz)
           WHERE x."ideaId" IN (SELECT id FROM ins)
           ON CONFLICT (id) DO NOTHING
         )
         SELECT count(*)::int AS inserted FROM ins`,
        [owner, JSON.stringify(rows), JSON.stringify(tags), JSON.stringify(events)],
      );
      return { inserted: r.inserted, skipped: ideas.length - r.inserted };
    },

    async listTags(owner: string): Promise<{ name: string; count: number }[]> {
      return db.query(
        // Inner join: tags no idea uses any more stay out of filters and autocomplete.
        `SELECT t.name, count(it.idea_id)::int AS count FROM tags t
         JOIN idea_tags it ON it.tag_id = t.id
         WHERE t.owner_id = $1 GROUP BY t.name ORDER BY count DESC, t.name`,
        [owner],
      );
    },

    /** Renames a tag; renaming to a name that already exists merges the two. */
    async renameTag(owner: string, from: string, to: string): Promise<boolean> {
      const [tag] = await db.query<{ id: string }>(`SELECT id FROM tags WHERE owner_id = $1 AND name = $2`, [owner, from]);
      if (!tag) return false;
      if (from === to) return true;
      await db.transaction([
        { text: `INSERT INTO tags (owner_id, name) VALUES ($1, $2) ON CONFLICT (owner_id, name) DO NOTHING`, params: [owner, to] },
        {
          text: `INSERT INTO idea_tags (idea_id, tag_id)
                 SELECT it.idea_id, t.id FROM idea_tags it JOIN tags t ON t.owner_id = $1 AND t.name = $3
                 WHERE it.tag_id = $2
                 ON CONFLICT DO NOTHING`,
          params: [owner, tag.id, to],
        },
        { text: `DELETE FROM tags WHERE owner_id = $1 AND id = $2`, params: [owner, tag.id] },
      ]);
      return true;
    },

    async deleteTag(owner: string, name: string): Promise<boolean> {
      const rows = await db.query(`DELETE FROM tags WHERE owner_id = $1 AND name = $2 RETURNING id`, [owner, name]);
      return rows.length > 0;
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
        // A note is activity: it keeps the idea from counting as stalled.
        `WITH touched AS (UPDATE ideas SET updated_at = now() WHERE owner_id = $1 AND id = $2 RETURNING id)
         INSERT INTO idea_events (idea_id, type, note)
         SELECT id, 'note', $3 FROM touched
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
