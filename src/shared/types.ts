import type { Stage } from './stage.js';

export const SORTS = ['updated', 'updated_asc', 'created', 'created_asc', 'ice'] as const;
export type Sort = (typeof SORTS)[number];

export interface Idea {
  id: string;
  title: string;
  description: string;
  stage: Stage;
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  iceX10: number | null;
  source: string;
  links: string[];
  conclusion: string;
  /** Validation plan: what 验证中 sets out to prove, and how to tell it worked. */
  hypothesis: string;
  successCriteria: string;
  tags: string[];
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaEvent {
  id: string;
  type: 'created' | 'stage' | 'note' | 'score';
  fromStage: Stage | null;
  toStage: Stage | null;
  note: string;
  createdAt: string;
}

export interface IdeaPage {
  items: Idea[];
  nextCursor: string | null;
}

export interface BoardColumn {
  stage: Stage;
  count: number;
  items: Idea[];
}

export const BACKLOG_DAYS = 14;

/** Mid-funnel stages and how many days without activity (updated_at) make an idea "stalled". */
export const STALL_DAYS = { evaluating: 30, validating: 30, building: 60 } as const;
export type StallStage = keyof typeof STALL_DAYS;

export interface Stats {
  backlog: number;
  inbox: number;
  stalled: Record<StallStage, number>;
}

export interface Insights {
  stages: { stage: Stage; count: number }[];
  funnel: { stage: Stage; reached: number; rate: string | null }[];
  /** Oldest first; `week` is the Monday (YYYY-MM-DD) in the requested time zone. */
  weeks: { week: string; created: number; processed: number }[];
  /** Ideas that ever moved forward past at least one stage of the main path. */
  skipped: number;
  /** PRD success metrics. Rates are truncated; null when there is nothing to measure. */
  metrics: { backlog: number; stalled: number; scoredRate: string | null; concludedRate: string | null };
}

/** One idea in an export file: everything needed to restore it, minus derived fields (ice_x10). */
export interface ExportIdea extends Omit<Idea, 'iceX10'> {
  events: IdeaEvent[];
}

export const EXPORT_VERSION = 1;

export interface ExportFile {
  app: 'idea-funnel';
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  ideas: ExportIdea[];
}

export interface ImportResult {
  inserted: number;
  skipped: number;
}
