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
import { isBacklog, relativeAge } from '../format';
import { useStageMover } from '../components/StageMover';
import { Icon, IceBadge, STAGE_DOT, TagChip, btn } from '../components/ui';
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
        <div role="status" className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-warn-soft text-warn-ink">
          <Icon name="clock" />
          <span className="flex-[1_1_240px]">收集箱里有 <b>{stats.backlog}</b> 条想法超过 14 天没处理了，花几分钟筛一下吧。</span>
          <Link to="/review" className="inline-flex items-center min-h-9 px-3.5 rounded-lg bg-warn text-white font-medium no-underline">开始筛选</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold">看板</h1>
        <span className="text-muted">共 {total} 条</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <TagFilter selected={filter.tags} onChange={filter.setTags} />
          <button type="button" aria-pressed={filter.scored} onClick={() => filter.setScored(!filter.scored)}
            className={filter.scored ? `${btn.secondary} !border-accent !bg-accent-soft !text-accent-ink` : btn.secondary}>
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
            <div className="hidden md:flex gap-3.5 items-start overflow-x-auto pb-2">
              {OPEN_STAGES.map((s) => <Column key={s} column={byStage.get(s)!} />)}
              {FOLDED_STAGES.map((s) =>
                expanded.has(s) ? (
                  <Column key={s} column={byStage.get(s)!} onFold={() => setExpanded((x) => new Set([...x].filter((y) => y !== s)))} />
                ) : (
                  <FoldedColumn key={s} column={byStage.get(s)!} onExpand={() => setExpanded((x) => new Set(x).add(s))} />
                ),
              )}
            </div>
            <DragOverlay>{dragging && <CardBody idea={dragging} lifted />}</DragOverlay>
          </DndContext>

          {/* Mobile: one stage at a time. */}
          <div className="md:hidden flex flex-col gap-3">
            <div role="tablist" aria-label="阶段" className="flex gap-2 overflow-x-auto -mx-4 px-4">
              {[...OPEN_STAGES, ...FOLDED_STAGES].map((s) => (
                <button key={s} type="button" role="tab" aria-selected={mobileStage === s} onClick={() => setMobileStage(s)}
                  className={`shrink-0 h-9 px-3.5 rounded-full cursor-pointer ${mobileStage === s ? 'bg-ink text-bg font-medium' : 'border border-line-strong bg-surface text-ink-2'}`}>
                  {STAGE_LABELS[s]} {byStage.get(s)?.count ?? 0}
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

function Column({ column, onFold }: { column: BoardColumn; onFold?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  return (
    <section ref={setNodeRef} aria-label={STAGE_LABELS[column.stage]}
      className={`flex-[1_0_236px] flex flex-col gap-2.5 p-3 rounded-xl bg-sunken min-h-40 transition-shadow ${isOver ? 'ring-2 ring-accent' : ''}`}>
      <header className="flex items-center gap-2 px-1">
        <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_DOT[column.stage]}`} />
        <h2 className="font-bold">{STAGE_LABELS[column.stage]}</h2>
        <span className="font-mono text-xs text-muted">{column.count}</span>
        {onFold && <button type="button" onClick={onFold} className="ml-auto text-xs text-muted cursor-pointer">折叠</button>}
      </header>
      {column.items.map((i) => <DraggableCard key={i.id} idea={i} />)}
      {column.count > column.items.length && (
        <Link to={`/list?stage=${column.stage}`} className="text-xs text-accent px-1">还有 {column.count - column.items.length} 条，去列表查看</Link>
      )}
    </section>
  );
}

function FoldedColumn({ column, onExpand }: { column: BoardColumn; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  return (
    <section ref={setNodeRef} aria-label={`${STAGE_LABELS[column.stage]}（已折叠）`}
      className={`flex-[0_0_52px] min-h-64 py-3.5 rounded-xl bg-sunken flex flex-col items-center gap-2.5 ${isOver ? 'ring-2 ring-accent' : ''}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_DOT[column.stage]}`} />
      <span className="[writing-mode:vertical-rl] font-bold tracking-widest">{STAGE_LABELS[column.stage]}</span>
      <span className="font-mono text-xs text-muted">{column.count}</span>
      <button type="button" onClick={onExpand} aria-label={`展开${STAGE_LABELS[column.stage]}`}
        className="mt-auto size-8 rounded-lg bg-surface text-ink-2 cursor-pointer">›</button>
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
  return (
    <div className={`flex flex-col gap-2.5 px-3.5 py-3 rounded-[10px] bg-surface border border-line hover:border-line-strong ${lifted ? 'shadow-xl rotate-1' : 'shadow-sm'}`}>
      <span className="font-medium leading-snug break-words">{idea.title}</span>
      {idea.tags.length > 0 && <span className="flex flex-wrap gap-1.5">{idea.tags.map((t) => <TagChip key={t} name={t} />)}</span>}
      <span className="flex items-center gap-2 text-xs">
        <IceBadge x10={idea.iceX10} />
        <span className={`ml-auto ${stale ? 'text-warn-ink font-medium' : 'text-muted'}`}>
          {relativeAge(idea.createdAt)}{stale && ' · 积压'}
        </span>
      </span>
    </div>
  );
}
