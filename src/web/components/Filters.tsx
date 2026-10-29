import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTags, type ListFilter } from '../api';
import { STAGES, type Stage } from '../../shared/stage';
import { SORTS, type Sort } from '../../shared/types';
import { btn } from './ui';

const csv = (s: string | null) => (s ? s.split(',').filter(Boolean) : []);

/** Filters live in the URL so a refresh or shared link keeps them. */
export function useFilterParams() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    }, { replace: true });

  const tagsRaw = params.get('tags');
  const scored = params.get('scored') === '1';
  const stagesRaw = params.get('stage');
  const q = params.get('q') ?? '';
  const sortRaw = params.get('sort');

  return useMemo(() => {
    const tags = csv(tagsRaw);
    const stages = csv(stagesRaw).filter((s): s is Stage => (STAGES as readonly string[]).includes(s));
    const sort: Sort = (SORTS as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as Sort) : 'updated';
    const list: ListFilter = { tags, scored, stages, q, sort };
    return {
      tags,
      scored,
      stages,
      q,
      sort,
      board: { tags, scored },
      list,
      setTags: (t: string[]) => set('tags', t.join(',') || null),
      setScored: (v: boolean) => set('scored', v ? '1' : null),
      setStages: (s: Stage[]) => set('stage', s.join(',') || null),
      setQ: (v: string) => set('q', v.trim() || null),
      setSort: (v: Sort) => set('sort', v === 'updated' ? null : v),
      clear: () => setParams(new URLSearchParams(), { replace: true }),
    };
  }, [tagsRaw, scored, stagesRaw, q, sortRaw]);
}

export function TagFilter({ selected, onChange }: { selected: string[]; onChange: (tags: string[]) => void }) {
  const { data: tags } = useTags();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = selected.length ? `标签：${selected.map((t) => `#${t}`).join(' ')}` : '标签：全部';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}
        className={selected.length ? `${btn.secondary} !border-accent !bg-accent-soft !text-accent-ink` : btn.secondary}>
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-y-auto p-2 rounded-xl border border-line bg-surface shadow-xl">
          {!tags?.length && <p className="p-2 text-muted text-xs">还没有标签。记录时用 #标签 即可创建。</p>}
          {tags?.map((t) => (
            <label key={t.name} className="flex items-center gap-2 min-h-9 px-2 rounded-lg hover:bg-chip cursor-pointer">
              <input type="checkbox" checked={selected.includes(t.name)}
                onChange={(e) => onChange(e.target.checked ? [...selected, t.name] : selected.filter((x) => x !== t.name))} />
              <span className="flex-1">#{t.name}</span>
              <span className="font-mono text-xs text-muted">{t.count}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full mt-1 min-h-9 text-xs text-accent cursor-pointer">清空</button>
          )}
        </div>
      )}
    </div>
  );
}
