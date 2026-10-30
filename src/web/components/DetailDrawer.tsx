import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAddNote, useDeleteIdea, useDeleteNote, useEvents, useIdea, useTags, useUpdateIdea } from '../api';
import { CLOSED_STAGES, SCORED_STAGES, STAGES, STAGE_LABELS, type Stage } from '../../shared/stage';
import { formatIce } from '../../shared/ice';
import type { Idea } from '../../shared/types';
import type { UpdateIdeaInput } from '../../shared/schema';
import { formatDate, formatDateTime } from '../format';
import { useStageMover, IceSliders } from './StageMover';
import { Markdown } from './Markdown';
import { Dialog, Icon, TagChip, btn, input, useToast, STAGE_DOT } from './ui';

export function DetailDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get('idea');
  const ref = useRef<HTMLDialogElement>(null);
  const close = () =>
    setParams((p) => {
      p.delete('idea');
      return p;
    });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) d.showModal();
    if (!id && d.open) d.close();
  }, [id]);

  return (
    <dialog ref={ref} aria-label="想法详情" onClose={close} onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => e.target === ref.current && close()}
      className="m-0 ml-auto h-dvh max-h-dvh w-full md:w-[640px] max-w-full bg-surface text-ink border-l border-line-strong shadow-2xl p-0">
      {id && <DrawerBody key={id} id={id} onClose={close} />}
    </dialog>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

function DrawerBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: idea, isError } = useIdea(id);
  if (isError) {
    return (
      <div className="p-6 flex flex-col gap-4">
        <p>找不到这个想法，可能已经被删除了。</p>
        <button type="button" className={btn.secondary} onClick={onClose}>关闭</button>
      </div>
    );
  }
  if (!idea) return <p className="p-6 text-muted">加载中…</p>;
  return <Editor idea={idea} onClose={onClose} />;
}

