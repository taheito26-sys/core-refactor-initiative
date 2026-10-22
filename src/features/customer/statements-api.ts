import { supabase } from '@/integrations/supabase/client';

// The buyer's loan statements come from an edge function that walks the merchant's whole tracker state, so it is the
// slowest call on the customer portal. Nothing here is kept on the device: every answer comes from the server. The
// speed comes from starting the call as early as possible (see warmStatements), sharing one request between the
// warm-up and the page that mounts next, and a server side that answers quickly.

export type StatementVariant = 'plain' | 'sales';

// Always refetched: a page that opens never trusts an earlier answer.
export const STATEMENT_STALE_MS = 0;

export const statementKey = (variant: StatementVariant, userId: string | null | undefined) =>
  variant === 'sales' ? ['c-loan-statement-history-with-sales', userId] : ['c-loan-statement-history', userId];

const inflight = new Map<StatementVariant, Promise<unknown[]>>();

// One call per variant at a time: the early warm-up and the page that mounts a moment later share the same request.
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

const roleKey = (userId: string) => `ch:role:${userId}`;

/** Remembers that this account is a buyer, so the next visit can start the call before the profile lookups finish. */
export function rememberCustomerRole(userId: string | null | undefined) {
  try { if (userId) localStorage.setItem(roleKey(userId), 'customer'); } catch { /* storage unavailable: the call just starts later */ }
}

/**
 * Starts the statement call the moment the signed-in user is known, in parallel with the profile lookups that
 * gate the portal. Only for an account known to be a buyer, so a merchant's session never makes the call. The
 * answer is not stored: the page that mounts next joins the same request.
 */
export function warmStatements(userId: string | null | undefined) {
  let known = false;
  try { known = !!userId && localStorage.getItem(roleKey(userId)) === 'customer'; } catch { known = false; }
  if (!known) return;
  void fetchStatements('plain').catch(() => undefined);
  // The orders page's variant follows a moment later so the two calls don't compete.
  setTimeout(() => { void fetchStatements('sales').catch(() => undefined); }, 1500);
}

/** Query options shared by Home, Orders, Wallet and the layout's warm-up. */
export function statementQueryOptions<T>(variant: StatementVariant, userId: string | null | undefined) {
  return {
    queryKey: statementKey(variant, userId),
    queryFn: (): Promise<T[]> => fetchStatements<T>(variant),
    staleTime: STATEMENT_STALE_MS,
    enabled: !!userId,
  };
}
