import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useIdeaList } from '../api';
import { STAGES, STAGE_LABELS } from '../../shared/stage';
import type { Sort } from '../../shared/types';
import { formatIce } from '../../shared/ice';
import { relativeAge } from '../format';
import { Icon, STAGE_DOT, btn } from '../components/ui';
import { TagFilter, useFilterParams } from '../components/Filters';

const SORT_LABELS: Record<Sort, string> = {
  ice: 'ICE 分 · 从高到低',
  updated: '最近更新',
  updated_asc: '最久没更新',
  created: '创建时间 · 最新',
  created_asc: '创建时间 · 最早',
};

export function ListPage() {
  const f = useFilterParams();
  const [params] = useSearchParams();
  const [q, setQ] = useState(f.q);
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useIdeaList(f.list);

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    if (q === f.q) return;
    const t = setTimeout(() => f.setQ(q), 300);
    return () => clearTimeout(t);
  }, [q, f]);

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const hasFilters = f.stages.length || f.tags.length || f.scored || f.q;
  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('idea', id);
    return { search: next.toString() };
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="page-title">列表</h1>
        {data && <span className="text-muted">已加载 {items.length} 条{hasNextPage ? '，还有更多' : ''}</span>}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5 rounded-lg bg-surface border border-line">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex-[1_1_280px] flex items-center gap-2 h-10 px-3 rounded-lg border border-line-strong focus-within:border-ink">
            <Icon name="search" size={16} className="text-muted" />
            <label htmlFor="list-q" className="sr-only">搜索标题和描述</label>
            <input id="list-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100}
              placeholder="搜索标题和描述" className="flex-1 min-w-0 bg-transparent outline-none" />
          </div>
          <label className="flex items-center gap-2 text-muted">
            排序
            <select value={f.sort} onChange={(e) => f.setSort(e.target.value as Sort)}
              className="h-10 px-2.5 rounded-lg border border-line-strong bg-surface text-ink">
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted mr-1">阶段</span>
          {STAGES.map((s) => {
            const on = f.stages.includes(s);
            return (
              <button key={s} type="button" aria-pressed={on}
                onClick={() => f.setStages(on ? f.stages.filter((x) => x !== s) : [...f.stages, s])}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full cursor-pointer ${on ? 'border border-ink bg-ink text-bg font-medium' : 'border border-line-strong bg-surface text-ink-2 hover:border-ink-2'}`}>
                <span aria-hidden="true" className={`size-1.5 rounded-full ${STAGE_DOT[s]}`} />
                {STAGE_LABELS[s]}
              </button>
            );
          })}
          <span className="w-px h-5 bg-line mx-1.5" />
          <TagFilter selected={f.tags} onChange={f.setTags} />
          <label className="flex items-center gap-1.5 text-ink-2 ml-1">
            <input type="checkbox" checked={f.scored} onChange={(e) => f.setScored(e.target.checked)} className="size-4" />
            只看已评分
          </label>
          {hasFilters ? (
            <button type="button" onClick={() => { setQ(''); f.clear(); }} className="ml-auto text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:decoration-ink cursor-pointer">清空筛选</button>
          ) : null}
        </div>
      </div>

      {isError && <p className="text-danger">加载失败。<button type="button" className="underline cursor-pointer" onClick={() => refetch()}>重试</button></p>}
      {isLoading && <p className="text-muted">加载中…</p>}

      {data && (items.length === 0 ? (
        <p className="py-12 text-center text-muted">{hasFilters ? '没有符合条件的想法' : '还没有想法，在上面的输入框记下第一个吧'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line-strong">
                <th scope="col" className="px-4 py-3 font-medium">标题</th>
                <th scope="col" className="px-4 py-3 font-medium">阶段</th>
                <th scope="col" className="px-4 py-3 font-medium">标签</th>
                <th scope="col" className="px-4 py-3 font-medium">ICE</th>
                <th scope="col" className="px-4 py-3 font-medium">I / C / E</th>
                <th scope="col" className="px-4 py-3 font-medium">{f.sort.startsWith('created') ? '创建' : '更新'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-line hover:bg-nav">
                  <td className="px-4 py-3.5"><Link to={open(i.id)} className="font-medium text-ink no-underline hover:underline decoration-line-strong underline-offset-4">{i.title}</Link></td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_DOT[i.stage]}`} />{STAGE_LABELS[i.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-ink-2">{i.tags.map((t) => `#${t}`).join(' ')}</td>
                  <td className="px-4 py-3.5"><span className={i.iceX10 == null ? 'num text-muted' : 'highlight px-1 num font-bold'}>{formatIce(i.iceX10)}</span></td>
                  <td className="px-4 py-3.5 num text-muted">{i.iceX10 == null ? '未评分' : `${i.impact} / ${i.confidence} / ${i.ease}`}</td>
                  <td className="px-4 py-3.5 text-muted whitespace-nowrap">{relativeAge(f.sort.startsWith('created') ? i.createdAt : i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>{f.sort === 'ice' ? '未评分的想法排在最后 · ' : ''}筛选条件保存在网址里，刷新不会丢</span>
        {hasNextPage && (
          <button type="button" className={`${btn.secondary} ml-auto`} disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}
