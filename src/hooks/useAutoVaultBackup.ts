/**
 * useAutoVaultBackup
 *
 * Listens to Supabase realtime changes on key tables and triggers
 * a vault backup when data changes. Throttled to max once per 10 min.
 * Runs at the AppLayout level so it covers all pages.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { uploadVaultBackup } from '@/lib/supabase-vault';

const THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

const WATCHED_TABLES = [
  'customer_orders',
  'cash_accounts',
  'cash_ledger',
  'order_executions',
  'merchant_deals',
] as const;

export function useAutoVaultBackup() {
  const { userId } = useAuth();
  const lastBackupTs = useRef(Date.now());
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const triggerBackup = (table: string) => {
      const now = Date.now();
      if (now - lastBackupTs.current < THROTTLE_MS) return;

      // Debounce 5s — multiple changes in quick succession only trigger one backup
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(async () => {
        lastBackupTs.current = Date.now();
        try {
          // Snapshot key Supabase tables for this user
          const [orders, accounts, ledger] = await Promise.all([
            supabase.from('customer_orders').select('*').eq('customer_user_id', userId).order('created_at', { ascending: false }).limit(100),
            supabase.from('cash_accounts').select('*').eq('user_id', userId),
            supabase.from('cash_ledger').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(200),
          ]);

          const snapshot: Record<string, unknown> = {
            _type: 'supabase_vault_backup',
            _ts: new Date().toISOString(),
            _trigger: table,
            customer_orders: orders.data ?? [],
            cash_accounts: accounts.data ?? [],
            cash_ledger: ledger.data ?? [],
          };

          const counts: string[] = [];
          if ((orders.data?.length ?? 0) > 0) counts.push(`${orders.data!.length} orders`);
          if ((accounts.data?.length ?? 0) > 0) counts.push(`${accounts.data!.length} accounts`);
          if ((ledger.data?.length ?? 0) > 0) counts.push(`${ledger.data!.length} ledger`);

          await uploadVaultBackup(
            userId,
            snapshot,
            `Auto · ${table} changed · ${counts.join(', ') || 'sync'}`,
          );
        } catch {
          // Non-critical — silent fail
        }
      }, 5000);
    };

    const channel = supabase
      .channel(`vault-auto-backup-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` }, () => triggerBackup('customer_orders'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${userId}` }, () => triggerBackup('cash_accounts'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${userId}` }, () => triggerBackup('cash_ledger'))
      .subscribe();

    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
