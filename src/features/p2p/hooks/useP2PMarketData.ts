import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MarketId, P2PSnapshot, P2PHistoryPoint, MerchantStat, EMPTY_SNAPSHOT, DERIVED_EGYPT_MARKETS, baseMarketId } from '../types';
import { toSnapshot, toFiniteNumber, toOffer, filterSnapshotByPaymentMethods } from '../utils/converters';

export function useP2PMarketData(market: MarketId) {
  const [snapshot, setSnapshot] = useState<P2PSnapshot | null>(null);
  const [history, setHistory] = useState<P2PHistoryPoint[]>([]);
  const [merchantStats, setMerchantStats] = useState<MerchantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestFetchedAt, setLatestFetchedAt] = useState<string | null>(null);
  const [qatarRates, setQatarRates] = useState<{ sellAvg: number; buyAvg: number } | null>(null);

  const isDerived = DERIVED_EGYPT_MARKETS.includes(market);
  const dbMarket = baseMarketId(market);

  const applyVariantFilter = useCallback((snap: P2PSnapshot): P2PSnapshot => {
    if (market === 'egypt_vcash') {
      return filterSnapshotByPaymentMethods(snap, new Set(['vodafone_cash']));
    }
    if (market === 'egypt_bank') {
      return filterSnapshotByPaymentMethods(
        snap,
        new Set(['instapay', 'bank']),
        new Set(['wallet']) // exclude wallet-only
      );
    }
    // egypt_fx_qar uses same offers as egypt base, no filtering
    return snap;
  }, [market]);

  const loadFromDb = useCallback(async () => {
    try {
      const { data: latestRow } = await supabase
        .from('p2p_snapshots')
        .select('*')
        .eq('market', dbMarket)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRow?.data) {
        const baseSnap = toSnapshot(latestRow.data, latestRow.fetched_at);
        setSnapshot(applyVariantFilter(baseSnap));
        setLatestFetchedAt(latestRow.fetched_at ?? null);
      } else {
        setSnapshot(EMPTY_SNAPSHOT);
        setLatestFetchedAt(null);
      }

      // Always fetch Qatar rates for cross-market comparisons
      if (dbMarket !== 'qatar') {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('p2p_snapshots') as any)
        .select('fetched_at, ts_val:data->>ts, sell_avg:data->>sellAvg, buy_avg:data->>buyAvg, spread_val:data->>spread, spread_pct_val:data->>spreadPct')
        .eq('market', dbMarket)
        .gte('fetched_at', cutoff)
        .order('fetched_at', { ascending: false })
        .limit(10000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('p2p_snapshots') as any)
        .select('sell_offers:data->sellOffers, buy_offers:data->buyOffers')
        .eq('market', dbMarket)
        .gte('fetched_at', cutoff24h)
        .order('fetched_at', { ascending: false })
        .limit(2500);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (merchantRowsDesc || []) as any[];
      const marketPolls = Math.max(rows.length, 1);
      const merchantMap = new Map<string, {
        appearances: number;
        totalAvailable: number;
        sampleCount: number;
        maxAvailable: number;
        // latest known intel
        merchant30dTrades: number | null;
        merchant30dCompletion: number | null;
        advertiserMessage: string | null;
        feedbackCount: number | null;
        avgReleaseMinutes: number | null;
        avgPayMinutes: number | null;
        allTrades: number | null;
        tradeType: string | null;
        onlineStatus: 'online' | 'offline' | 'unknown' | null;
        paymentMethodCategories: Set<string>;
      }>();

      for (const row of rows) {
        const seenInSnapshot = new Set<string>();
        const offers = [...(row.sell_offers || []), ...(row.buy_offers || [])].map(toOffer).filter(o => o !== null);
        for (const offer of offers) {
          const nick = offer.nick.trim();
          if (!nick) continue;
          let stat = merchantMap.get(nick);
          if (!stat) {
            stat = {
              appearances: 0, totalAvailable: 0, sampleCount: 0, maxAvailable: 0,
              merchant30dTrades: null, merchant30dCompletion: null,
              advertiserMessage: null, feedbackCount: null,
              avgReleaseMinutes: null, avgPayMinutes: null,
              allTrades: null, tradeType: null, onlineStatus: null,
              paymentMethodCategories: new Set(),
            };
            merchantMap.set(nick, stat);
          }
          if (!seenInSnapshot.has(nick)) {
            stat.appearances += 1;
            seenInSnapshot.add(nick);
          }
          stat.totalAvailable += offer.available;
          stat.sampleCount += 1;
          stat.maxAvailable = Math.max(stat.maxAvailable, offer.available);
          // Update intel with latest non-null values
          if (offer.merchant30dTrades != null) stat.merchant30dTrades = offer.merchant30dTrades;
          if (offer.merchant30dCompletion != null) stat.merchant30dCompletion = offer.merchant30dCompletion;
          if (offer.advertiserMessage != null) stat.advertiserMessage = offer.advertiserMessage;
          if (offer.feedbackCount != null) stat.feedbackCount = offer.feedbackCount;
          if (offer.avgReleaseMinutes != null) stat.avgReleaseMinutes = offer.avgReleaseMinutes;
          if (offer.avgPayMinutes != null) stat.avgPayMinutes = offer.avgPayMinutes;
          if (offer.allTrades != null) stat.allTrades = offer.allTrades;
          if (offer.tradeType != null) stat.tradeType = offer.tradeType;
          if (offer.onlineStatus != null) stat.onlineStatus = offer.onlineStatus;
          for (const cat of (offer.paymentMethodCategories ?? [])) {
            stat.paymentMethodCategories.add(cat);
          }
        }
      }

      setMerchantStats(Array.from(merchantMap.entries()).map(([nick, stat]) => ({
        nick,
        appearances: stat.appearances,
        availabilityRatio: stat.appearances / marketPolls,
        avgAvailable: stat.sampleCount > 0 ? stat.totalAvailable / stat.sampleCount : 0,
        maxAvailable: stat.maxAvailable,
        merchant30dTrades: stat.merchant30dTrades,
        merchant30dCompletion: stat.merchant30dCompletion,
        advertiserMessage: stat.advertiserMessage,
        feedbackCount: stat.feedbackCount,
        avgReleaseMinutes: stat.avgReleaseMinutes,
        avgPayMinutes: stat.avgPayMinutes,
        allTrades: stat.allTrades,
        tradeType: stat.tradeType,
        onlineStatus: stat.onlineStatus,
        paymentMethodCategories: Array.from(stat.paymentMethodCategories) as MerchantStat['paymentMethodCategories'],
      })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown P2P load error';
      console.error('P2P load error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dbMarket, applyVariantFilter]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadFromDb();

    const channel = supabase
      .channel(`p2p_snapshots_${dbMarket}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'p2p_snapshots', filter: `market=eq.${dbMarket}` }, () => {
        void loadFromDb();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [dbMarket, loadFromDb]);

  // Compute 20-merchant average for the current snapshot
  const avg20Sell = useMemo(() => {
    if (!snapshot) return null;
    const best = new Map<string, number>();
    for (const o of snapshot.sellOffers) {
      const nick = o.nick.trim();
      const existing = best.get(nick);
      if (existing == null || o.price > existing) best.set(nick, o.price);
    }
    const prices = Array.from(best.values()).sort((a, b) => b - a).slice(0, 20);
    return prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
  }, [snapshot]);

  const avg20Buy = useMemo(() => {
    if (!snapshot) return null;
    const best = new Map<string, number>();
    for (const o of snapshot.buyOffers) {
      const nick = o.nick.trim();
      const existing = best.get(nick);
      if (existing == null || o.price < existing) best.set(nick, o.price);
    }
    const prices = Array.from(best.values()).sort((a, b) => a - b).slice(0, 20);
    return prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
  }, [snapshot]);

  return {
    snapshot, history, merchantStats, loading, error, latestFetchedAt, qatarRates,
    refresh: loadFromDb,
    avg20Sell,
    avg20Buy,
  };
}
