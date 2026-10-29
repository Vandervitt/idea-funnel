import { z } from 'zod';
import { STAGES } from './stage';
import { SORTS } from './types';

export * from './types';

const score = z.number().int().min(1).max(10);
const tagName = z.string().trim().min(1).max(32).regex(/^[^\s#＃]+$/, '标签不能包含空格或 #');

export const iceInput = z.object({ impact: score, confidence: score, ease: score });

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
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, '没有要更新的字段');

export const stageInput = z.object({
  to: z.enum(STAGES),
  ice: iceInput.optional(),
  conclusion: z.string().trim().max(2000).optional(),
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

export type CreateIdeaInput = z.infer<typeof createIdeaInput>;
export type UpdateIdeaInput = z.infer<typeof updateIdeaInput>;
export type StageInput = z.infer<typeof stageInput>;
export type ListQuery = z.infer<typeof listQuery>;
