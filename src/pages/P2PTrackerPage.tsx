import { useState, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

import { MarketId, MARKETS } from '@/features/p2p/types';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import { computeFIFO, totalStock, getWACOP, stockCostQAR } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import type { TrackerState } from '@/lib/tracker-helpers';
import { MarketKpiGrid } from '@/features/p2p/components/MarketKpiGrid';
import { PriceHistorySparklines } from '@/features/p2p/components/PriceHistorySparklines';
import { MerchantDepthStats } from '@/features/p2p/components/MerchantDepthStats';
import { P2POfferTable } from '@/features/p2p/components/P2POfferTable';

export default function P2PTrackerPage() {
  const t = useT();
  const [market, setMarket] = useState<MarketId>('qatar');
  const { snapshot, history, merchantStats, loading, latestFetchedAt, qatarRates, refresh } = useP2PMarketData(market);
  const currentMarket = MARKETS.find(m => m.id === market)!;

  const todaySummary = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayPts = history.filter(h => format(new Date(h.ts), 'yyyy-MM-dd') === todayStr);
    if (!todayPts.length) return null;
    const sellPresent = todayPts.filter(p => p.sellAvg != null);
    const buyPresent = todayPts.filter(p => p.buyAvg != null);
    return {
      highSell: sellPresent.length ? Math.max(...sellPresent.map(p => p.sellAvg!)) : null,
      lowSell: sellPresent.length ? Math.min(...sellPresent.map(p => p.sellAvg!)) : null,
      highBuy: buyPresent.length ? Math.max(...buyPresent.map(p => p.buyAvg!)) : null,
      lowBuy: buyPresent.length ? Math.min(...buyPresent.map(p => p.buyAvg!)) : null,
    };
  }, [history]);

  const dataAgeLabel = useMemo(() => {
    if (!latestFetchedAt) return null;
    const ageMin = Math.floor((Date.now() - new Date(latestFetchedAt).getTime()) / 60000);
    if (ageMin < 1) return 'just now';
    if (ageMin < 60) return `${ageMin} min ago`;
    return `${Math.floor(ageMin / 60)}h ago`;
  }, [latestFetchedAt]);

  // ── Derive mid-rate helper ──────────────────────────────────────────────────
  const deriveMid = (s: number | null, b: number | null): number | null => {
    if (s != null && b != null && s > 0 && b > 0) return (s + b) / 2;
    return s ?? b ?? null;
  };

  const sellAvg = snapshot?.sellAvg ?? null;
  const buyAvg  = snapshot?.buyAvg  ?? null;

  // ── Profit if sold now in this market ──────────────────────────────────────
  const profitIfSold = useMemo(() => {
    try {
      const stateRaw = getCurrentTrackerState(localStorage);
      if (!stateRaw || !Array.isArray((stateRaw as any).batches) || !(stateRaw as any).batches.length) return null;
      const st = stateRaw as unknown as TrackerState;
      const derived = computeFIFO(st.batches, st.trades || []);
      const stock = totalStock(derived);
      if (stock <= 0) return null;
      const wacop = getWACOP(derived);
      const costBasis = stockCostQAR(derived);
      if (!wacop || wacop <= 0) return null;

      const localMid = deriveMid(sellAvg, buyAvg);
      const qatarMid = market === 'qatar'
        ? localMid
        : qatarRates ? deriveMid(qatarRates.sellAvg, qatarRates.buyAvg) : null;
      if (!localMid || localMid <= 0 || !qatarMid || qatarMid <= 0 || !sellAvg || sellAvg <= 0) return null;

      const localToUsd  = 1 / localMid;
      const qarToUsd    = 1 / qatarMid;
      const qarToLocal  = localMid / qatarMid;

      const costQAR        = costBasis;
      const costLocal      = costQAR * qarToLocal;
      const sellValueLocal = stock * sellAvg;
      const profitLocal    = sellValueLocal - costLocal;
      const profit         = profitLocal * localToUsd;

      return {
        stock, wacop, costQAR, costLocal,
        costBasisUSD: costQAR * qarToUsd,
        sellValueLocal, sellValueUSD: sellValueLocal * localToUsd,
        profitLocal, profit,
        fx: { localToUsd, qarToUsd, qarToLocal },
      };
    } catch { return null; }
  }, [sellAvg, buyAvg, market, qatarRates]);

  // ── Round-trip spread simulation ───────────────────────────────────────────
  const roundTripSim = useMemo(() => {
    if (!profitIfSold || !sellAvg || !buyAvg || sellAvg <= 0 || buyAvg <= 0) return null;
    const { qarToLocal, localToUsd } = profitIfSold.fx;
    if (!qarToLocal || !localToUsd || qarToLocal <= 0 || localToUsd <= 0) return null;

    const startingCapitalLocal = profitIfSold.costQAR * qarToLocal;
    if (startingCapitalLocal <= 0) return null;

    const boughtUSDT         = startingCapitalLocal / buyAvg;
    const finalLocal         = boughtUSDT * sellAvg;
    const roundTripProfitLocal = finalLocal - startingCapitalLocal;
    const profit             = roundTripProfitLocal * localToUsd;
    const pct                = (roundTripProfitLocal / startingCapitalLocal) * 100;

    return {
      startingCapitalLocal,
      startingCapitalUSD: startingCapitalLocal * localToUsd,
      finalLocal, finalUSD: finalLocal * localToUsd,
      boughtUSDT, profit,
      spreadRatio: sellAvg / buyAvg,
      pct,
    };
  }, [profitIfSold, sellAvg, buyAvg]);

  if (loading && (!snapshot || snapshot.sellAvg === null)) {
    return <div className="p-8 text-center text-muted-foreground">Loading market data...</div>;
  }

  // Handle "No data yet" state for new markets
  const hasNoData = !snapshot || (snapshot.sellAvg === null && snapshot.buyAvg === null && !history.length);

  return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={market} onValueChange={(v) => setMarket(v as MarketId)}>
          <TabsList>
            {MARKETS.map(m => (
              <TabsTrigger key={m.id} value={m.id} className="text-[11px] px-3">{m.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-1.5 h-8 text-[11px]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('p2pRefresh')}
        </Button>

        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          {hasNoData ? 'Waiting for first sync…' : 'Sync · 5 min'}
        </span>

        <Badge variant="outline" className="font-mono text-[11px]">{currentMarket.pair}</Badge>
      </div>

      {hasNoData ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <span className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-sm font-semibold text-muted-foreground">Collecting data for {currentMarket.label}…</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs">
            The backend sync runs every 5 minutes. First data point will appear automatically — no refresh needed.
          </p>
        </div>
      ) : snapshot && (
        <>
          <MarketKpiGrid
            snapshot={snapshot}
            market={market}
            todaySummary={todaySummary}
            profitIfSold={profitIfSold}
            roundTripSim={roundTripSim}
            t={t}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <PriceHistorySparklines history={history} dataAgeLabel={dataAgeLabel} t={t} />
            <MerchantDepthStats merchantStats={merchantStats} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <P2POfferTable offers={snapshot.sellOffers} type="sell" t={t} />
            <P2POfferTable offers={snapshot.buyOffers} type="buy" t={t} />
          </div>
        </>
      )}
    </div>
  );
}