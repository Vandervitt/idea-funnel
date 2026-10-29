export const STAGES = ['inbox', 'evaluating', 'validating', 'building', 'shipped', 'dropped'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  inbox: '收集箱',
  evaluating: '评估中',
  validating: '验证中',
  building: '执行中',
  shipped: '已落地',
  dropped: '已放弃',
};

/** Stages an idea can only be in with an ICE score (PRD: 「验证中及之后 100% 有评分」). */
export const SCORED_STAGES: ReadonlySet<Stage> = new Set(['validating', 'building', 'shipped']);
export const CLOSED_STAGES: ReadonlySet<Stage> = new Set(['shipped', 'dropped']);

export type TransitionNeed = 'score' | 'conclusion' | 'reopen' | 'same';
export type TransitionCheck = { ok: true } | { ok: false; need: TransitionNeed };

export interface TransitionSubject {
  stage: Stage;
  scored: boolean;
  conclusion: string;
}

/**
 * Entry rules of the funnel. `subject` should already reflect any score or
 * conclusion submitted together with the move.
 */
export function checkTransition(subject: TransitionSubject, to: Stage): TransitionCheck {
  if (subject.stage === to) return { ok: false, need: 'same' };
  if (CLOSED_STAGES.has(subject.stage) && to !== 'evaluating') return { ok: false, need: 'reopen' };
  if (SCORED_STAGES.has(to) && !subject.scored) return { ok: false, need: 'score' };
  if (CLOSED_STAGES.has(to) && subject.conclusion.trim() === '') return { ok: false, need: 'conclusion' };
  return { ok: true };
}
