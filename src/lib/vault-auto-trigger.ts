/**
 * Vault auto-backup trigger.
 * Call triggerVaultBackup() after any important data mutation.
 * Debounced 5s to coalesce rapid successive mutations.
 */

import { uploadVaultBackup } from './supabase-vault';
import { getCurrentTrackerState } from './tracker-backup';
import { supabase } from '@/integrations/supabase/client';

let _timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 5000;

export function triggerVaultBackup(reason: string) {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => void _doBackup(reason), DEBOUNCE_MS);
}

async function _doBackup(reason: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const uid = user.id;

    // Resolve merchant_id first — PostgREST .or() does NOT support subqueries,
    // so the previous single-query approach silently returned 0 orders for
    // merchant users whose rows are keyed by merchant_id, not customer_user_id.
    const { data: mp } = await supabase
      .from('merchant_profiles')
      .select('merchant_id')
      .eq('user_id', uid)
      .maybeSingle();
    const merchantId = (mp as { merchant_id?: string } | null)?.merchant_id ?? null;

    const ordersQuery = merchantId
      ? supabase
          .from('customer_orders')
          .select('*')
          .or(`customer_user_id.eq.${uid},placed_by_user_id.eq.${uid},merchant_id.eq.${merchantId}`)
      : supabase
          .from('customer_orders')
          .select('*')
          .or(`customer_user_id.eq.${uid},placed_by_user_id.eq.${uid}`);

    const [orders, accounts, ledger] = await Promise.all([
      ordersQuery.order('created_at', { ascending: false }).limit(200),
      supabase.from('cash_accounts').select('*').eq('user_id', uid),
      supabase.from('cash_ledger').select('*').eq('user_id', uid).order('ts', { ascending: false }).limit(500),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = getCurrentTrackerState(localStorage) as Record<string, any>;

    const snapshot: Record<string, unknown> = {
      _type: 'full_vault_backup',
      _ts: new Date().toISOString(),
      _trigger: reason,
      customer_orders: orders.data ?? [],
      cash_accounts_db: accounts.data ?? [],
      cash_ledger_db: ledger.data ?? [],
      batches: Array.isArray(ts.batches) ? ts.batches : [],
      trades: Array.isArray(ts.trades) ? ts.trades : [],
      customers: Array.isArray(ts.customers) ? ts.customers : [],
      suppliers: Array.isArray(ts.suppliers) ? ts.suppliers : [],
      cashAccounts: Array.isArray(ts.cashAccounts) ? ts.cashAccounts : [],
      cashLedger: Array.isArray(ts.cashLedger) ? ts.cashLedger : [],
      cashQAR: ts.cashQAR ?? 0,
      settings: ts.settings ?? {},
    };

    await uploadVaultBackup(uid, snapshot, `Auto · ${reason}`);
  } catch {
    // Non-critical
  }
}
