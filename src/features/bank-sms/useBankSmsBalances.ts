import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { applySmsBatch, latestSmsTimestamp, loadCache, saveCache, type BankBalanceCache } from './cache';
import { fetchBalanceSms, getSmsPermission, isSmsBalanceSupported, onSmsReceived, requestSmsPermission } from './native';

// First sync looks back this far; later syncs resume from the newest cached SMS.
const INITIAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function useBankSmsBalances() {
  const supported = isSmsBalanceSupported();
  const [cache, setCache] = useState<BankBalanceCache>(() => loadCache());
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [syncing, setSyncing] = useState(false);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const sync = useCallback(async () => {
    if (!supported) return;
    setSyncing(true);
    try {
      const current = cacheRef.current;
      const since = latestSmsTimestamp(current) || Date.now() - INITIAL_LOOKBACK_MS;
      const messages = await fetchBalanceSms(since);
      const next = applySmsBatch(current, messages);
      if (next !== current) {
        saveCache(next);
        setCache(next);
      }
    } catch {
      // Permission revoked or inbox unreadable: keep the cached balances.
    } finally {
      setSyncing(false);
    }
  }, [supported]);

  const requestAccess = useCallback(async () => {
    if (!supported) return;
    const state = await requestSmsPermission();
    setPermission(state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt');
    if (state === 'granted') await sync();
  }, [supported, sync]);

  const granted = permission === 'granted';

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    (async () => {
      const state = await getSmsPermission().catch(() => 'prompt' as const);
      if (cancelled) return;
      setPermission(state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt');
      if (state !== 'granted') return;
      void sync();
      const received = await onSmsReceived(() => void sync());
      const resumed = await App.addListener('resume', () => void sync());
      if (cancelled) {
        void received.remove();
        void resumed.remove();
        return;
      }
      handles.push(received, resumed);
    })();

    return () => {
      cancelled = true;
      handles.forEach((h) => void h.remove());
    };
  }, [supported, granted, sync]);

  return { supported, permission, syncing, balances: Object.values(cache), sync, requestAccess };
}
