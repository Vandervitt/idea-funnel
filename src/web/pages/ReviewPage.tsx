import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useIdea, useStats } from '../api';
import type { Idea, IdeaPage } from '../../shared/types';
import { relativeAge, isBacklog } from '../format';
import { useStageMover } from '../components/StageMover';
import { Markdown } from '../components/Markdown';
import { Icon, IceBadge, Kbd, TagChip, btn } from '../components/ui';

type Outcome = 'advanced' | 'dropped' | 'skipped';
type Result = { idea: Idea; outcome: Outcome; note?: string };

export function ReviewPage() {
  // Each batch is a snapshot of the inbox (oldest first) so the queue doesn't shift while ideas leave it.
  // The next batch continues after the last idea seen, so skipped ideas don't come back in the same session.
  const [cursor, setCursor] = useState<string | null>(null);
  const { data: batch, isLoading } = useQuery({
    queryKey: ['review-queue', cursor],
    queryFn: () =>
      api<IdeaPage>(`/ideas?stage=inbox&sort=created_asc&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    staleTime: Infinity,
    gcTime: 0,
  });
  const queue = batch?.items;
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [exited, setExited] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const mover = useStageMover();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const snapshot = queue?.[index];
  // Follow edits made in the detail drawer.
  const { data: live } = useIdea(snapshot?.id ?? null);
  const current = live ?? snapshot;
  const done = queue && index >= queue.length;

  const record = (outcome: Outcome, note?: string) => {
    setResults((r) => [...r, { idea: current!, outcome, note }]);
    setIndex((i) => i + 1);
  };

  // Moved out of the inbox from the detail drawer: count it like the matching action.
  useEffect(() => {
    if (!live || live.stage === 'inbox' || acting.current || live.id !== snapshot?.id) return;
    setResults((r) => [...r, { idea: live, outcome: live.stage === 'dropped' ? 'dropped' : 'advanced', note: live.conclusion }]);
    setIndex((i) => i + 1);
  }, [live, snapshot?.id]);

  async function act(kind: 'advance' | 'score' | 'drop' | 'skip') {
    if (!current || busy) return;
    if (kind === 'skip') return record('skipped');
    setBusy(true);
    acting.current = true;
    try {
      if (kind === 'advance' && (await mover.move(current, 'evaluating'))) record('advanced');
      if (kind === 'drop' && (await mover.move(current, 'dropped'))) {
        const fresh = await qc.fetchQuery({ queryKey: ['idea', current.id], queryFn: () => api<Idea>(`/ideas/${current.id}`) });
        record('dropped', fresh.conclusion);
      }
      if (kind === 'score') await mover.score(current);
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }

  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const map: Record<string, Parameters<typeof act>[0]> = { ArrowRight: 'advance', s: 'score', S: 'score', d: 'drop', D: 'drop', ' ': 'skip' };
      const kind = map[e.key];
      if (!kind) return;
      e.preventDefault();
      void actRef.current(kind);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isLoading) return <p className="text-muted">加载中…</p>;

  const nextBatch = batch?.nextCursor
    ? () => {
        setCursor(batch.nextCursor);
        setIndex(0);
      }
    : undefined;

  if (exited || done || !queue?.length) {
    return <Summary results={results} state={exited ? 'exited' : queue?.length ? 'done' : 'empty'} onNextBatch={exited ? undefined : nextBatch} />;
  }

  const detail = new URLSearchParams(params);
  detail.set('idea', current!.id);

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <header className="w-full max-w-[640px] flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => (results.length ? setExited(true) : navigate('/'))}
          className="inline-flex items-center gap-1.5 min-h-10 text-ink-2 hover:text-ink cursor-pointer">
          <Icon name="back" size={16} />退出筛选
        </button>
        <div className="flex-[1_1_200px] flex items-center gap-3">
          <div role="progressbar" aria-label="筛选进度" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}
            className="flex-1 h-2 rounded-full bg-sunken overflow-hidden">
            <div className="h-full rounded-full bg-ink transition-[width] motion-reduce:transition-none" style={{ width: `${(index / queue.length) * 100}%` }} />
          </div>
          <span className="num text-muted">{index + 1} / {queue.length}</span>
        </div>
      </header>

      <span className="text-muted">收集箱 · 从最早的开始{cursor ? ' · 下一批' : ''}</span>

      <article aria-labelledby="review-title" className="w-full max-w-[640px] flex flex-col gap-4 p-6 sm:p-9 rounded-md bg-surface border border-line shadow-[0_1px_0_var(--line-strong),6px_6px_0_-1px_var(--surface),6px_6px_0_0_var(--line-strong),0_24px_48px_-32px_rgb(23_33_28/0.45)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 rounded-[4px] text-xs font-medium leading-6 ${isBacklog(current!.createdAt) ? 'bg-warn-soft text-warn-ink' : 'bg-chip text-ink-2'}`}>
            {relativeAge(current!.createdAt)}前记录
          </span>
          {current!.tags.map((t) => <TagChip key={t} name={t} />)}
          <span className="ml-auto"><IceBadge x10={current!.iceX10} /></span>
        </div>
        <h1 id="review-title" className="text-[28px] font-bold leading-snug break-words">{current!.title}</h1>
        {current!.description ? (
          <Markdown source={current!.description} className="text-ink-2" />
        ) : (
          <p className="text-muted">没有描述</p>
        )}
        {current!.source && <p className="text-[13px] text-muted">来源：{current!.source}</p>}
        <Link to={{ search: detail.toString() }} className="self-start text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:decoration-ink">打开详情，补充描述和标签</Link>
      </article>

      <div role="group" aria-label="处理这条想法" className="w-full max-w-[640px] grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <ActionButton tone="primary" label="推进到评估中" kbd="→" onClick={() => act('advance')} disabled={busy} />
        <ActionButton label={current!.iceX10 == null ? '打分' : '改分'} kbd="S" onClick={() => act('score')} disabled={busy} />
        <ActionButton tone="danger" label="放弃" kbd="D" onClick={() => act('drop')} disabled={busy} />
        <ActionButton label="跳过" kbd="空格" onClick={() => act('skip')} disabled={busy} />
      </div>
      <p className="text-[13px] text-muted text-center">跳过的想法留在收集箱。所有操作都会记录到想法的时间线里。</p>
    </div>
  );
}

function ActionButton({ label, kbd, onClick, disabled, tone }: {
  label: string;
  kbd: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
}) {
  const style =
    tone === 'primary' ? 'bg-accent text-on-accent hover:opacity-90' : tone === 'danger' ? 'bg-surface border border-line-strong text-danger hover:border-danger' : 'bg-surface border border-line-strong text-ink hover:border-ink-2';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 min-h-20 rounded-lg font-medium cursor-pointer disabled:opacity-60 ${style}`}>
      {label}
      <span className="opacity-70"><Kbd>{kbd}</Kbd></span>
    </button>
  );
}

const SUMMARY_TITLES = { done: '本周筛选完成', exited: '已退出筛选' } as const;

function Summary({ results, state, onNextBatch }: {
  results: Result[];
  state: 'done' | 'exited' | 'empty';
  onNextBatch?: () => void;
}) {
  // Live count: the session only ever sees one batch of the inbox at a time.
  const { data: stats } = useStats();
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const skipped = count('skipped');
  const inbox = stats?.inbox;
  if (state === 'empty' && results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="inline-flex items-center justify-center size-14 rounded-full bg-ok-soft text-ok"><Icon name="check" size={28} /></span>
        <h1 className="page-title">收集箱是空的</h1>
        <p className="text-muted">没有需要筛选的想法。</p>
        <Link to="/" className={btn.primary}>回到看板</Link>
      </div>
    );
  }
  const unseen = inbox == null ? 0 : Math.max(0, inbox - skipped);
  const title = state === 'exited' ? SUMMARY_TITLES.exited : onNextBatch && unseen > 0 ? '这一批筛选完成' : SUMMARY_TITLES.done;
  return (
    <div className="flex flex-col items-center gap-7 py-10">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="inline-flex items-center justify-center size-14 rounded-full bg-ok-soft text-ok"><Icon name="check" size={28} /></span>
        <h1 className="page-title">{title}</h1>
        <p className="text-muted" data-testid="summary-remaining">
          本次看了 {results.length} 条想法
          {inbox == null ? '' : inbox === 0 ? '，收集箱清空了' : `，收集箱还剩 ${inbox} 条${skipped ? `（含跳过的 ${skipped} 条）` : ''}`}
        </p>
      </div>
      <div className="w-full max-w-[640px] grid grid-cols-3 gap-3">
        {([['推进', 'advanced', 'text-ink'], ['放弃', 'dropped', 'text-danger'], ['跳过', 'skipped', 'text-muted']] as const).map(([label, o, tone]) => (
          <div key={o} className="flex flex-col gap-1 p-4 rounded-lg bg-surface border border-line">
            <span className="text-muted">{label}</span>
            <span className={`num text-4xl font-bold ${tone}`} data-testid={`summary-${o}`}>{count(o)}</span>
          </div>
        ))}
      </div>
      {results.length > 0 && (
        <ul className="w-full max-w-[640px] px-5 py-1.5 rounded-lg bg-surface border border-line">
          {results.map((r) => (
            <li key={r.idea.id} className="flex flex-wrap items-center gap-2.5 py-3.5 border-t border-line first:border-t-0">
              <span className="flex-[1_1_240px] font-medium">{r.idea.title}</span>
              <span className={`px-2 rounded-[4px] text-xs font-medium leading-6 ${r.outcome === 'advanced' ? 'bg-accent-soft text-accent-ink' : r.outcome === 'dropped' ? 'bg-danger-soft text-danger' : 'bg-chip text-ink-2'}`}>
                {r.outcome === 'advanced' ? '推进' : r.outcome === 'dropped' ? `放弃 · ${r.note ?? ''}` : '跳过'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-center gap-2.5">
        {onNextBatch && unseen > 0 && (
          <button type="button" className={btn.primary} onClick={onNextBatch}>继续下一批（还有 {unseen} 条没看过）</button>
        )}
        <Link to="/" className={`${onNextBatch && unseen > 0 ? btn.secondary : btn.primary} no-underline`}>回到看板</Link>
        <Link to="/list?stage=evaluating" className={`${btn.secondary} no-underline`}>去评估中继续打分</Link>
      </div>
    </div>
  );
}
