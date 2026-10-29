import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardColumn, ImportResult, Idea, IdeaEvent, IdeaPage, Insights, Stats, Sort } from '../shared/types';
import type { UpdateIdeaInput, StageInput } from '../shared/schema';
import type { Stage } from '../shared/stage';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string; need?: string; attemptsLeft?: number },
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

export const UNAUTHORIZED_EVENT = 'idea-funnel:unauthorized';

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return res.status === 204 ? (undefined as T) : res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 },
  },
});

export interface BoardFilter {
  tags: string[];
  scored: boolean;
}

export interface ListFilter extends BoardFilter {
  stages: Stage[];
  q: string;
  sort: Sort;
}

const qs = (entries: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const useBoard = (f: BoardFilter) =>
  useQuery({
    queryKey: ['board', f],
    queryFn: () => api<BoardColumn[]>(`/board${qs({ tags: f.tags.join(','), scored: f.scored ? '1' : undefined })}`),
  });

export const useIdeaList = (f: ListFilter) =>
  useInfiniteQuery({
    queryKey: ['ideas', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<IdeaPage>(
        `/ideas${qs({
          stage: f.stages.join(','),
          tags: f.tags.join(','),
          scored: f.scored ? '1' : undefined,
          q: f.q || undefined,
          sort: f.sort,
          cursor: pageParam ?? undefined,
        })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

export const useIdea = (id: string | null) =>
  useQuery({ queryKey: ['idea', id], queryFn: () => api<Idea>(`/ideas/${id}`), enabled: !!id });

export const useEvents = (id: string | null) =>
  useQuery({ queryKey: ['events', id], queryFn: () => api<IdeaEvent[]>(`/ideas/${id}/events`), enabled: !!id });

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') });

export const useTags = () =>
  useQuery({ queryKey: ['tags'], queryFn: () => api<{ name: string; count: number }[]>('/tags'), staleTime: 60_000 });

/** Anything that changes an idea can move it between columns, lists and counters. */
function useInvalidateIdeas() {
  const qc = useQueryClient();
  return (id?: string) => {
    for (const key of ['board', 'ideas', 'stats', 'tags', 'insights']) qc.invalidateQueries({ queryKey: [key] });
    if (id) {
      qc.invalidateQueries({ queryKey: ['idea', id] });
      qc.invalidateQueries({ queryKey: ['events', id] });
    }
  };
}

export function useCreateIdea() {
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: (body: { title: string; tags: string[] }) => api<Idea>('/ideas', { body }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateIdea() {
  const qc = useQueryClient();
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateIdeaInput }) =>
      api<Idea>(`/ideas/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (idea) => {
      qc.setQueryData(['idea', idea.id], idea);
      invalidate();
    },
  });
}

export function useMoveStage() {
  const qc = useQueryClient();
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: ({ id, ...body }: StageInput & { id: string }) => api<Idea>(`/ideas/${id}/stage`, { body }),
    // Move the card on the board right away; the refetch settles the real order.
    onMutate: async ({ id, to }) => {
      await qc.cancelQueries({ queryKey: ['board'] });
      const snapshots = qc.getQueriesData<BoardColumn[]>({ queryKey: ['board'] });
      for (const [key, cols] of snapshots) {
        if (!cols) continue;
        const card = cols.flatMap((c) => c.items).find((i) => i.id === id);
        if (!card) continue;
        qc.setQueryData<BoardColumn[]>(
          key,
          cols.map((c) =>
            c.stage === card.stage
              ? { ...c, count: c.count - 1, items: c.items.filter((i) => i.id !== id) }
              : c.stage === to
                ? { ...c, count: c.count + 1, items: [{ ...card, stage: to }, ...c.items] }
                : c,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSuccess: (idea) => qc.setQueryData(['idea', idea.id], idea),
    onSettled: (_d, _e, vars) => invalidate(vars.id),
  });
}

export function useDeleteIdea() {
  const qc = useQueryClient();
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/ideas/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: ['idea', id] });
      invalidate();
    },
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api<IdeaEvent>(`/ideas/${id}/events`, { body: { note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', id] }),
  });
}

export function useDeleteNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api<void>(`/ideas/${id}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', id] }),
  });
}

/** The viewer's time zone decides where a week starts and ends. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const useInsights = () =>
  useQuery({ queryKey: ['insights'], queryFn: () => api<Insights>(`/insights${qs({ tz: timeZone() })}`) });

export function useImport() {
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: (req: { kind: 'json'; file: unknown } | { kind: 'lines'; items: { title: string; tags: string[] }[] }) =>
      req.kind === 'json'
        ? api<ImportResult>('/import/json', { body: req.file })
        : api<ImportResult>('/import/lines', { body: { items: req.items } }),
    onSuccess: () => invalidate(),
  });
}
