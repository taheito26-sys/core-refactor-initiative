import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { useExchangeCredentials } from '../hooks/useExchangeCredentials';
import { syncExchange } from '../api';

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Don't re-sync an exchange that was synced more recently than this. */
const MIN_STALE_MS = 4 * 60 * 1000;

/**
 * Keeps connected exchanges synced without the user ever touching "Sync now":
 * syncs anything stale (or never synced) shortly after the app loads, then
 * every few minutes while it stays open. Silent -- errors just sit in
 * last_sync_error for the Settings page to show, no toasts here.
 */
export function ExchangeAutoSyncBootstrap() {
  const { userId } = useAuth();
  const { data: credentials } = useExchangeCredentials();
  const qc = useQueryClient();
  const syncingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || !credentials || credentials.length === 0) return;

    const syncStale = async () => {
      const now = Date.now();
      const due = credentials.filter((c) => {
        if (syncingRef.current.has(c.exchange)) return false;
        if (!c.last_synced_at) return true;
        return now - new Date(c.last_synced_at).getTime() > MIN_STALE_MS;
      });
      if (due.length === 0) return;

      for (const c of due) syncingRef.current.add(c.exchange);
      try {
        await Promise.all(due.map((c) => syncExchange(c.exchange, 'all').catch(() => {})));
      } finally {
        for (const c of due) syncingRef.current.delete(c.exchange);
        qc.invalidateQueries({ queryKey: ['exchange-credentials'] });
        qc.invalidateQueries({ queryKey: ['exchange-balances'] });
        qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
        qc.invalidateQueries({ queryKey: ['exchange-transfers'] });
      }
    };

    void syncStale();
    const interval = setInterval(syncStale, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
    // credentials identity changes each fetch; key off exchange+timestamp instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qc, credentials?.map((c) => `${c.exchange}:${c.last_synced_at}`).join(',')]);

  return null;
}
