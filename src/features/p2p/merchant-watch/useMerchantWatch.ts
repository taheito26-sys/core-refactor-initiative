import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { groupSnapshots, onlineState, type MerchantSnapshot, type WatchedMerchant } from './merchant-watch';

export interface MerchantChoice { userNo: string; nick: string; monthOrders: number | null }

const LIST_KEY = ['p2p-watch-list'];
const SNAPS_KEY = ['p2p-watch-snapshots'];
/** How often the page asks Binance for a fresh reading while it is open. */
const LIVE_REFRESH_MS = 30_000;
const HISTORY_DAYS = 8;
const PAGE = 1000;

// The generated types predate these tables (20261009200000).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string) => supabase.from(name as any);

async function fetchSnapshots(): Promise<MerchantSnapshot[]> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString();
  const all: MerchantSnapshot[] = [];
  // The API returns at most 1000 rows per request, and a merchant polled every 5 minutes has ~2300 in 8 days.
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await table('p2p_merchant_snapshots')
      .select('*').gte('ts', since).order('ts', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as MerchantSnapshot[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function invokeTracker<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('p2p-merchant-tracker', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      const parsed = await context.clone().json().catch(() => null);
      if (parsed?.message || parsed?.error) throw new Error(parsed.message || parsed.error);
    }
    throw error;
  }
  return data as T;
}

/**
 * The merchants this user chose to follow, with their readings kept live:
 * the page asks for a fresh reading every 30 seconds while it is open, the
 * scheduled poller keeps recording when it is closed, and new readings arrive
 * over realtime. A merchant coming online shows a notice.
 */
export function useMerchantWatch() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: LIST_KEY,
    enabled: !!user?.id,
    // Waiting merchants are identified by the poller; look for the change while any are waiting.
    refetchInterval: (query) => ((query.state.data as WatchedMerchant[] | undefined)?.some(m => !m.user_no) ? 30_000 : false),
    queryFn: async (): Promise<WatchedMerchant[]> => {
      const { data, error } = await table('p2p_watched_merchants').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as WatchedMerchant[];
    },
  });

  const watched = list.data ?? [];
  const hasIdentified = watched.some(m => !!m.user_no);
  const snapshots = useQuery({
    queryKey: SNAPS_KEY,
    enabled: !!user?.id && hasIdentified,
    queryFn: fetchSnapshots,
    staleTime: 60_000,
  });

  const byMerchant = useMemo(() => groupSnapshots(snapshots.data ?? []), [snapshots.data]);

  // Readings the poller writes arrive here as they happen.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`p2p-merchant-snapshots-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'p2p_merchant_snapshots' }, (payload) => {
        const row = payload.new as MerchantSnapshot;
        qc.setQueryData<MerchantSnapshot[]>(SNAPS_KEY, (old) => (old ? [...old, row] : [row]));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, qc]);

  const refresh = useCallback(async () => {
    try { await invokeTracker({ action: 'refresh' }); } catch (err) { console.warn('[merchant-watch] refresh failed:', err); }
  }, []);

  // Live reading while the page is open and visible.
  const hasWatched = watched.length > 0;
  useEffect(() => {
    if (!user?.id || !hasWatched) return;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [user?.id, hasWatched, refresh]);

  // A notice when a followed merchant comes online.
  const lastOnline = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    if (!snapshots.data) return;
    const next = new Map<string, boolean>();
    for (const m of watched) if (m.user_no) next.set(m.user_no, onlineState(byMerchant.get(m.user_no)?.at(-1)).online);
    const prev = lastOnline.current;
    lastOnline.current = next;
    if (!prev) return;
    for (const m of watched) {
      if (m.user_no && next.get(m.user_no) && prev.get(m.user_no) === false) toast.success(`🟢 ${m.nick} is online`);
    }
  }, [snapshots.data, watched, byMerchant]);

  // A waiting merchant that was just identified listed an ad, so they are online.
  const waitingIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!list.data) return;
    const stillWaiting = new Set(list.data.filter(m => !m.user_no).map(m => m.id));
    const before = waitingIds.current;
    waitingIds.current = stillWaiting;
    if (!before) return;
    for (const m of list.data) if (m.user_no && before.has(m.id)) toast.success(`🟢 ${m.nick} is now tracked and online`);
  }, [list.data]);

  /**
   * Follows a merchant. `advNos` are the ad numbers of past orders with them,
   * which find the exact merchant when their name is masked ("Jos***").
   * When several merchants fit, nothing is added and the choices come back.
   */
  const add = useMutation({
    mutationFn: async (input: { query: string; advNos?: string[]; fiats?: string[] }) => {
      const found = await invokeTracker<{ userNo?: string; nick?: string; candidates?: MerchantChoice[]; notListed?: boolean; message?: string }>({
        action: 'resolve', query: input.query, advNos: input.advNos ?? [], fiats: input.fiats ?? [],
      });
      if (found.candidates) return { kind: 'choose' as const, candidates: found.candidates };
      if (found.notListed) {
        // Keep the request; the poller identifies the merchant once they list an ad.
        const { error } = await table('p2p_watched_merchants').insert({
          nick: input.query, pending_query: input.query, adv_nos: input.advNos ?? [], fiats: input.fiats ?? [],
        });
        if (error) throw error;
        return { kind: 'waiting' as const, nick: input.query };
      }
      const { error } = await table('p2p_watched_merchants').insert({ user_no: found.userNo, nick: found.nick });
      if (error && error.code !== '23505') throw error;
      await refresh();
      return { kind: 'added' as const, nick: found.nick as string };
    },
    onSuccess: (result) => {
      if (result.kind === 'waiting') {
        toast.info(`${result.nick} has no ad listed right now. Added to your list: tracking starts as soon as they list one.`);
        void qc.invalidateQueries({ queryKey: LIST_KEY });
        return;
      }
      if (result.kind !== 'added') return;
      toast.success(`Following ${result.nick}`);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: SNAPS_KEY });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not add this merchant'),
  });

  /** Identifies a waiting merchant right away from a pasted profile link or merchant id. */
  const identify = useMutation({
    mutationFn: async (input: { id: string; link: string }) => {
      const found = await invokeTracker<{ userNo?: string; nick?: string; candidates?: MerchantChoice[] }>({ action: 'resolve', query: input.link });
      if (!found.userNo) throw new Error('That link did not identify a single merchant');
      const { error } = await table('p2p_watched_merchants')
        .update({ user_no: found.userNo, nick: found.nick, pending_query: null }).eq('id', input.id);
      if (error?.code === '23505') {
        // Already following this merchant: the waiting entry is a duplicate.
        await table('p2p_watched_merchants').delete().eq('id', input.id);
      } else if (error) throw error;
      await refresh();
      return found.nick as string;
    },
    onSuccess: (nick) => {
      toast.success(`Tracking ${nick}`);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: SNAPS_KEY });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not identify this merchant'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await table('p2p_watched_merchants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: LIST_KEY }),
    onError: () => toast.error('Could not remove this merchant'),
  });

  return { watched, byMerchant, loading: list.isLoading, unavailable: list.isError, add, identify, remove, refresh };
}
