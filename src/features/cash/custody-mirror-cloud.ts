import { supabase } from '@/integrations/supabase/client';
import { rowToAccount, rowToEntry, upsertLedgerEntriesToCloud } from '@/lib/cash-sync';
import { planCustodyMirror, type CustodyMirrorStatus } from './custody-mirror';

/**
 * Brings every mirror custody account of the signed-in merchant up to the holder's balance by
 * writing the adjusting entry straight to the cash tables. It reads the cloud rows rather than
 * any page's state, so it can run on any screen; the Cash Management page picks the entry up
 * the next time it loads. Returns how many entries were written.
 */
export async function applyCustodyMirrorToCloud(statuses: CustodyMirrorStatus[]): Promise<number> {
  const mirrorIds = statuses.filter((s) => s.role === 'mirror').map((s) => s.account_id);
  if (mirrorIds.length === 0) return 0;

  const table = (name: string) => supabase.from(name as never) as unknown as {
    select: (cols: string) => { in: (col: string, values: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }> };
  };
  const [accounts, ledger] = await Promise.all([
    table('cash_accounts').select('*').in('id', mirrorIds),
    table('cash_ledger').select('*').in('account_id', mirrorIds),
  ]);
  if (accounts.error) throw accounts.error;
  if (ledger.error) throw ledger.error;

  const planned = planCustodyMirror(
    (accounts.data ?? []).map(rowToAccount),
    (ledger.data ?? []).map(rowToEntry),
    statuses,
    Date.now(),
  );
  await upsertLedgerEntriesToCloud(planned);
  return planned.length;
}
