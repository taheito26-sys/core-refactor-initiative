/** A watch that has not completed a Binance check for this long is reported as not working. */
export const WATCH_STALE_MS = 5 * 60 * 1000;

export type P2PWatchHealth = 'off' | 'starting' | 'ok' | 'error' | 'stale';

interface WatchLike {
  enabled: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  updated_at: string;
}

/** How the alert switch should describe the server's checks. */
export function p2pWatchHealth(watch: WatchLike | null | undefined, now: number): P2PWatchHealth {
  if (!watch?.enabled) return 'off';
  if (watch.last_error) return 'error';
  const lastOk = watch.last_ok_at ? new Date(watch.last_ok_at).getTime() : NaN;
  if (Number.isFinite(lastOk)) return now - lastOk > WATCH_STALE_MS ? 'stale' : 'ok';
  const since = new Date(watch.updated_at).getTime();
  return Number.isFinite(since) && now - since > WATCH_STALE_MS ? 'stale' : 'starting';
}

/** Deep link to the order in Binance; Android opens the Binance app when it is installed. */
export function binanceOrderUrl(orderNumber: string): string {
  return `https://p2p.binance.com/en/fiatOrderDetail?orderNo=${encodeURIComponent(orderNumber)}`;
}
