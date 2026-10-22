import { supabase } from '@/integrations/supabase/client';

// The buyer's loan statements come from an edge function that walks the merchant's whole tracker state, so it is the
// slowest call on the customer portal. Every page that needs it goes through here: one fetch per variant, remembered
// on the device so the next visit paints instantly from the last answer while a fresh one loads, and warmed up as
// soon as the portal opens (see CustomerLayout).

export type StatementVariant = 'plain' | 'sales';

export const STATEMENT_STALE_MS = 5 * 60_000;

export const statementKey = (variant: StatementVariant, userId: string | null | undefined) =>
  variant === 'sales' ? ['c-loan-statement-history-with-sales', userId] : ['c-loan-statement-history', userId];

const storageKey = (variant: StatementVariant, userId: string) => `ch:stmt:v1:${variant}:${userId}`;

function readCache<T>(variant: StatementVariant, userId: string): { data: T; at: number } | undefined {
  try {
    const raw = localStorage.getItem(storageKey(variant, userId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { data?: T; at?: number };
    return Array.isArray(parsed.data) && typeof parsed.at === 'number' ? { data: parsed.data, at: parsed.at } : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(variant: StatementVariant, userId: string, data: unknown) {
  try {
    localStorage.setItem(storageKey(variant, userId), JSON.stringify({ data, at: Date.now() }));
  } catch {
    // storage full or unavailable: the portal just loads without the head start
  }
}

const inflight = new Map<StatementVariant, Promise<unknown[]>>();

// One call per variant at a time: the early warm-up (see warmStatements) and the page that mounts a moment later
// share the same request instead of each asking the slow function.
function fetchStatements<T>(variant: StatementVariant): Promise<T[]> {
  const running = inflight.get(variant);
  if (running) return running as Promise<T[]>;
  const fn = variant === 'sales' ? 'customer-loan-statement?sales=1' : 'customer-loan-statement';
  const call = (async () => {
    const { data, error } = await supabase.functions.invoke(fn, { method: 'GET' });
    if (error || !data || (data as { error?: string }).error) throw new Error('statement fetch failed');
    return (data as { statements: T[] }).statements ?? [];
  })();
  inflight.set(variant, call);
  const done = () => { inflight.delete(variant); };
  call.then(done, done);
  return call;
}

/**
 * Starts the statement call the moment the signed-in user is known, in parallel with the profile lookups that
 * gate the portal, and stores the answer for the pages. Only for a device that has opened the portal before, so a
 * merchant's session never makes the call.
 */
export function warmStatements(userId: string | null | undefined) {
  if (!userId || !readCache('plain', userId)) return;
  void fetchStatements('plain').then(data => writeCache('plain', userId, data)).catch(() => undefined);
  // The orders page's variant follows a moment later so the two calls don't compete.
  if (readCache('sales', userId)) {
    setTimeout(() => { void fetchStatements('sales').then(data => writeCache('sales', userId, data)).catch(() => undefined); }, 1500);
  }
}

/** Query options shared by Home, Orders, Wallet and the layout's warm-up. */
export function statementQueryOptions<T>(variant: StatementVariant, userId: string | null | undefined) {
  const cached = userId ? readCache<T[]>(variant, userId) : undefined;
  return {
    queryKey: statementKey(variant, userId),
    queryFn: async (): Promise<T[]> => {
      const statements = await fetchStatements<T>(variant);
      if (userId) writeCache(variant, userId, statements);
      return statements;
    },
    staleTime: STATEMENT_STALE_MS,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    enabled: !!userId,
  };
}