function Editor({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const update = useUpdateIdea();
  const mover = useStageMover();
  const toast = useToast();
  const [save, setSave] = useState<SaveState>('saved');

  // Text fields are edited locally and saved 1s after the last keystroke (or on blur).
  const [draft, setDraft] = useState({
    title: idea.title, description: idea.description, source: idea.source, hypothesis: idea.hypothesis, successCriteria: idea.successCriteria,
  });
  const pending = useRef<Partial<typeof draft>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function patch(p: UpdateIdeaInput) {
    setSave('saving');
    try {
      await update.mutateAsync({ id: idea.id, patch: p });
      setSave(Object.keys(pending.current).length ? 'dirty' : 'saved');
      return true;
    } catch (err) {
      setSave('error');
      toast(err instanceof Error ? err.message : '保存失败', 'error');
      return false;
    }
  }

  function flush() {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!Object.keys(p).length) return;
    if (p.title !== undefined && !p.title.trim()) {
      setSave('error');
      return;
    }
    pending.current = {};
    void patch(p);
  }

  function edit<K extends keyof typeof draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    pending.current[key] = value;
    setSave('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1000);
  }

  // Save whatever is left when the drawer closes.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // The plan can also be written in the stage dialog: follow the server unless there is an unsaved edit.
  useEffect(() => {
    setDraft((d) => ({
      ...d,
      ...(pending.current.hypothesis === undefined ? { hypothesis: idea.hypothesis } : {}),
      ...(pending.current.successCriteria === undefined ? { successCriteria: idea.successCriteria } : {}),
    }));
  }, [idea.hypothesis, idea.successCriteria]);

  const closed = CLOSED_STAGES.has(idea.stage);
  const needsScore = SCORED_STAGES.has(idea.stage);
  // The plan matters from 验证中 on; earlier it only shows once something was written.
  const showPlan = idea.stage === 'validating' || idea.stage === 'building' || closed || !!draft.hypothesis || !!draft.successCriteria;

  return (
    <div className="flex flex-col h-full">
      <header className="flex flex-wrap items-center gap-2.5 px-6 py-3.5 border-b border-line bg-nav">
        <label className="flex items-center gap-2 text-muted">
          阶段
          <select value={idea.stage} onChange={(e) => mover.move(idea, e.target.value as Stage)}
            className="h-9 px-2.5 rounded-lg border border-line-strong bg-surface text-ink font-medium">
            {STAGES.map((s) => (
              <option key={s} value={s} disabled={closed && s !== idea.stage && s !== 'evaluating'}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <SaveIndicator state={save} />
        <DeleteButton idea={idea} onDeleted={onClose} />
        <button type="button" onClick={onClose} aria-label="关闭" className={btn.ghost}>
          <Icon name="close" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-10 flex flex-col gap-6">
        {closed && idea.conclusion && (
          <div className={`px-4 py-3 rounded-lg border-l-4 ${idea.stage === 'shipped' ? 'bg-ok-soft text-ok border-ok' : 'bg-danger-soft text-danger border-danger'}`}>
            <span className="font-bold">{idea.stage === 'shipped' ? '已落地' : '已放弃'}：</span>
            {idea.conclusion}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <label htmlFor="detail-title" className="sr-only">标题</label>
          <input id="detail-title" value={draft.title} maxLength={200} onChange={(e) => edit('title', e.target.value)} onBlur={flush}
            className="text-[26px] leading-tight font-bold bg-transparent outline-none border-b border-transparent focus:border-line-strong" />
          {!draft.title.trim() && <p className="text-xs text-danger">标题不能为空</p>}
          <TagEditor idea={idea} onSave={(tags) => patch({ tags })} />
          <p className="text-xs text-muted">
            创建于 {formatDate(idea.createdAt)} · 进入「{STAGE_LABELS[idea.stage]}」于 {formatDate(idea.stageChangedAt)}
          </p>
        </div>

        <IceSection idea={idea} needsScore={needsScore} onScore={() => mover.score(idea)} onSave={(ice) => patch({ ice })} />

        {showPlan && (
          <section aria-labelledby="plan-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 id="plan-h" className="font-bold">验证计划</h2>
              <span className="text-xs text-muted">写下要验证什么、怎样算成功，落地或放弃时对照</span>
            </div>
            <label className="flex flex-col gap-1.5 text-muted text-[13px]">
              验证假设
              <textarea rows={2} maxLength={2000} value={draft.hypothesis} onChange={(e) => edit('hypothesis', e.target.value)} onBlur={flush}
                placeholder="比如：独立开发者愿意为这个功能付费" className={`${textArea} text-sm`} />
            </label>
            <label className="flex flex-col gap-1.5 text-muted text-[13px]">
              成功标准
              <textarea rows={2} maxLength={2000} value={draft.successCriteria} onChange={(e) => edit('successCriteria', e.target.value)} onBlur={flush}
                placeholder="比如：访谈 10 人，至少 3 人愿意预付" className={`${textArea} text-sm`} />
            </label>
          </section>
        )}

        <DescriptionEditor value={draft.description} onChange={(v) => edit('description', v)} onBlur={flush} />

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-muted text-[13px]">
            来源
            <input value={draft.source} maxLength={200} onChange={(e) => edit('source', e.target.value)} onBlur={flush}
              placeholder="比如：通勤时想到" className={`${input} text-sm`} />
          </label>
          <LinksEditor idea={idea} onSave={(links) => patch({ links })} />
        </div>

        <Timeline ideaId={idea.id} />
      </div>
    </div>
  );
}

const textArea = 'w-full px-3 py-2 rounded-lg border border-line-strong bg-surface text-ink placeholder:text-muted outline-none focus:border-ink resize-y';

function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败' }[state];
  const tone = { saved: 'text-ok', dirty: 'text-muted', saving: 'text-muted', error: 'text-danger' }[state];
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] ${tone}`} role="status">
      {state === 'saved' && <Icon name="check" size={14} />}
      {text}
    </span>
  );
}

function DeleteButton({ idea, onDeleted }: { idea: Idea; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteIdea();
  const toast = useToast();
  return (
    <>
      <button type="button" className={`${btn.ghost} ml-auto text-danger`} onClick={() => setOpen(true)}>删除</button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="del-title">
        <div className="flex flex-col gap-4">
          <h2 id="del-title" className="text-lg font-bold">删除「{idea.title}」？</h2>
          <p className="text-muted">删除后无法恢复，时间线也会一起删除。如果只是不打算做了，可以改为「放弃」。</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>取消</button>
            <button type="button" className={btn.danger} disabled={del.isPending} onClick={async () => {
              try {
                await del.mutateAsync(idea.id);
                setOpen(false);
                toast('已删除');
                onDeleted();
              } catch {
                toast('删除失败，请重试', 'error');
              }
            }}>确认删除</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function TagEditor({ idea, onSave }: { idea: Idea; onSave: (tags: string[]) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const { data: allTags } = useTags();
  const add = () => {
    const name = text.trim().replace(/^[#＃]/, '');
    setText('');
    if (!name || /[\s#＃]/.test(name) || idea.tags.includes(name)) return;
    void onSave([...idea.tags, name]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {idea.tags.map((t) => <TagChip key={t} name={t} onRemove={() => onSave(idea.tags.filter((x) => x !== t))} />)}
      <label htmlFor="tag-input" className="sr-only">添加标签</label>
      <input id="tag-input" list="tag-options" value={text} onChange={(e) => setText(e.target.value)} placeholder="+ 标签" maxLength={32}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="h-6 w-24 px-2 rounded-[4px] border border-dashed border-line-strong bg-transparent text-xs outline-none focus:border-ink" />
      <datalist id="tag-options">
        {allTags?.filter((t) => !idea.tags.includes(t.name)).map((t) => <option key={t.name} value={t.name} />)}
      </datalist>
    </div>
  );
}

function IceSection({ idea, needsScore, onScore, onSave }: {
  idea: Idea;
  needsScore: boolean;
  onScore: () => void;
  onSave: (ice: { impact: number; confidence: number; ease: number } | null) => Promise<boolean>;
}) {
  const scored = idea.iceX10 != null;
  const [value, setValue] = useState({ impact: idea.impact ?? 5, confidence: idea.confidence ?? 5, ease: idea.ease ?? 5 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    setValue({ impact: idea.impact ?? 5, confidence: idea.confidence ?? 5, ease: idea.ease ?? 5 });
  }, [idea.impact, idea.confidence, idea.ease]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <section aria-labelledby="ice-h" className="flex flex-col gap-3 px-4 py-4 rounded-lg bg-bg border border-line">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="ice-h" className="font-bold">ICE 评分</h2>
        <span className="text-xs text-muted">总分 = (I + C + E) ÷ 3，保留 1 位，只舍不入</span>
        <span className="ml-auto highlight px-1.5 num text-[28px] leading-tight font-bold" data-testid="detail-ice">{formatIce(idea.iceX10)}</span>
      </div>
      {scored ? (
        <>
          <IceSliders idPrefix="detail" value={value} onChange={(v) => {
            setValue(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => onSave(v), 500);
          }} />
          {!needsScore && (
            <button type="button" className="self-start text-xs text-muted underline cursor-pointer" onClick={() => onSave(null)}>清除评分</button>
          )}
        </>
      ) : (
        <button type="button" className={`${btn.secondary} self-start`} onClick={onScore}>打分</button>
      )}
    </section>
  );
}

function DescriptionEditor({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const [mode, setMode] = useState<'edit' | 'preview'>(value ? 'preview' : 'edit');
  return (
    <section aria-labelledby="desc-h" className="flex flex-col gap-2">
      <div className="flex items-center">
        <h2 id="desc-h" className="font-bold">描述</h2>
        <div role="tablist" aria-label="描述编辑方式" className="ml-auto flex p-0.5 rounded-lg bg-chip text-xs">
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`h-7 px-3 rounded-md cursor-pointer ${mode === m ? 'bg-surface text-ink font-medium shadow-sm' : 'text-muted'}`}>
              {m === 'edit' ? '编辑' : '预览'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'edit' ? (
        <>
          <label htmlFor="detail-desc" className="sr-only">描述（支持 Markdown）</label>
          <textarea id="detail-desc" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} rows={8}
            placeholder="支持 Markdown。写写背景、要解决的问题、验证计划…"
            className="w-full px-4 py-3 rounded-lg border border-line-strong bg-surface outline-none focus:border-ink resize-y leading-relaxed" />
        </>
      ) : value ? (
        <Markdown source={value} className="px-4 py-3 rounded-lg border border-line" testId="desc-preview" />
      ) : (
        <button type="button" onClick={() => setMode('edit')} className="px-4 py-6 rounded-lg border border-dashed border-line-strong text-muted hover:text-ink hover:border-ink-2 cursor-pointer">
          还没有描述，点击开始写
        </button>
      )}
    </section>
  );
}

function LinksEditor({ idea, onSave }: { idea: Idea; onSave: (links: string[]) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = async () => {
    const url = text.trim();
    if (!url) return;
    let ok = false;
    try {
      ok = ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      ok = false;
    }
    if (!ok) return setError('请输入 http:// 或 https:// 开头的链接');
    setError('');
    if (await onSave([...idea.links, url])) setText('');
  };
  return (
    <div className="flex flex-col gap-1.5 text-muted text-[13px]">
      <label htmlFor="link-input">链接</label>
      {idea.links.map((l) => (
        <div key={l} className="flex items-center gap-2 text-sm">
          <Icon name="link" size={14} className="shrink-0" />
          <a href={l} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-line-strong underline-offset-4 truncate">{l}</a>
          <button type="button" aria-label={`删除链接 ${l}`} onClick={() => onSave(idea.links.filter((x) => x !== l))}
            className="ml-auto px-1 text-muted hover:text-danger cursor-pointer">×</button>
        </div>
      ))}
      <input id="link-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴链接，回车添加"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
        className={`${input} text-sm`} />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function Timeline({ ideaId }: { ideaId: string }) {
  const { data: events } = useEvents(ideaId);
  const addNote = useAddNote(ideaId);
  const delNote = useDeleteNote(ideaId);
  const [note, setNote] = useState('');
  const toast = useToast();

  const describe = (e: NonNullable<typeof events>[number]) => {
    if (e.type === 'created') return '创建';
    if (e.type === 'note') return '备注';
    if (e.type === 'score') return 'ICE 评分';
    return `${e.fromStage ? STAGE_LABELS[e.fromStage] : ''} → ${e.toStage ? STAGE_LABELS[e.toStage] : ''}`;
  };

  return (
    <section aria-labelledby="tl-h" className="flex flex-col gap-3">
      <h2 id="tl-h" className="font-bold">时间线</h2>
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!note.trim()) return;
        try {
          await addNote.mutateAsync(note.trim());
          setNote('');
        } catch {
          toast('添加失败', 'error');
        }
      }}>
        <label htmlFor="note-input" className="sr-only">添加备注</label>
        <input id="note-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
          placeholder="记一笔进展，比如：访谈了 3 个人…" className={`${input} flex-1 min-w-0`} />
        <button type="submit" className={btn.secondary} disabled={addNote.isPending || !note.trim()}>添加</button>
      </form>
      <ol className="flex flex-col">
        {events?.map((e) => (
          <li key={e.id} className="grid grid-cols-[12px_minmax(0,1fr)_auto] gap-3 py-2.5 border-t border-line">
            <span aria-hidden="true" className={`mt-2 size-2 rounded-full ${e.toStage ? STAGE_DOT[e.toStage] : 'bg-line-strong'}`} />
            <span>
              <span className="font-medium">{describe(e)}</span>
              {e.note && <span className="block text-[13px] text-muted whitespace-pre-wrap break-words">{e.note}</span>}
            </span>
            <span className="flex items-start gap-1 text-xs text-muted whitespace-nowrap">
              {formatDateTime(e.createdAt)}
              {e.type === 'note' && (
                <button type="button" aria-label="删除这条备注" onClick={() => delNote.mutate(e.id)}
                  className="px-1 hover:text-danger cursor-pointer"><Icon name="trash" size={14} /></button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
