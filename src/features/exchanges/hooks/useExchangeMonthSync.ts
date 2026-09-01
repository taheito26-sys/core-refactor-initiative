import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useExchangeCredentials } from './useExchangeCredentials';
import { syncExchange } from '../api';
import { monthKeyToRange } from '../month-range';

/**
 * Module-scoped (not per-component) so Orders and Stock pages -- both call
 * this hook with the same month key -- share one cache instead of each
 * re-syncing the same month the first time it mounts.
 */
const fetchedMonths = new Set<string>();

/**
 * Pulls a connected exchange's P2P order history for exactly one month on
 * demand, so months outside the auto-sync's rolling trailing-90-days window
 * (see ExchangeAutoSyncBootstrap / exchange-sync's fetchBinanceP2POrders)
 * still show up once the user actually asks for that month via a month
 * pill (Orders or Stock page), instead of only ever reflecting the last
 * ~3 months.
 *
 * Only Binance's order-history endpoint accepts an explicit date range
 * (OKX's doesn't), so this is a no-op for other exchanges.
 *
 * Each month is fetched at most once per tab session -- clicking the same
 * pill again, or switching pages, doesn't re-hit Binance's API.
 */
export function useExchangeMonthSync(monthKey: string): void {
  const { data: credentials } = useExchangeCredentials();
  const qc = useQueryClient();

  useEffect(() => {
    if (monthKey === 'all') return;
    const hasBinance = credentials?.some(c => c.exchange === 'binance');
    if (!hasBinance) return;

    const cacheKey = `binance:${monthKey}`;
    if (fetchedMonths.has(cacheKey)) return;
    fetchedMonths.add(cacheKey);

    const { startTimestamp, endTimestamp } = monthKeyToRange(monthKey);
    syncExchange('binance', 'p2p-orders', { startTimestamp, endTimestamp })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
      })
      .catch(() => {
        // Let a later click on the same month retry instead of silently never syncing again.
        fetchedMonths.delete(cacheKey);
      });
  }, [monthKey, credentials, qc]);
}
