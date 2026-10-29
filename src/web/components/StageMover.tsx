import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApiError, useMoveStage, useUpdateIdea } from '../api';
import { checkTransition, STAGE_LABELS, type Stage } from '../../shared/stage';
import { formatIce, iceScoreX10 } from '../../shared/ice';
import type { Idea } from '../../shared/types';
import type { StageInput } from '../../shared/schema';
import { Dialog, btn, useToast } from './ui';

type Gate =
  | { kind: 'score'; idea: Idea; to: Stage | null } // to = null: only set the score
  | { kind: 'conclusion'; idea: Idea; to: Stage };

interface Mover {
  /** Applies the funnel's entry rules, asking for a score or conclusion when needed. Resolves true when moved. */
  move(idea: Idea, to: Stage): Promise<boolean>;
  score(idea: Idea): Promise<boolean>;
}

const Ctx = createContext<Mover | null>(null);
export function useStageMover() {
  const m = useContext(Ctx);
  if (!m) throw new Error('useStageMover outside StageMoverProvider');
  return m;
}

export function StageMoverProvider({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<(Gate & { resolve: (ok: boolean) => void }) | null>(null);
  const moveStage = useMoveStage();
  const update = useUpdateIdea();
  const toast = useToast();

  const report = (err: unknown) => toast(err instanceof ApiError ? err.message : '操作失败，请重试', 'error');

  async function doMove(idea: Idea, to: Stage, extra: Pick<StageInput, 'ice' | 'conclusion'> = {}) {
    try {
      await moveStage.mutateAsync({ id: idea.id, to, ...extra });
      toast(`已移到「${STAGE_LABELS[to]}」`);
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  }

  const ask = (g: Gate) => new Promise<boolean>((resolve) => setGate({ ...g, resolve }));

  const mover: Mover = {
    async move(idea, to) {
      const check = checkTransition({ stage: idea.stage, scored: idea.iceX10 != null, conclusion: '' }, to);
      if (check.ok) return doMove(idea, to);
      if (check.need === 'score') return ask({ kind: 'score', idea, to });
      if (check.need === 'conclusion') return ask({ kind: 'conclusion', idea, to });
      if (check.need === 'reopen') toast('已结束的想法只能重新打开到「评估中」', 'error');
      return false;
    },
    score: (idea) => ask({ kind: 'score', idea, to: null }),
  };

  const close = (ok: boolean) => {
    gate?.resolve(ok);
    setGate(null);
  };

  return (
    <Ctx.Provider value={mover}>
      {children}
      <Dialog open={!!gate} onClose={() => close(false)} labelledBy="gate-title">
        {gate?.kind === 'score' && (
          <ScoreForm
            idea={gate.idea}
            to={gate.to}
            onCancel={() => close(false)}
            onSubmit={async (ice) => {
              if (gate.to) return close(await doMove(gate.idea, gate.to, { ice }));
              try {
                await update.mutateAsync({ id: gate.idea.id, patch: { ice } });
                toast('已保存评分');
                close(true);
              } catch (err) {
                report(err);
              }
            }}
          />
        )}
        {gate?.kind === 'conclusion' && (
          <ConclusionForm
            to={gate.to}
            onCancel={() => close(false)}
            onSubmit={async (conclusion) => close(await doMove(gate.idea, gate.to, { conclusion }))}
          />
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

const DIMS = [
  { key: 'impact', label: 'Impact 影响', hint: '做成了价值有多大' },
  { key: 'confidence', label: 'Confidence 信心', hint: '有多大把握' },
  { key: 'ease', label: 'Ease 容易度', hint: '10 = 很容易' },
] as const;

export function IceSliders({ value, onChange, idPrefix }: {
  value: { impact: number; confidence: number; ease: number };
  onChange: (v: { impact: number; confidence: number; ease: number }) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {DIMS.map((d) => (
        <div key={d.key} className="grid grid-cols-[120px_minmax(0,1fr)_28px] items-center gap-3">
          <label htmlFor={`${idPrefix}-${d.key}`} className="text-ink-2">
            {d.label}
            <span className="block text-xs text-muted">{d.hint}</span>
          </label>
          <input id={`${idPrefix}-${d.key}`} type="range" min={1} max={10} value={value[d.key]}
            onChange={(e) => onChange({ ...value, [d.key]: Number(e.target.value) })} className="w-full" />
          <span className="font-mono font-bold text-right">{value[d.key]}</span>
        </div>
      ))}
    </div>
  );
}

function ScoreForm({ idea, to, onCancel, onSubmit }: {
  idea: Idea;
  to: Stage | null;
  onCancel: () => void;
  onSubmit: (ice: { impact: number; confidence: number; ease: number }) => void;
}) {
  const [ice, setIce] = useState({ impact: idea.impact ?? 5, confidence: idea.confidence ?? 5, ease: idea.ease ?? 5 });
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-5" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      await onSubmit(ice);
      setBusy(false);
    }}>
      <div>
        <h2 id="gate-title" className="text-lg font-bold">{to ? `进入「${STAGE_LABELS[to]}」之前，先打个分` : '给这个想法打分'}</h2>
        <p className="text-muted mt-1">「{idea.title}」· 凭直觉打分就行，之后可以随时改。</p>
      </div>
      <IceSliders value={ice} onChange={setIce} idPrefix="gate" />
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-soft text-accent-ink">
        <span>ICE 总分</span>
        <span className="ml-auto font-mono text-2xl font-bold" data-testid="gate-ice">{formatIce(iceScoreX10(ice.impact, ice.confidence, ice.ease))}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel}>{to ? '取消，放回原处' : '取消'}</button>
        <button type="submit" className={btn.primary} disabled={busy}>{to ? `保存并移到${STAGE_LABELS[to]}` : '保存评分'}</button>
      </div>
    </form>
  );
}

function ConclusionForm({ to, onCancel, onSubmit }: { to: Stage; onCancel: () => void; onSubmit: (c: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const dropped = to === 'dropped';
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      setBusy(true);
      await onSubmit(text.trim());
      setBusy(false);
    }}>
      <h2 id="gate-title" className="text-lg font-bold">{dropped ? '为什么放弃？' : '做成了！结论是什么？'}</h2>
      <label htmlFor="gate-conclusion" className="sr-only">结论</label>
      <textarea id="gate-conclusion" rows={3} required autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={dropped ? '比如：市场太小 / 有成熟竞品 / 自己没兴趣了' : '比如：上线了，第一周 30 个用户'}
        className="w-full px-3 py-2 rounded-lg border border-line-strong bg-surface outline-none focus:border-accent resize-y" />
      <p className="text-xs text-muted -mt-2">必填 · 回车确认，Shift + 回车换行</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel}>取消</button>
        <button type="submit" className={dropped ? btn.danger : btn.primary} disabled={busy || !text.trim()}>
          {dropped ? '确认放弃' : '确认落地'}
        </button>
      </div>
    </form>
  );
}
