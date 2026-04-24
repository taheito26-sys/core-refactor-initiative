/**
 * useAutoVaultBackup
 *
 * Listens to Supabase realtime changes on key tables and triggers
 * a vault backup when data changes. Debounced 5s to coalesce bursts.
 * Includes: orders, cash, ledger, AND stock (tracker state with batches/trades).
 * Runs at the AppLayout level so it covers all pages.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { uploadVaultBackup } from '@/lib/supabase-vault';
import { getCurrentTrackerState } from '@/lib/tracker-backup';

export function useAutoVaultBackup() {
  const { userId } = useAuth();
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    let merchantId: string | null = null;
    let merchantChannelBound = false;

    const triggerBackup = (table: string) => {
      // Debounce 5s — multiple changes in quick succession only trigger one backup
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(async () => {
        try {
          const ordersQuery = merchantId
            ? supabase
                .from('customer_orders')
                .select('*')
                .or(`customer_user_id.eq.${userId},placed_by_user_id.eq.${userId},merchant_id.eq.${merchantId}`)
            : supabase
                .from('customer_orders')
                .select('*')
                .or(`customer_user_id.eq.${userId},placed_by_user_id.eq.${userId}`);

          const [orders, accounts, ledger] = await Promise.all([
            ordersQuery.order('created_at', { ascending: false }).limit(200),
            supabase.from('cash_accounts').select('*').eq('user_id', userId),
            supabase.from('cash_ledger').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(500),
          ]);

          // Snapshot tracker state (stock: batches, trades, customers, suppliers, cash)
          const trackerState = getCurrentTrackerState(localStorage);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ts = trackerState as Record<string, any>;
          const batches = Array.isArray(ts.batches) ? ts.batches : [];
          const trades = Array.isArray(ts.trades) ? ts.trades : [];
          const customers = Array.isArray(ts.customers) ? ts.customers : [];
          const suppliers = Array.isArray(ts.suppliers) ? ts.suppliers : [];
          const cashAccounts = Array.isArray(ts.cashAccounts) ? ts.cashAccounts : [];
          const cashLedgerLocal = Array.isArray(ts.cashLedger) ? ts.cashLedger : [];

          const snapshot: Record<string, unknown> = {
            _type: 'full_vault_backup',
            _ts: new Date().toISOString(),
            _trigger: table,
            // Supabase data
            customer_orders: orders.data ?? [],
            cash_accounts_db: accounts.data ?? [],
            cash_ledger_db: ledger.data ?? [],
            // Tracker/stock data
            batches,
            trades,
            customers,
            suppliers,
            cashAccounts,
            cashLedger: cashLedgerLocal,
            cashQAR: ts.cashQAR ?? 0,
            cashOwner: ts.cashOwner ?? '',
            settings: ts.settings ?? {},
          };

          const reasonMap: Record<string, string> = {
            customer_orders: 'order changed',
            cash_accounts: 'cash account changed',
            cash_ledger: 'cash entry changed',
            stock: 'stock changed',
          };
          await uploadVaultBackup(
            userId,
            snapshot,
            `Auto · ${reasonMap[table] ?? table}`,
          );
        } catch {
          // Non-critical — silent fail
        }
      }, 5000);
    };

    const channel = supabase
      .channel(`vault-auto-backup-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` }, () => triggerBackup('customer_orders'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `placed_by_user_id=eq.${userId}` }, () => triggerBackup('customer_orders'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${userId}` }, () => triggerBackup('cash_accounts'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${userId}` }, () => triggerBackup('cash_ledger'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_snapshots', filter: `user_id=eq.${userId}` }, () => triggerBackup('stock'))
      .subscribe();

    // Resolve merchant_id, then add a merchant-scoped order subscription so
    // merchant-side inserts/updates (where customer_user_id is the counterpart)
    // also trigger a backup for this merchant user.
    void supabase
      .from('merchant_profiles')
      .select('merchant_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const mid = (data as { merchant_id?: string } | null)?.merchant_id;
        if (!mid || merchantChannelBound) return;
        merchantId = mid;
        merchantChannelBound = true;
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'customer_orders', filter: `merchant_id=eq.${mid}` },
          () => triggerBackup('customer_orders'),
        );
      });

    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
