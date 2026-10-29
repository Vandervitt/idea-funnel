import { z } from 'zod';
import { STAGES } from './stage.js';
import { EXPORT_VERSION, SORTS } from './types.js';
import { BATCH_LIMIT, TITLE_MAX } from './capture.js';

export * from './types.js';

const score = z.number().int().min(1).max(10);
const tagName = z.string().trim().min(1).max(32).regex(/^[^\s#＃]+$/, '标签不能包含空格或 #');

export const iceInput = z.object({ impact: score, confidence: score, ease: score });
const planText = z.string().trim().max(2000);
export const planInput = z.object({ hypothesis: planText, successCriteria: planText });
export { tagName };

export const createIdeaInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional(),
  tags: z.array(tagName).max(20).optional(),
  source: z.string().trim().max(200).optional(),
});

export const updateIdeaInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000),
    tags: z.array(tagName).max(20),
    source: z.string().trim().max(200),
    links: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(20),
    // null clears the score; changing the score of an idea that requires one is checked server side.
    ice: iceInput.nullable(),
    hypothesis: planText,
    successCriteria: planText,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, '没有要更新的字段');

export const stageInput = z.object({
  to: z.enum(STAGES),
  ice: iceInput.optional(),
  conclusion: z.string().trim().max(2000).optional(),
  plan: planInput.optional(),
});

export const noteInput = z.object({ note: z.string().trim().min(1).max(2000) });

export const listQuery = z.object({
  stage: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : []))
    .pipe(z.array(z.enum(STAGES))),
  tags: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(tagName).max(10)),
  scored: z.enum(['1']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(SORTS).default('updated'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const insightsQuery = z.object({
  tz: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).refine(isValidTimeZone, '无效的时区').default('UTC'),
});

export const exportQuery = z.object({ format: z.enum(['json', 'md']).default('json') });

const isoTime = z.iso.datetime({ offset: true });

const exportEvent = z.object({
  id: z.uuid(),
  type: z.enum(['created', 'stage', 'note', 'score']),
  fromStage: z.enum(STAGES).nullable(),
  toStage: z.enum(STAGES).nullable(),
  note: z.string().max(2000),
  createdAt: isoTime,
});

// Mirrors what the app itself guarantees, so an imported idea is one the app could have produced.
const exportIdea = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000),
    stage: z.enum(STAGES),
    impact: score.nullable(),
    confidence: score.nullable(),
    ease: score.nullable(),
    source: z.string().trim().max(200),
    links: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(20),
    conclusion: z.string().max(2000),
    // Absent in files exported before the validation plan existed.
    hypothesis: z.string().max(2000).default(''),
    successCriteria: z.string().max(2000).default(''),
    tags: z.array(tagName).max(20),
    stageChangedAt: isoTime,
    createdAt: isoTime,
    updatedAt: isoTime,
    events: z.array(exportEvent).max(1000),
  })
  .superRefine((idea, ctx) => {
    const scores = [idea.impact, idea.confidence, idea.ease].filter((v) => v != null).length;
    if (scores !== 0 && scores !== 3) ctx.addIssue({ code: 'custom', message: 'ICE 的三项要么都填，要么都不填', path: ['impact'] });
    // Shipped is not checked: ideas shipped before scores were required must still import as they were exported.
    if ((idea.stage === 'validating' || idea.stage === 'building') && scores === 0) {
      ctx.addIssue({ code: 'custom', message: '验证中 / 执行中的想法必须已评分', path: ['impact'] });
    }
    if ((idea.stage === 'shipped' || idea.stage === 'dropped') && !idea.conclusion.trim()) {
      ctx.addIssue({ code: 'custom', message: '已落地 / 已放弃的想法必须有结论', path: ['conclusion'] });
    }
  });

export const importFile = z
  .object({
    app: z.literal('idea-funnel'),
    version: z.literal(EXPORT_VERSION),
    exportedAt: isoTime,
    ideas: z.array(exportIdea).max(5000),
  })
  .refine((f) => new Set(f.ideas.map((i) => i.id)).size === f.ideas.length, { message: '文件中有重复的想法 id', path: ['ideas'] });

export const importLinesInput = z.object({
  items: z
    .array(z.object({ title: z.string().trim().min(1).max(TITLE_MAX), tags: z.array(tagName).max(20).default([]) }))
    .min(1)
    .max(BATCH_LIMIT),
});

export const renameTagInput = z.object({ name: tagName });

export type CreateIdeaInput = z.infer<typeof createIdeaInput>;
export type UpdateIdeaInput = z.infer<typeof updateIdeaInput>;
export type StageInput = z.infer<typeof stageInput>;
export type ListQuery = z.infer<typeof listQuery>;
