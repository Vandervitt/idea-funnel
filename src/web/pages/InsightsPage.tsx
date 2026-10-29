import { Link } from 'react-router';
import { useInsights } from '../api';
import { STAGE_LABELS } from '../../shared/stage';
import type { Insights } from '../../shared/types';
import { STAGE_DOT } from '../components/ui';

const card = 'flex flex-col gap-4 p-5 rounded-xl bg-surface border border-line';

export function InsightsPage() {
  const { data, isLoading, isError } = useInsights();
  if (isLoading) return <p className="text-muted">加载中…</p>;
  if (isError || !data) return <p className="text-danger">概览加载失败，请刷新重试。</p>;

  const total = data.stages.reduce((n, s) => n + s.count, 0);
  return (
    <div className="flex flex-col gap-5 max-w-[960px]">
      <h1 className="text-[22px] font-bold">概览</h1>
      {total === 0 ? (
        <p className="text-muted">还没有想法。记下几条之后，这里会显示漏斗和每周趋势。</p>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <StageCounts stages={data.stages} />
            <Funnel funnel={data.funnel} />
          </div>
          <Weekly weeks={data.weeks} />
        </>
      )}
    </div>
  );
}

function StageCounts({ stages }: { stages: Insights['stages'] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <section aria-labelledby="stages-title" className={card}>
      <div>
        <h2 id="stages-title" className="font-bold">各阶段数量</h2>
        <p className="text-[13px] text-muted">当前处于每个阶段的想法，点击查看列表</p>
      </div>
      <ul className="flex flex-col gap-1">
        {stages.map((s) => (
          <li key={s.stage}>
            <Link to={`/list?stage=${s.stage}`} aria-label={`${STAGE_LABELS[s.stage]} ${s.count} 条`}
              className="grid grid-cols-[72px_1fr_40px] items-center gap-3 min-h-9 px-2 -mx-2 rounded-lg no-underline text-ink hover:bg-chip">
              <span className="flex items-center gap-2 text-ink-2">
                <span className={`size-2 rounded-full ${STAGE_DOT[s.stage]}`} aria-hidden="true" />
                {STAGE_LABELS[s.stage]}
              </span>
              <span className="h-2.5 rounded-full bg-sunken overflow-hidden" aria-hidden="true">
                {s.count > 0 && <span className="block h-full rounded-full bg-series-1" style={{ width: `${(s.count / max) * 100}%` }} />}
              </span>
              <span className="font-mono text-right" data-testid={`stage-count-${s.stage}`}>{s.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Funnel({ funnel }: { funnel: Insights['funnel'] }) {
  const top = Math.max(1, funnel[0]?.reached ?? 0);
  return (
    <section aria-labelledby="funnel-title" className={card}>
      <div>
        <h2 id="funnel-title" className="font-bold">阶段转化</h2>
        <p className="text-[13px] text-muted">曾经到达每个阶段的想法数；已放弃的按放弃前走到的最远阶段计</p>
      </div>
      <ol className="flex flex-col">
        {funnel.map((s, i) => (
          <li key={s.stage} className="flex flex-col">
            {i > 0 && (
              <span className="self-start ml-[72px] pl-3 py-0.5 text-xs text-muted" data-testid={`rate-${s.stage}`}>
                ↓ 转化 {s.rate}
              </span>
            )}
            <div className="grid grid-cols-[72px_1fr_40px] items-center gap-3 min-h-8">
              <span className="text-ink-2">{STAGE_LABELS[s.stage]}</span>
              <span className="h-2.5 rounded-full bg-sunken overflow-hidden" aria-hidden="true">
                {s.reached > 0 && <span className="block h-full rounded-full bg-series-1" style={{ width: `${(s.reached / top) * 100}%` }} />}
              </span>
              <span className="font-mono text-right" data-testid={`reached-${s.stage}`}>{s.reached}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const SERIES = [
  { key: 'created', label: '新增', className: 'bg-series-1' },
  { key: 'processed', label: '处理', className: 'bg-series-2' },
] as const;

const shortDate = (week: string) => `${Number(week.slice(5, 7))}/${Number(week.slice(8, 10))}`;

/** Round the axis up to a friendly number so gridlines land on integers. */
function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}

function Weekly({ weeks }: { weeks: Insights['weeks'] }) {
  const max = niceMax(Math.max(0, ...weeks.flatMap((w) => [w.created, w.processed])));
  const ticks = [max, max / 2, 0];
  return (
    <section aria-labelledby="weekly-title" className={card}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-[1_1_240px]">
          <h2 id="weekly-title" className="font-bold">最近 12 周</h2>
          <p className="text-[13px] text-muted">每周新增的想法，以及离开收集箱（推进或放弃）的想法；每周从周一开始</p>
        </div>
        <ul className="flex gap-4 text-[13px] text-ink-2" aria-label="图例">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${s.className}`} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-[28px_1fr] gap-2" aria-hidden="true">
        <div className="relative h-44 text-[11px] text-muted font-mono">
          {ticks.map((t, i) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative">
          {ticks.map((t, i) => (
            <span key={t} className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
          ))}
          <div className="relative grid grid-cols-12 h-44">
            {weeks.map((w, i) => (
              <div key={w.week} className="group relative flex items-end justify-center gap-0.5 px-[8%] hover:bg-chip/60 rounded-t-md">
                {SERIES.map((s) => (
                  <span key={s.key} className={`flex-1 max-w-4 rounded-t-[4px] ${s.className}`}
                    style={{ height: `${(w[s.key] / max) * 100}%` }} />
                ))}
                <div className={`pointer-events-none absolute bottom-full mb-1 z-10 hidden group-hover:flex flex-col gap-0.5 whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-surface border border-line shadow-md text-xs text-ink ${i > 8 ? 'right-0' : i < 3 ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}>
                  <span className="text-muted">{w.week} 这周</span>
                  {SERIES.map((s) => (
                    <span key={s.key} className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-sm ${s.className}`} />
                      {s.label} <b className="font-mono">{w[s.key]}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-12 pt-1.5 text-[11px] text-muted font-mono">
            {weeks.map((w, i) => (
              // On narrow screens label every other week, always including the current one.
              <span key={w.week} className={`text-center ${(weeks.length - 1 - i) % 2 ? 'max-sm:invisible' : ''}`}>{shortDate(w.week)}</span>
            ))}
          </div>
        </div>
      </div>

      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2 w-fit">查看数据表</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left font-mono">
            <caption className="sr-only">最近 12 周每周新增与处理数量</caption>
            <thead className="text-muted">
              <tr><th scope="col" className="py-1 font-normal">周（周一）</th><th scope="col" className="font-normal">新增</th><th scope="col" className="font-normal">处理</th></tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className="border-t border-line">
                  <th scope="row" className="py-1 font-normal">{w.week}</th><td>{w.created}</td><td>{w.processed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
