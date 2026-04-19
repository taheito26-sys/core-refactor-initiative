import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MarketId, P2PSnapshot, P2PHistoryPoint, MerchantStat, EMPTY_SNAPSHOT } from '../types';
import { buildMerchantStats, buildP2PHistoryPoints, toSnapshot } from '../utils/converters';
import { refreshP2PSnapshotsIfStale } from '@/features/customer/customer-market';

export function useP2PMarketData(market: MarketId) {
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [merchantStats, setMerchantStats] = useState<MerchantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);  // ISSUE 8 FIX: expose error state
  const [latestFetchedAt, setLatestFetchedAt] = useState<string | null>(null);
  const [qatarRates, setQatarRates] = useState<{ sellAvg: number; buyAvg: number } | null>(null);

  const loadFromDb = useCallback(async () => {
    try {
      await refreshP2PSnapshotsIfStale();

      const { data: latestRow } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRow?.data) {
        setSnapshot(toSnapshot(latestRow.data, latestRow.fetched_at));
        setLatestFetchedAt(latestRow.fetched_at ?? null);
      } else {
        setSnapshot(EMPTY_SNAPSHOT);
        setLatestFetchedAt(null);
      }

      if (market !== 'qatar') {
        const { data: qatarRow } = await supabase
          .from('p2p_snapshots')
          .select('data, fetched_at')
          .eq('market', 'qatar')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (qatarRow?.data) {
          const qSnap = toSnapshot(qatarRow.data, qatarRow.fetched_at);
          setQatarRates(qSnap.sellAvg != null && qSnap.buyAvg != null ? { sellAvg: qSnap.sellAvg, buyAvg: qSnap.buyAvg } : null);
        }
      }

      const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const { data: histRowsDesc } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff)
        .order('fetched_at', { ascending: false })
        .limit(10000);

      setHistory(buildP2PHistoryPoints((histRowsDesc || []).slice().reverse() as Array<{ data: unknown; fetched_at: string }>));

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: merchantRowsDesc } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff24h)
        .order('fetched_at', { ascending: false })
        .limit(2500);

      setMerchantStats(buildMerchantStats((merchantRowsDesc || []) as Array<{ data: unknown; fetched_at: string }>));
    } catch (err) {
      // ISSUE 8 FIX: surface error to consumers so the UI can show an error
      // state instead of silently rendering empty/stale charts.
      const msg = err instanceof Error ? err.message : 'Unknown P2P load error';
      console.error('P2P load error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    setLoading(true);
    setError(null);   // ISSUE 8 FIX: reset error on market change
    loadFromDb();

    const channel = supabase
      .channel(`p2p_snapshots_${market}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'p2p_snapshots', filter: `market=eq.${market}` }, () => {
        void loadFromDb();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [market, loadFromDb]);

  return { snapshot, history, merchantStats, loading, error, latestFetchedAt, qatarRates, refresh: loadFromDb };
}
