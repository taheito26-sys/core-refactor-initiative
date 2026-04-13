import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EMPTY_SNAPSHOT, type MarketId, type MerchantStat, type P2PHistoryPoint, type P2PSnapshot } from '../types';
import { toSnapshot, toOffer } from '../utils/converters';

export interface UseP2PMarketDataReturn {
  snapshot: P2PSnapshot;
  qatarSnapshot: P2PSnapshot | null;
  history: P2PHistoryPoint[];
  last24hSnapshots: P2PSnapshot[];
  merchantStats: MerchantStat[];
  loading: boolean;
  error: string | null;
  latestFetchedAt: string | null;
  qatarRates: { sellAvg: number; buyAvg: number } | null;
  refresh: () => Promise<void>;
}

export function useP2PMarketData(market: MarketId): UseP2PMarketDataReturn {
  const [snapshot, setSnapshot] = useState<P2PSnapshot>({ ...EMPTY_SNAPSHOT });
  const [qatarSnapshot, setQatarSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [last24hSnapshots, setLast24hSnapshots] = useState<P2PSnapshot[]>([]);
  const [merchantStats, setMerchantStats] = useState<MerchantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestFetchedAt, setLatestFetchedAt] = useState<string | null>(null);

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
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
        setSnapshot({ ...EMPTY_SNAPSHOT });
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

        setQatarSnapshot(qatarRow?.data ? toSnapshot(qatarRow.data, qatarRow.fetched_at) : null);
      } else {
        setQatarSnapshot(null);
      }

      const cutoff15d = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const { data: histRows } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff15d)
        .order('fetched_at', { ascending: true })
        .limit(10000);

      const parsedHistory = (histRows || []).map((row: { data: unknown; fetched_at: string }) => {
        const snap = toSnapshot(row.data, row.fetched_at);
        return {
          ts: snap.ts,
          sellAvg: snap.sellAvg,
          buyAvg: snap.buyAvg,
          spread: snap.spread,
          spreadPct: snap.spreadPct,
        };
      });
      setHistory(parsedHistory);

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: depthRows } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', market)
        .gte('fetched_at', cutoff24h)
        .order('fetched_at', { ascending: true })
        .limit(2500);

      const parsedDepth = (depthRows || []).map((row: { data: unknown; fetched_at: string }) => toSnapshot(row.data, row.fetched_at));
      setLast24hSnapshots(parsedDepth);

      const merchantMap = new Map<string, { appearances: number; totalAvailable: number; sampleCount: number; maxAvailable: number }>();
      for (const snap of parsedDepth) {
        const seenInSnapshot = new Set<string>();
        const offers = [...snap.sellOffers, ...snap.buyOffers]
          .map(toOffer)
          .filter((offer): offer is NonNullable<ReturnType<typeof toOffer>> => offer !== null);

        for (const offer of offers) {
          const nick = offer.nick.trim();
          if (!nick) continue;

          let stat = merchantMap.get(nick);
          if (!stat) {
            stat = { appearances: 0, totalAvailable: 0, sampleCount: 0, maxAvailable: 0 };
            merchantMap.set(nick, stat);
          }

          if (!seenInSnapshot.has(nick)) {
            stat.appearances += 1;
            seenInSnapshot.add(nick);
          }

          stat.totalAvailable += offer.available;
          stat.sampleCount += 1;
          stat.maxAvailable = Math.max(stat.maxAvailable, offer.available);
        }
      }

      const polls = Math.max(parsedDepth.length, 1);
      setMerchantStats(
        Array.from(merchantMap.entries()).map(([nick, stat]) => ({
          nick,
          appearances: stat.appearances,
          availabilityRatio: stat.appearances / polls,
          avgAvailable: stat.sampleCount > 0 ? stat.totalAvailable / stat.sampleCount : 0,
          maxAvailable: stat.maxAvailable,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown P2P load error';
      console.error('P2P load error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    void loadFromDb();

    const channel = supabase
      .channel(`p2p_snapshots_${market}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'p2p_snapshots', filter: `market=eq.${market}` },
        () => {
          void loadFromDb();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [market, loadFromDb]);

  const qatarRates = qatarSnapshot?.sellAvg != null && qatarSnapshot.buyAvg != null
    ? { sellAvg: qatarSnapshot.sellAvg, buyAvg: qatarSnapshot.buyAvg }
    : null;

  return {
    snapshot,
    qatarSnapshot,
    history,
    last24hSnapshots,
    merchantStats,
    loading,
    error,
    latestFetchedAt,
    qatarRates,
    refresh: loadFromDb,
  };
}
