import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useBoard, useStats } from '../api';
import { STAGE_LABELS, type Stage } from '../../shared/stage';
import type { BoardColumn, Idea } from '../../shared/types';
import { isBacklog, isStalled, relativeAge } from '../format';
import { STALL_DAYS, type StallStage } from '../../shared/types';
import { useStageMover } from '../components/StageMover';
import { Icon, IceBadge, STAGE_DOT, STAGE_EDGE, TagChip, btn } from '../components/ui';
import { TagFilter, useFilterParams } from '../components/Filters';

const OPEN_STAGES: Stage[] = ['inbox', 'evaluating', 'validating', 'building'];
const FOLDED_STAGES: Stage[] = ['shipped', 'dropped'];

export function BoardPage() {
  const filter = useFilterParams();
  const { data: columns, isLoading, isError, refetch } = useBoard(filter.board);
  const { data: stats } = useStats();
  const mover = useStageMover();
  const [dragging, setDragging] = useState<Idea | null>(null);
  const [expanded, setExpanded] = useState<Set<Stage>>(new Set());
  const [mobileStage, setMobileStage] = useState<Stage>('inbox');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const byStage = new Map(columns?.map((c) => [c.stage, c]));
  const total = columns?.reduce((n, c) => n + c.count, 0) ?? 0;

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const idea = e.active.data.current?.idea as Idea | undefined;
    const to = e.over?.id as Stage | undefined;
    if (idea && to && to !== idea.stage) void mover.move(idea, to);
  }

  return (
    <div className="flex flex-col gap-5">
      {!!stats?.backlog && (
        <div role="status" className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-warn-soft text-warn-ink border-l-4 border-warn">
          <Icon name="clock" />
          <span className="flex-[1_1_240px]">收集箱里有 <b>{stats.backlog}</b> 条想法超过 14 天没处理了，花几分钟筛一下吧。</span>
          <Link to="/review" className="inline-flex items-center min-h-9 px-3.5 rounded-lg bg-warn text-on-warn font-medium no-underline hover:opacity-90">开始筛选</Link>
        </div>
      )}

      {stats && <StalledNotice stalled={stats.stalled} />}

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="page-title">看板</h1>
        <span className="text-muted">共 <span className="num">{total}</span> 条</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <TagFilter selected={filter.tags} onChange={filter.setTags} />
          <button type="button" aria-pressed={filter.scored} onClick={() => filter.setScored(!filter.scored)}
            className={filter.scored ? `${btn.secondary} !border-ink !bg-ink !text-bg` : btn.secondary}>
            只看已评分
          </button>
        </div>
      </div>

      {isError && (
        <p className="text-danger">加载失败。<button type="button" className="underline cursor-pointer" onClick={() => refetch()}>重试</button></p>
      )}
      {isLoading && <p className="text-muted">加载中…</p>}

      {columns && (
        <>
          {/* Desktop: drag between columns. */}
          <DndContext sensors={sensors} onDragStart={(e) => setDragging(e.active.data.current?.idea ?? null)}
            onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
            <div className="hidden md:flex gap-3 items-start overflow-x-auto pb-2">
              {OPEN_STAGES.map((s) => <Column key={s} column={byStage.get(s)!} />)}
              {FOLDED_STAGES.map((s) =>
                expanded.has(s) ? (
                  <Column key={s} column={byStage.get(s)!} onFold={() => setExpanded((x) => new Set([...x].filter((y) => y !== s)))} />
                ) : (
                  <FoldedColumn key={s} column={byStage.get(s)!} onExpand={() => setExpanded((x) => new Set(x).add(s))} />
                ),
              )}
            </div>
            {/* No drop animation: when the drop opens a modal (score / conclusion) the animation never finishes,
                and the lifted copy stays on top of the card, blocking the next drag. */}
            <DragOverlay dropAnimation={null}>{dragging && <CardBody idea={dragging} lifted />}</DragOverlay>
          </DndContext>

          {/* Mobile: one stage at a time. */}
          <div className="md:hidden flex flex-col gap-3">
            <div role="tablist" aria-label="阶段" className="flex gap-2 overflow-x-auto -mx-4 px-4">
              {[...OPEN_STAGES, ...FOLDED_STAGES].map((s) => (
                <button key={s} type="button" role="tab" aria-selected={mobileStage === s} onClick={() => setMobileStage(s)}
                  className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full cursor-pointer ${mobileStage === s ? 'bg-ink text-bg font-medium' : 'border border-line-strong bg-surface text-ink-2'}`}>
                  <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_DOT[s]}`} />
                  {STAGE_LABELS[s]} <span className="num">{byStage.get(s)?.count ?? 0}</span>
                </button>
              ))}
            </div>
            {byStage.get(mobileStage)?.items.map((i) => <CardLink key={i.id} idea={i} />)}
            {!byStage.get(mobileStage)?.items.length && <p className="text-muted py-6 text-center">这个阶段还没有想法</p>}
          </div>
        </>
      )}

      <p className="hidden md:block text-xs text-muted">提示：拖动卡片可以换阶段；进入「验证中」前需要先打 ICE 分，进入「已落地 / 已放弃」需要填写结论。</p>
    </div>
  );
}

