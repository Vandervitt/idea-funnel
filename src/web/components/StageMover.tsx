import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApiError, useMoveStage, useUpdateIdea } from '../api';
import { checkTransition, CLOSED_STAGES, SCORED_STAGES, STAGE_LABELS, type Stage } from '../../shared/stage';
import { formatIce, iceScoreX10 } from '../../shared/ice';
import type { Idea } from '../../shared/types';
import type { StageInput } from '../../shared/schema';
import { Dialog, btn, useToast } from './ui';

/**
 * What a move still needs from the user, collected in one dialog. `to = null`: only set the score.
 * `plan` is optional — the fields are offered when entering 验证中 without a plan, and may be left empty.
 */
interface Gate {
  idea: Idea;
  to: Stage | null;
  score: boolean;
  plan: boolean;
  conclusion: boolean;
}

type GateResult = Pick<StageInput, 'ice' | 'conclusion' | 'plan'>;

interface Mover {
  /** Applies the funnel's entry rules, asking for a score, plan or conclusion when needed. Resolves true when moved. */
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
  const [gate, setGate] = useState<(Gate & { resolve: (r: GateResult | null) => void }) | null>(null);
  const moveStage = useMoveStage();
  const update = useUpdateIdea();
  const toast = useToast();

  const report = (err: unknown) => toast(err instanceof ApiError ? err.message : '操作失败，请重试', 'error');

