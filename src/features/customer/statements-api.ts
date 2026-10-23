import { supabase } from '@/integrations/supabase/client';

// Statement responses are fetched fresh. Only concurrent requests for the same account and variant share work.

export type StatementVariant = 'plain' | 'sales';

// Always refetched: a page that opens never trusts an earlier answer.
export const STATEMENT_STALE_MS = 0;

export const statementKey = (variant: StatementVariant, userId: string | null | undefined) =>
  variant === 'sales' ? ['c-loan-statement-history-with-sales', userId] : ['c-loan-statement-history', userId];

const inflight = new Map<string, Promise<unknown[]>>();

// Concurrent consumers share one request; the response is discarded from this map as soon as it settles.
function fetchStatements<T>(variant: StatementVariant, userId: string): Promise<T[]> {
  const key = JSON.stringify([userId, variant]);
  const running = inflight.get(key);
  if (running) return running as Promise<T[]>;
  const fn = variant === 'sales' ? 'customer-loan-statement?sales=1' : 'customer-loan-statement';
  const call = (async () => {
    const { data, error } = await supabase.functions.invoke(fn, { method: 'GET' });
    if (error || !data || (data as { error?: string }).error) throw new Error('statement fetch failed');
    return (data as { statements: T[] }).statements ?? [];
  })();
  inflight.set(key, call);
  const done = () => { inflight.delete(key); };
  call.then(done, done);
  return call;
}

/** Query options shared by Home, Orders and Wallet. */
export function statementQueryOptions<T>(variant: StatementVariant, userId: string | null | undefined) {
  return {
    queryKey: statementKey(variant, userId),
    queryFn: (): Promise<T[]> => userId ? fetchStatements<T>(variant, userId) : Promise.resolve([]),
    staleTime: STATEMENT_STALE_MS,
    enabled: !!userId,
  };
}
