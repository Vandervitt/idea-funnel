import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatIce } from '../../shared/ice';
import type { Stage } from '../../shared/stage';

export const STAGE_DOT: Record<Stage, string> = {
  inbox: 'bg-stage-inbox',
  evaluating: 'bg-stage-evaluating',
  validating: 'bg-stage-validating',
  building: 'bg-stage-building',
  shipped: 'bg-stage-shipped',
  dropped: 'bg-stage-dropped',
};

export const STAGE_EDGE: Record<Stage, string> = {
  inbox: 'border-stage-inbox',
  evaluating: 'border-stage-evaluating',
  validating: 'border-stage-validating',
  building: 'border-stage-building',
  shipped: 'border-stage-shipped',
  dropped: 'border-stage-dropped',
};

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg bg-accent text-on-accent font-medium shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)] hover:opacity-90 disabled:opacity-50 cursor-pointer',
  secondary:
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg border border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink disabled:opacity-50 cursor-pointer',
  ghost: 'inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-lg text-ink-2 hover:bg-chip cursor-pointer',
  danger:
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg bg-danger text-on-danger font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer',
};

export const input =
  'h-10 px-3 rounded-lg border border-line-strong bg-surface text-ink placeholder:text-muted outline-none focus:border-ink';

const ICONS = {
  board: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  funnel: <path d="M3 4h18l-7 9v6l-4 2v-8z" />,
  chart: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  back: <path d="M15 6l-6 6 6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {ICONS[name]}
    </svg>
  );
}

export const TagChip = ({ name, onRemove }: { name: string; onRemove?: () => void }) => (
  <span className="inline-flex items-center gap-1 px-1.5 rounded-[4px] border border-line text-ink-2 text-xs leading-5">
    #{name}
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label={`移除标签 ${name}`} className="-mr-1 px-1 text-muted hover:text-ink cursor-pointer">
        ×
      </button>
    )}
  </span>
);

export function IceBadge({ x10 }: { x10: number | null }) {
  if (x10 == null) return <span className="px-1.5 rounded-[4px] border border-dashed border-line-strong text-muted text-xs leading-5">未评分</span>;
  return <span className="highlight px-1.5 num font-bold text-[13px] leading-5">ICE {formatIce(x10)}</span>;
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="px-1.5 rounded-[4px] border border-current/30 border-b-2 font-mono text-xs">{children}</kbd>
);

/** Native <dialog>: focus trap, Esc and inert background for free. */
export function Dialog({ open, onClose, labelledBy, children, className = '' }: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={`m-auto w-[min(520px,calc(100vw-32px))] rounded-xl bg-surface text-ink p-6 border border-line shadow-2xl ${className}`}>
      {open && children}
    </dialog>
  );
}

type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; text: string; tone: 'ok' | 'error'; action?: ToastAction };
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok', action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone, action }]);
    // A toast with a button stays a little longer so there is time to reach it.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="fixed z-50 bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg text-sm ${t.tone === 'ok' ? 'bg-ink text-bg' : 'bg-danger text-on-danger'}`}>
            {t.text}
            {t.action && (
              <button type="button" className="pointer-events-auto font-bold underline cursor-pointer"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
