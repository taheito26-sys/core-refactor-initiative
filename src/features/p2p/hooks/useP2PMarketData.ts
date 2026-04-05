import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MarketId, P2PSnapshot, P2PHistoryPoint, MerchantStat, EMPTY_SNAPSHOT } from '../types';
import { toSnapshot, toFiniteNumber, toOffer } from '../utils/converters';

export function useP2PMarketData(market: MarketId) {
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [merchantStats, setMerchantStats] = useState<MerchantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestFetchedAt, setLatestFetchedAt] = useState<string | null>(null);
  const [qatarRates, setQatarRates] = useState<{ sellAvg: number; buyAvg: number } | null>(null);

  const loadFromDb = useCallback(async () => {
    try {
      const { data: latestRow } = await supabase
        .from('p2p_snapshots')
        .select('*')
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
      const { data: histRowsDesc } = await (supabase
        .from('p2p_snapshots') as any)
        .select('fetched_at, ts_val:data->>ts, sell_avg:data->>sellAvg, buy_avg:data->>buyAvg, spread_val:data->>spread, spread_pct_val:data->>spreadPct')
        .eq('market', market)
        .gte('fetched_at', cutoff)
        .order('fetched_at', { ascending: false })
        .limit(10000);

      const historyPoints = (histRowsDesc || []).reverse().flatMap((row: any) => {
        const ts = row.fetched_at ? new Date(row.fetched_at).getTime() : toFiniteNumber(row.ts_val);
        if (!ts) return [];
        return [{
          ts: ts < 1e12 ? ts * 1000 : ts,
          sellAvg: toFiniteNumber(row.sell_avg),
          buyAvg: toFiniteNumber(row.buy_avg),
          spread: toFiniteNumber(row.spread_val),
          spreadPct: toFiniteNumber(row.spread_pct_val),
        }];
      });
      setHistory(historyPoints);

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: merchantRowsDesc } = await (supabase
        .from('p2p_snapshots') as any)
        .select('sell_offers:data->sellOffers, buy_offers:data->buyOffers')
        .eq('market', market)
        .gte('fetched_at', cutoff24h)
        .order('fetched_at', { ascending: false })
        .limit(2500);

      const rows = (merchantRowsDesc || []) as any[];
      const marketPolls = Math.max(rows.length, 1);
      const merchantMap = new Map<string, { appearances: number; totalAvailable: number; sampleCount: number; maxAvailable: number }>();

      for (const row of rows) {
        const seenInSnapshot = new Set<string>();
        const offers = [...(row.sell_offers || []), ...(row.buy_offers || [])].map(toOffer).filter(o => o !== null);
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

      setMerchantStats(Array.from(merchantMap.entries()).map(([nick, stat]) => ({
        nick,
        appearances: stat.appearances,
        availabilityRatio: stat.appearances / marketPolls,
        avgAvailable: stat.sampleCount > 0 ? stat.totalAvailable / stat.sampleCount : 0,
        maxAvailable: stat.maxAvailable,
      })));
    } catch (err) {
      console.error('P2P load error:', err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    setLoading(true);
    loadFromDb();

    const channel = supabase
      .channel(`p2p_snapshots_${market}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'p2p_snapshots', filter: `market=eq.${market}` }, () => {
        void loadFromDb();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [market, loadFromDb]);

  return { snapshot, history, merchantStats, loading, latestFetchedAt, qatarRates, refresh: loadFromDb };
}