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
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-full bg-accent text-on-accent font-medium hover:opacity-85 disabled:opacity-50 cursor-pointer',
  secondary:
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-full border border-line-strong bg-surface text-ink hover:border-ink disabled:opacity-50 cursor-pointer',
  ghost: 'inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-lg text-ink-2 hover:bg-chip cursor-pointer',
  danger:
    'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-full bg-danger text-on-danger font-medium hover:opacity-85 disabled:opacity-50 cursor-pointer',
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

// Brand mark: "i" and "f" sitting in the two loops of an infinity sign. Keep in sync with public/favicon.svg.
const INFINITY = 'M58.5 32L58.39 34.21L58.07 36.36L57.55 38.39L56.85 40.27L55.99 41.93L55.01 43.37L53.92 44.57L52.77 45.52L51.58 46.22L50.36 46.69L49.14 46.94L47.93 46.99L46.75 46.85L45.6 46.56L44.49 46.13L43.42 45.58L42.4 44.93L41.41 44.19L40.47 43.37L39.57 42.49L38.71 41.56L37.88 40.59L37.07 39.58L36.3 38.54L35.55 37.48L34.82 36.41L34.1 35.32L33.39 34.22L32.69 33.11L32 32L31.31 30.89L30.61 29.78L29.9 28.68L29.18 27.59L28.45 26.52L27.7 25.46L26.93 24.42L26.12 23.41L25.29 22.44L24.43 21.51L23.53 20.63L22.59 19.81L21.6 19.07L20.58 18.42L19.51 17.87L18.4 17.44L17.25 17.15L16.07 17.01L14.86 17.06L13.64 17.31L12.42 17.78L11.23 18.48L10.08 19.43L8.99 20.63L8.01 22.07L7.15 23.73L6.45 25.61L5.93 27.64L5.61 29.79L5.5 32L5.61 34.21L5.93 36.36L6.45 38.39L7.15 40.27L8.01 41.93L8.99 43.37L10.08 44.57L11.23 45.52L12.42 46.22L13.64 46.69L14.86 46.94L16.07 46.99L17.25 46.85L18.4 46.56L19.51 46.13L20.58 45.58L21.6 44.93L22.59 44.19L23.53 43.37L24.43 42.49L25.29 41.56L26.12 40.59L26.93 39.58L27.7 38.54L28.45 37.48L29.18 36.41L29.9 35.32L30.61 34.22L31.31 33.11L32 32L32.69 30.89L33.39 29.78L34.1 28.68L34.82 27.59L35.55 26.52L36.3 25.46L37.07 24.42L37.88 23.41L38.71 22.44L39.57 21.51L40.47 20.63L41.41 19.81L42.4 19.07L43.42 18.42L44.49 17.87L45.6 17.44L46.75 17.15L47.93 17.01L49.14 17.06L50.36 17.31L51.58 17.78L52.77 18.48L53.92 19.43L55.01 20.63L55.99 22.07L56.85 23.73L57.55 25.61L58.07 27.64L58.39 29.79Z';

export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" className="fill-ink" />
      <g fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="stroke-bg">
        <path d={INFINITY} />
        <path d="M16.5 33.18V39.5" />
        <path d="M51.7 26.7c-1.4-2.2-5.4-2.6-5.4 1.6V39.5M43.3 31.1h6.6" />
      </g>
      <circle cx="16.5" cy="27.26" r="2.18" className="fill-bg" />
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
      className={`m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl bg-surface text-ink p-6 border border-line shadow-2xl ${className}`}>
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
