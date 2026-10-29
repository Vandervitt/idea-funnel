import { BACKLOG_DAYS, STALL_DAYS, type Idea } from '../shared/types';

const DAY = 24 * 3600 * 1000;

export function ageDays(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

/** "今天" / "3 天" / "2 周" / "10 月 8 日" */
export function relativeAge(iso: string, now = Date.now()): string {
  const d = ageDays(iso, now);
  if (d <= 0) return '今天';
  if (d < BACKLOG_DAYS + 7) return `${d} 天`;
  if (d < 60) return `${Math.floor(d / 7)} 周`;
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  const t = new Date(iso);
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

export function formatDateTime(iso: string): string {
  const t = new Date(iso);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

// Same rule as the server's backlog count: created more than 14 × 24h ago.
export const isBacklog = (iso: string, now = Date.now()) => now - new Date(iso).getTime() > BACKLOG_DAYS * DAY;

// Same rule as the server's stalled count: a mid-funnel idea with no activity (updated_at) past its stage's limit.
export function isStalled(idea: Pick<Idea, 'stage' | 'updatedAt'>, now = Date.now()) {
  const days = STALL_DAYS[idea.stage as keyof typeof STALL_DAYS];
  return days != null && now - new Date(idea.updatedAt).getTime() > days * DAY;
}
