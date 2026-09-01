import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useExchangeCredentials } from './useExchangeCredentials';
import { syncExchange } from '../api';
import { monthKeyToRange } from '../month-range';

/**
 * Pulls a connected exchange's P2P order history for exactly one month on
 * demand, so months outside the auto-sync's rolling trailing-90-days window
 * (see ExchangeAutoSyncBootstrap / exchange-sync's fetchBinanceP2POrders)
 * still show up once the user actually asks for that month via the Orders
 * page's month pills, instead of only ever reflecting the last ~3 months.
 *
 * Only Binance's order-history endpoint accepts an explicit date range
 * (OKX's doesn't), so this is a no-op for other exchanges.
 *
 * Each month is fetched at most once per session (tracked in a ref, not
 * React Query) -- clicking the same pill again doesn't re-hit Binance's API.
 */
export function useExchangeMonthSync(monthKey: string): void {
  const { data: credentials } = useExchangeCredentials();
  const qc = useQueryClient();
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (monthKey === 'all') return;
    const hasBinance = credentials?.some(c => c.exchange === 'binance');
    if (!hasBinance) return;

    const cacheKey = `binance:${monthKey}`;
    if (fetchedRef.current.has(cacheKey)) return;
    fetchedRef.current.add(cacheKey);

    const { startTimestamp, endTimestamp } = monthKeyToRange(monthKey);
    syncExchange('binance', 'p2p-orders', { startTimestamp, endTimestamp })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
      })
      .catch(() => {
        // Let a later click on the same month retry instead of silently never syncing again.
        fetchedRef.current.delete(cacheKey);
      });
  }, [monthKey, credentials, qc]);
}
