// All ratios in this product truncate toward zero; never round.

/** ICE average × 10, truncated: (7+8+8)/3 = 7.666… → 76. Matches the DB's generated column. */
export function iceScoreX10(impact: number, confidence: number, ease: number): number {
  return Math.trunc(((impact + confidence + ease) * 10) / 3);
}

export function formatIce(x10: number | null | undefined): string {
  if (x10 == null) return '—';
  return `${Math.trunc(x10 / 10)}.${x10 % 10}`;
}

/** Percentage with one decimal, truncated: 2/3 → "66.6%". */
export function truncateRate(part: number, total: number): string {
  if (total <= 0) return '—';
  const x10 = Math.trunc((part * 1000) / total);
  return `${Math.trunc(x10 / 10)}.${x10 % 10}%`;
}
