import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Idea, IdeaPage } from '../../shared/types';
import { relativeAge, isBacklog } from '../format';
import { useStageMover } from '../components/StageMover';
import { Icon, IceBadge, Kbd, TagChip, btn } from '../components/ui';

type Outcome = 'advanced' | 'dropped' | 'skipped';

export function ReviewPage() {
  // Snapshot the inbox once (oldest first) so the queue doesn't shift while ideas leave it.
  const { data: queue, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => api<IdeaPage>('/ideas?stage=inbox&sort=created_asc&limit=50').then((p) => p.items),
    staleTime: Infinity,
    gcTime: 0,
  });
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<{ idea: Idea; outcome: Outcome; note?: string }[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Idea>>({});
  const [busy, setBusy] = useState(false);
  const mover = useStageMover();
  const qc = useQueryClient();

  const current = queue?.[index] ? (overrides[queue[index].id] ?? queue[index]) : undefined;
  const done = queue && index >= queue.length;

  const record = (outcome: Outcome, note?: string) => {
    setResults((r) => [...r, { idea: current!, outcome, note }]);
    setIndex((i) => i + 1);
  };

  async function act(kind: 'advance' | 'score' | 'drop' | 'skip') {
    if (!current || busy) return;
    if (kind === 'skip') return record('skipped');
    setBusy(true);
    try {
      if (kind === 'advance' && (await mover.move(current, 'evaluating'))) record('advanced');
      if (kind === 'drop' && (await mover.move(current, 'dropped'))) {
        const fresh = await qc.fetchQuery({ queryKey: ['idea', current.id], queryFn: () => api<Idea>(`/ideas/${current.id}`) });
        record('dropped', fresh.conclusion);
      }
      if (kind === 'score' && (await mover.score(current))) {
        const fresh = await qc.fetchQuery({ queryKey: ['idea', current.id], queryFn: () => api<Idea>(`/ideas/${current.id}`) });
        setOverrides((o) => ({ ...o, [fresh.id]: fresh }));
      }
    } finally {
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

  if (done || !queue?.length) {
    return <Summary results={results} empty={!queue?.length} />;
  }

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <header className="w-full max-w-[640px] flex flex-wrap items-center gap-4">
        <Link to="/" className="inline-flex items-center gap-1.5 min-h-10 text-ink-2 no-underline">
          <Icon name="back" size={16} />退出筛选
        </Link>
        <div className="flex-[1_1_200px] flex items-center gap-3">
          <div role="progressbar" aria-label="筛选进度" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}
            className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${(index / queue.length) * 100}%` }} />
          </div>
          <span className="font-mono text-muted">{index + 1} / {queue.length}</span>
        </div>
      </header>

      <span className="text-muted">收集箱 · 从最早的开始</span>

      <article aria-labelledby="review-title" className="w-full max-w-[640px] flex flex-col gap-4 p-6 sm:p-8 rounded-2xl bg-surface border border-line shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2.5 rounded-md text-xs font-medium leading-6 ${isBacklog(current!.createdAt) ? 'bg-warn-soft text-warn-ink' : 'bg-chip text-ink-2'}`}>
            {relativeAge(current!.createdAt)}前记录
          </span>
          {current!.tags.map((t) => <TagChip key={t} name={t} />)}
          <span className="ml-auto"><IceBadge x10={current!.iceX10} /></span>
        </div>
        <h1 id="review-title" className="text-[26px] font-bold leading-snug break-words">{current!.title}</h1>
        {current!.description ? (
          <p className="text-ink-2 leading-relaxed whitespace-pre-wrap break-words">{current!.description}</p>
        ) : (
          <p className="text-muted">没有描述</p>
        )}
        {current!.source && <p className="text-[13px] text-muted">来源：{current!.source}</p>}
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
    tone === 'primary' ? 'bg-accent text-white' : tone === 'danger' ? 'bg-surface border border-line-strong text-danger' : 'bg-surface border border-line-strong text-ink';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 min-h-20 rounded-xl font-medium cursor-pointer disabled:opacity-60 ${style}`}>
      {label}
      <span className="opacity-80"><Kbd>{kbd}</Kbd></span>
    </button>
  );
}

function Summary({ results, empty }: { results: { idea: Idea; outcome: Outcome; note?: string }[]; empty: boolean }) {
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const skipped = count('skipped');
  if (empty && results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="inline-flex items-center justify-center size-14 rounded-full bg-ok-soft text-ok"><Icon name="check" size={28} /></span>
        <h1 className="text-2xl font-bold">收集箱是空的</h1>
        <p className="text-muted">没有需要筛选的想法。</p>
        <Link to="/" className={btn.primary}>回到看板</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-7 py-10">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="inline-flex items-center justify-center size-14 rounded-full bg-ok-soft text-ok"><Icon name="check" size={28} /></span>
        <h1 className="text-[26px] font-bold">本周筛选完成</h1>
        <p className="text-muted">本次看了 {results.length} 条想法{skipped ? `，收集箱还剩 ${skipped} 条（跳过的）` : '，收集箱清空了'}</p>
      </div>
      <div className="w-full max-w-[640px] grid grid-cols-3 gap-3">
        {([['推进', 'advanced', 'text-accent-ink'], ['放弃', 'dropped', 'text-danger'], ['跳过', 'skipped', 'text-muted']] as const).map(([label, o, tone]) => (
          <div key={o} className="flex flex-col gap-1 p-4 rounded-2xl bg-surface border border-line">
            <span className="text-muted">{label}</span>
            <span className={`font-mono text-3xl font-bold ${tone}`} data-testid={`summary-${o}`}>{count(o)}</span>
          </div>
        ))}
      </div>
      <ul className="w-full max-w-[640px] px-5 py-1.5 rounded-2xl bg-surface border border-line">
        {results.map((r) => (
          <li key={r.idea.id} className="flex flex-wrap items-center gap-2.5 py-3.5 border-t border-line first:border-t-0">
            <span className="flex-[1_1_240px] font-medium">{r.idea.title}</span>
            <span className={`px-2.5 rounded-md text-xs font-medium leading-6 ${r.outcome === 'advanced' ? 'bg-accent-soft text-accent-ink' : r.outcome === 'dropped' ? 'bg-danger-soft text-danger' : 'bg-chip text-ink-2'}`}>
              {r.outcome === 'advanced' ? '推进到评估中' : r.outcome === 'dropped' ? `放弃 · ${r.note ?? ''}` : '跳过'}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-2.5">
        <Link to="/" className={`${btn.primary} no-underline`}>回到看板</Link>
        <Link to="/list?stage=evaluating" className={`${btn.secondary} no-underline`}>去评估中继续打分</Link>
      </div>
    </div>
  );
}
