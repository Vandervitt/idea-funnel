import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router';
import { useCreateIdea, useStats } from '../api';
import { parseCapture } from '../../shared/capture';
import { Icon, Kbd, TagChip, btn, useToast } from './ui';
import { DetailDrawer } from './DetailDrawer';

const NAV = [
  { to: '/', label: '看板', icon: 'board' },
  { to: '/list', label: '列表', icon: 'list' },
  { to: '/review', label: '每周筛选', icon: 'funnel' },
  { to: '/insights', label: '概览', icon: 'chart' },
  { to: '/settings', label: '设置', icon: 'settings' },
] as const;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function Layout() {
  const { data: stats } = useStats();
  return (
    <div className="min-h-dvh md:flex">
      <nav aria-label="主导航" className="hidden md:flex w-56 shrink-0 flex-col gap-0.5 px-3 py-6 bg-rail backdrop-blur-xl border-r border-line text-rail-ink sticky top-0 h-dvh">
        <div className="flex items-center gap-2.5 px-3 pb-7">
          <Icon name="funnel" size={22} className="text-rail-mark" />
          <span className="font-display font-semibold text-[19px] tracking-tight">Idea Funnel</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end
            className={({ isActive }) =>
              `flex items-center gap-2.5 min-h-10 px-3 rounded-lg no-underline ${isActive ? 'bg-rail-hover text-rail-ink font-semibold' : 'text-rail-muted hover:bg-rail-hover hover:text-rail-ink'}`}>
            <Icon name={n.icon} />
            {n.label}
            {n.to === '/review' && !!stats?.inbox && (
              <span className="ml-auto min-w-6 text-center px-1.5 rounded-full bg-rail-mark text-rail-mark-ink num text-xs font-bold" aria-label={`收集箱 ${stats.inbox} 条`}>
                {stats.inbox}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 min-w-0 px-4 md:px-10 pt-4 md:pt-7 pb-24 md:pb-12 flex flex-col gap-6">
        <CaptureBar />
        <Outlet />
      </main>

      <nav aria-label="底部导航" className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 px-2 pt-1.5 pb-[max(10px,env(safe-area-inset-bottom))] bg-rail backdrop-blur-xl border-t border-line">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end
            className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 min-h-12 text-[11px] no-underline ${isActive ? 'text-rail-ink font-semibold' : 'text-rail-muted'}`}>
            <Icon name={n.icon} size={20} />
            {n.to === '/review' ? '筛选' : n.label}
          </NavLink>
        ))}
      </nav>

      <DetailDrawer />
    </div>
  );
}

function CaptureBar() {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const create = useCreateIdea();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const parsed = parseCapture(text);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function submit() {
    if (!parsed.title) {
      toast('先写点内容再保存', 'error');
      return;
    }
    if (parsed.title.length > 200) {
      toast('标题最多 200 字，多的内容可以记在描述里', 'error');
      return;
    }
    try {
      const idea = await create.mutateAsync(parsed);
      setText('');
      toast('已记到收集箱', 'ok', {
        label: '打开',
        onClick: () => setParams((p) => {
          p.set('idea', idea.id);
          return p;
        }),
      });
    } catch {
      toast('保存失败，请重试', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form aria-label="快速记录" onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex items-center gap-3 pl-4 pr-1.5 py-1.5 bg-surface border border-line-strong rounded-2xl shadow-[0_8px_24px_-16px_rgb(0_0_0/0.25)] focus-within:border-ink">
        <Icon name="plus" className="text-muted shrink-0" />
        <label htmlFor="capture" className="sr-only">记下一个想法</label>
        <input id="capture" ref={ref} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          placeholder="记下一个想法，用 #标签 分类，回车保存"
          className="flex-1 min-w-0 h-11 bg-transparent outline-none text-base placeholder:text-muted" />
        <span className="hidden sm:inline text-muted"><Kbd>N</Kbd></span>
        <button type="submit" className={btn.primary} disabled={create.isPending}>保存</button>
      </form>
      {text.trim() && (
        <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted" aria-live="polite">
          将会保存为：<span className="text-ink font-medium">{parsed.title || '（还没有标题）'}</span>
          {parsed.tags.map((t) => <TagChip key={t} name={t} />)}
        </p>
      )}
    </div>
  );
}