function StalledNotice({ stalled }: { stalled: Record<StallStage, number> }) {
  const stages = (Object.keys(STALL_DAYS) as StallStage[]).filter((s) => stalled[s] > 0);
  if (!stages.length) return null;
  return (
    <div role="status" aria-label="停滞提醒" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 rounded-lg bg-surface border border-line border-l-4 border-l-line-strong">
      <Icon name="clock" className="text-muted" />
      <span className="flex-[1_1_240px]">有想法很久没有进展了，推进一步、记一笔备注，或者干脆放弃：</span>
      {stages.map((s) => (
        <Link key={s} to={`/list?stage=${s}&sort=updated_asc`} className="inline-flex items-center min-h-9 px-3 rounded-lg border border-line-strong bg-surface text-ink-2 no-underline hover:border-ink-2">
          {STAGE_LABELS[s]} <b className="mx-1 num">{stalled[s]}</b> 条超过 {STALL_DAYS[s]} 天
        </Link>
      ))}
    </div>
  );
}

function Column({ column, onFold }: { column: BoardColumn; onFold?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  return (
    <section ref={setNodeRef} aria-label={STAGE_LABELS[column.stage]}
      className={`flex-[1_0_236px] flex flex-col gap-2 p-2.5 pt-3 rounded-b-2xl rounded-t-sm border-t-[3px] ${STAGE_EDGE[column.stage]} bg-sunken min-h-40 transition-shadow ${isOver ? 'ring-2 ring-ink' : ''}`}>
      <header className="flex items-baseline gap-2 px-1.5 pb-1">
        <h2 className="font-bold">{STAGE_LABELS[column.stage]}</h2>
        <span className="num text-[13px] text-muted">{column.count}</span>
        {onFold && <button type="button" onClick={onFold} className="ml-auto text-xs text-muted hover:text-ink cursor-pointer">折叠</button>}
      </header>
      {column.items.map((i) => <DraggableCard key={i.id} idea={i} />)}
      {column.count > column.items.length && (
        <Link to={`/list?stage=${column.stage}`} className="text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:decoration-ink px-1.5">还有 {column.count - column.items.length} 条，去列表查看</Link>
      )}
    </section>
  );
}

function FoldedColumn({ column, onExpand }: { column: BoardColumn; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  return (
    <section ref={setNodeRef} aria-label={`${STAGE_LABELS[column.stage]}（已折叠）`}
      className={`flex-[0_0_52px] min-h-64 py-3.5 rounded-b-2xl rounded-t-sm border-t-[3px] ${STAGE_EDGE[column.stage]} bg-sunken/60 flex flex-col items-center gap-2.5 ${isOver ? 'ring-2 ring-ink' : ''}`}>
      <span className="[writing-mode:vertical-rl] font-bold tracking-widest text-ink-2">{STAGE_LABELS[column.stage]}</span>
      <span className="num text-[13px] text-muted">{column.count}</span>
      <button type="button" onClick={onExpand} aria-label={`展开${STAGE_LABELS[column.stage]}`}
        className="mt-auto size-8 rounded-md border border-line-strong bg-surface text-ink-2 hover:text-ink cursor-pointer">›</button>
    </section>
  );
}

function DraggableCard({ idea }: { idea: Idea }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: idea.id, data: { idea } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="可拖动的想法卡片"
      className={`touch-none ${isDragging ? 'opacity-40' : ''}`}>
      <CardLink idea={idea} />
    </div>
  );
}

function CardLink({ idea }: { idea: Idea }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('idea', idea.id);
  return (
    <Link to={{ search: next.toString() }} className="block no-underline text-ink" draggable={false}>
      <CardBody idea={idea} />
    </Link>
  );
}

function CardBody({ idea, lifted }: { idea: Idea; lifted?: boolean }) {
  const stale = idea.stage === 'inbox' && isBacklog(idea.createdAt);
  const stalled = isStalled(idea);
  return (
    <div className={`flex flex-col gap-2.5 px-3.5 py-3 rounded-xl bg-surface border border-line hover:border-line-strong ${lifted ? 'shadow-xl rotate-[1.5deg]' : 'shadow-[0_1px_3px_rgb(0_0_0/0.06)]'}`}>
      <span className="font-medium text-[15px] leading-snug break-words">{idea.title}</span>
      {idea.tags.length > 0 && <span className="flex flex-wrap gap-1.5">{idea.tags.map((t) => <TagChip key={t} name={t} />)}</span>}
      <span className="flex items-center gap-2 text-xs">
        <IceBadge x10={idea.iceX10} />
        <span className={`ml-auto ${stale || stalled ? 'text-warn-ink font-medium' : 'text-muted'}`}>
          {stalled ? `${relativeAge(idea.updatedAt)}没动 · 停滞` : `${relativeAge(idea.createdAt)}${stale ? ' · 积压' : ''}`}
        </span>
      </span>
    </div>
  );
}
