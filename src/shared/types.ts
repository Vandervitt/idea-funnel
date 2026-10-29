import type { Stage } from './stage.js';

export const SORTS = ['updated', 'created', 'created_asc', 'ice'] as const;
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
  tags: string[];
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaEvent {
  id: string;
  type: 'created' | 'stage' | 'note';
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

export interface Stats {
  backlog: number;
  inbox: number;
}

export const BACKLOG_DAYS = 14;

export interface Insights {
  stages: { stage: Stage; count: number }[];
  funnel: { stage: Stage; reached: number; rate: string | null }[];
  /** Oldest first; `week` is the Monday (YYYY-MM-DD) in the requested time zone. */
  weeks: { week: string; created: number; processed: number }[];
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
