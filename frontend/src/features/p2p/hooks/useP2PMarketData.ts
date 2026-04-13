// P2P Market — Main Data Hook with Realtime Subscription
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toSnapshot } from '../utils/converters';
import type { P2PSnapshot, P2PHistoryPoint, MarketId } from '../types';
import { EMPTY_SNAPSHOT } from '../types';

export interface UseP2PMarketDataReturn {
  snapshot: P2PSnapshot;
  qatarSnapshot: P2PSnapshot | null;  // available when market !== 'qatar'
  history: P2PHistoryPoint[];          // 15-day price-only history
  last24hSnapshots: P2PSnapshot[];     // 24h full snapshots (for merchant depth)
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  lastUpdate: string | null;
}

export function useP2PMarketData(market: MarketId): UseP2PMarketDataReturn {
  const [snapshot, setSnapshot]           = useState<P2PSnapshot>({ ...EMPTY_SNAPSHOT, ts: Date.now() });
  const [qatarSnapshot, setQatarSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory]             = useState<P2PHistoryPoint[]>([]);
  const [last24hSnapshots, setLast24hSnapshots] = useState<P2PSnapshot[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<Error | null>(null);
  const [lastUpdate, setLastUpdate]       = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Latest snapshot for selected market
      const { data: latestRow } = await supabase
        .from('p2p_snapshots')
        .select('*')
        .eq('market', market)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setSnapshot(
        latestRow?.data
          ? toSnapshot(latestRow.data, latestRow.fetched_at)
          : { ...EMPTY_SNAPSHOT, ts: Date.now() },
      );

      // 2. Latest Qatar snapshot for cross-rate math (only when market != qatar)
      if (market !== 'qatar') {
        const { data: qatarRow } = await supabase
          .from('p2p_snapshots')
          .select('*')
          .eq('market', 'qatar')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setQatarSnapshot(
          qatarRow?.data ? toSnapshot(qatarRow.data, qatarRow.fetched_at) : null,
        );
      } else {
        setQatarSnapshot(null);
      }

      // 3. 15-day history (≤10 000 rows) — price points only
      const cutoff15d = new Date(
        Date.now() - 15 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: histRows } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff15d)
        .order('fetched_at', { ascending: true })
        .limit(10000);

      const allSnaps = (histRows || []).map(
        (row: { data: unknown; fetched_at: string }) =>
          toSnapshot(row.data, row.fetched_at),
      );

      setHistory(
        allSnaps.map(s => ({
          ts:       s.ts,
          sellAvg:  s.sellAvg,
          buyAvg:   s.buyAvg,
          spread:   s.spread,
          spreadPct: s.spreadPct,
        })),
      );

      // 4. Last 24h snapshots (≤2 500 rows) — full offers for merchant depth
      const cutoff24h = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: depthRows } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff24h)
        .order('fetched_at', { ascending: true })
        .limit(2500);

      setLast24hSnapshots(
        (depthRows || []).map(
          (row: { data: unknown; fetched_at: string }) =>
            toSnapshot(row.data, row.fetched_at),
        ),
      );

      setLastUpdate(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [market]);

  // Load on mount and market change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: reload on each INSERT for this market
  useEffect(() => {
    const channel = supabase
      .channel(`p2p-rt-${market}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'p2p_snapshots',
          filter: `market=eq.${market}`,
        },
        () => { loadData(); },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [market, loadData]);

  return {
    snapshot,
    qatarSnapshot: market !== 'qatar' ? qatarSnapshot : null,
    history,
    last24hSnapshots,
    loading,
    error,
    refresh: loadData,
    lastUpdate,
  };
}