  async function doMove(idea: Idea, to: Stage, extra: GateResult = {}) {
    try {
      await moveStage.mutateAsync({ id: idea.id, to, ...extra });
      toast(`已移到「${STAGE_LABELS[to]}」`);
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  }

  const ask = (g: Gate) => new Promise<GateResult | null>((resolve) => setGate({ ...g, resolve }));

  const mover: Mover = {
    async move(idea, to) {
      const scored = idea.iceX10 != null;
      // The conclusion is always asked for in the dialog, so check the other rules as if it were given.
      const check = checkTransition({ stage: idea.stage, scored, conclusion: CLOSED_STAGES.has(to) ? '-' : '' }, to);
      if (!check.ok && check.need === 'reopen') toast('已结束的想法只能重新打开到「评估中」', 'error');
      if (!check.ok && check.need !== 'score') return false;
      const needs = {
        score: !scored && SCORED_STAGES.has(to),
        plan: to === 'validating' && !idea.hypothesis.trim() && !idea.successCriteria.trim(),
        conclusion: CLOSED_STAGES.has(to),
      };
      if (!needs.score && !needs.plan && !needs.conclusion) return doMove(idea, to);
      const extra = await ask({ idea, to, ...needs });
      return extra ? doMove(idea, to, extra) : false;
    },
    async score(idea) {
      const extra = await ask({ idea, to: null, score: true, plan: false, conclusion: false });
      if (!extra?.ice) return false;
      try {
        await update.mutateAsync({ id: idea.id, patch: { ice: extra.ice } });
        toast('已保存评分');
        return true;
      } catch (err) {
        report(err);
        return false;
      }
    },
  };

  const close = (r: GateResult | null) => {
    gate?.resolve(r);
    setGate(null);
  };

  return (
    <Ctx.Provider value={mover}>
      {children}
      <Dialog open={!!gate} onClose={() => close(null)} labelledBy="gate-title">
        {gate && <GateForm gate={gate} onCancel={() => close(null)} onSubmit={close} />}
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

function gateTitle({ to, score, conclusion }: Gate) {
  if (conclusion) return to === 'dropped' ? '为什么放弃？' : '做成了！结论是什么？';
  if (score) return to ? `进入「${STAGE_LABELS[to]}」之前，先打个分` : '给这个想法打分';
  return '进入「验证中」：打算验证什么？';
}

const textarea = 'w-full px-3 py-2 rounded-lg border border-line-strong bg-surface outline-none focus:border-accent resize-y';

function GateForm({ gate, onCancel, onSubmit }: { gate: Gate; onCancel: () => void; onSubmit: (r: GateResult) => void }) {
  const { idea, to } = gate;
  const [ice, setIce] = useState({ impact: idea.impact ?? 5, confidence: idea.confidence ?? 5, ease: idea.ease ?? 5 });
  const [plan, setPlan] = useState({ hypothesis: '', successCriteria: '' });
  const [conclusion, setConclusion] = useState('');
  const [busy, setBusy] = useState(false);
  const dropped = to === 'dropped';
  const blocked = gate.conclusion && !conclusion.trim();
  const hasPlan = idea.hypothesis.trim() || idea.successCriteria.trim();

  return (
    <form className="flex flex-col gap-5" onSubmit={async (e) => {
      e.preventDefault();
      if (blocked) return;
      setBusy(true);
      const planGiven = gate.plan && (plan.hypothesis.trim() || plan.successCriteria.trim());
      await onSubmit({
        ...(gate.score ? { ice } : {}),
        ...(planGiven ? { plan: { hypothesis: plan.hypothesis.trim(), successCriteria: plan.successCriteria.trim() } } : {}),
        ...(gate.conclusion ? { conclusion: conclusion.trim() } : {}),
      });
      setBusy(false);
    }}>
      <div>
        <h2 id="gate-title" className="text-lg font-bold">{gateTitle(gate)}</h2>
        <p className="text-muted mt-1">「{idea.title}」{gate.score ? '· 凭直觉打分就行，之后可以随时改。' : ''}</p>
      </div>

      {gate.score && (
        <>
          <IceSliders value={ice} onChange={setIce} idPrefix="gate" />
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-soft text-accent-ink">
            <span>ICE 总分</span>
            <span className="ml-auto font-mono text-2xl font-bold" data-testid="gate-ice">{formatIce(iceScoreX10(ice.impact, ice.confidence, ice.ease))}</span>
          </div>
        </>
      )}

      {gate.plan && (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-bold mb-1">验证计划 <span className="font-normal text-xs text-muted">选填，写下来之后落地或放弃时可以对照</span></legend>
          <label className="flex flex-col gap-1.5 text-ink-2">
            验证假设
            <textarea rows={2} maxLength={2000} value={plan.hypothesis} onChange={(e) => setPlan({ ...plan, hypothesis: e.target.value })}
              placeholder="比如：独立开发者愿意为这个功能付费" className={textarea} />
          </label>
          <label className="flex flex-col gap-1.5 text-ink-2">
            成功标准
            <textarea rows={2} maxLength={2000} value={plan.successCriteria} onChange={(e) => setPlan({ ...plan, successCriteria: e.target.value })}
              placeholder="比如：访谈 10 人，至少 3 人愿意预付" className={textarea} />
          </label>
        </fieldset>
      )}

      {gate.conclusion && (
        <div className="flex flex-col gap-2">
          {hasPlan && (
            <div className="px-4 py-3 rounded-xl bg-sunken border border-line text-[13px] flex flex-col gap-1" aria-label="验证计划">
              <span className="font-bold text-ink-2">对照验证计划</span>
              {idea.hypothesis && <span><span className="text-muted">验证假设：</span>{idea.hypothesis}</span>}
              {idea.successCriteria && <span><span className="text-muted">成功标准：</span>{idea.successCriteria}</span>}
            </div>
          )}
          <label htmlFor="gate-conclusion" className="sr-only">结论</label>
          <textarea id="gate-conclusion" rows={3} required autoFocus={!gate.score} maxLength={2000} value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={dropped ? '比如：市场太小 / 有成熟竞品 / 自己没兴趣了' : '比如：上线了，第一周 30 个用户'}
            className={textarea} />
          <p className="text-xs text-muted">结论必填 · 回车确认，Shift + 回车换行</p>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel}>{to ? '取消，放回原处' : '取消'}</button>
        <button type="submit" className={dropped ? btn.danger : btn.primary} disabled={busy || blocked}>
          {!to ? '保存评分' : gate.conclusion ? (dropped ? '确认放弃' : '确认落地') : `保存并移到${STAGE_LABELS[to]}`}
        </button>
      </div>
    </form>
  );
}
