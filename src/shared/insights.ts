import { truncateRate } from './ice.js';
import type { Stage } from './stage.js';

/** The main path through the funnel; "dropped" is an exit, not a step. */
export const FUNNEL_PATH = ['inbox', 'evaluating', 'validating', 'building', 'shipped'] as const satisfies readonly Stage[];
export type FunnelStage = (typeof FUNNEL_PATH)[number];

export interface FunnelStep {
  stage: FunnelStage;
  /** Ideas that ever reached this stage (or a later one). */
  reached: number;
  /** reached / reached of the previous step, truncated; null for the first step. */
  rate: string | null;
}

/** `furthest[s]` = how many ideas got no further than `s` (dropped ideas count at the furthest stage before dropping). */
export function funnelSteps(furthest: Partial<Record<FunnelStage, number>>): FunnelStep[] {
  let reached = 0;
  const totals = [...FUNNEL_PATH].reverse().map((stage) => (reached += furthest[stage] ?? 0)).reverse();
  return FUNNEL_PATH.map((stage, i) => ({
    stage,
    reached: totals[i],
    rate: i === 0 ? null : truncateRate(totals[i], totals[i - 1]),
  }));
}
