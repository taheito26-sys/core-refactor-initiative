import { useState, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, Search, Loader2, Zap, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

import { MarketId, MARKETS, P2POffer } from '@/features/p2p/types';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import { totalStock, getWACOP, stockCostQAR, fmtU } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import type { TrackerState } from '@/lib/tracker-helpers';
import { MarketKpiGrid } from '@/features/p2p/components/MarketKpiGrid';
import { PriceHistorySparklines } from '@/features/p2p/components/PriceHistorySparklines';
import { MerchantDepthStats } from '@/features/p2p/components/MerchantDepthStats';
import { P2POfferTable } from '@/features/p2p/components/P2POfferTable';
import { MerchantIntelligenceCard } from '@/features/p2p/components/MerchantIntelligenceCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function P2PTrackerPage() {
  const t = useT();
  const [market, setMarket] = useState<MarketId>('qatar');
  const { snapshot, history, merchantStats, loading, latestFetchedAt, qatarRates, egyptAverages, refresh } = useP2PMarketData(market);
  const currentMarket = MARKETS.find(m => m.id === market)!;

  const [scanAmount, setScanAmount] = useState('10000');
  const [singleMerchantOnly, setSingleMerchantOnly] = useState(true);
  const [scanResults, setScanResults] = useState<P2POffer[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);

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
    if (ageMin < 1) return t('p2pJustNow');
    if (ageMin < 60) return t('p2pMinAgo').replace('{n}', String(ageMin));
    return t('p2pHAgo').replace('{n}', String(Math.floor(ageMin / 60)));
  }, [latestFetchedAt, t]);

  const runDeepScan = () => {
    const amount = parseFloat(scanAmount);
    if (isNaN(amount) || amount <= 0 || !snapshot) return;

    setIsScanning(true);
    setTimeout(() => {
      const offers = snapshot.buyOffers || [];
      const matches = offers.filter(o => {
        if (singleMerchantOnly) {
          return o.available >= amount && o.max >= amount;
        }
        return true;
      });
      setScanResults(matches.sort((a, b) => a.price - b.price));
      setIsScanning(false);
    }, 400);
  };

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
      const sellAvg = snapshot?.sellAvg;
      if (!wacop || wacop <= 0 || !sellAvg) return null;

      const localMid = (snapshot.sellAvg! + (snapshot.buyAvg || snapshot.sellAvg!)) / 2;
      const qatarMid = market === 'qatar' ? localMid : (qatarRates ? (qatarRates.sellAvg + qatarRates.buyAvg) / 2 : null);
      if (!qatarMid || !localMid) return null;

      const localToUsd = 1 / localMid;
      const qarToLocal = localMid / qatarMid;
      const profit = (stock * sellAvg - costBasis * qarToLocal) * localToUsd;

      return { stock, profit, fx: { localToUsd, qarToLocal }, costQAR: costBasis };
    } catch { return null; }
  }, [snapshot, market, qatarRates]);

  const roundTripSim = useMemo(() => {
    if (!profitIfSold || !snapshot?.sellAvg || !snapshot?.buyAvg) return null;
    const { qarToLocal, localToUsd } = profitIfSold.fx;
    const boughtUSDT = (profitIfSold.costQAR * qarToLocal) / snapshot.buyAvg;
    const finalLocal = boughtUSDT * snapshot.sellAvg;
    const profit = (finalLocal - (profitIfSold.costQAR * qarToLocal)) * localToUsd;
    const pct = ((finalLocal / (profitIfSold.costQAR * qarToLocal)) - 1) * 100;
    return { profit, pct };
  }, [profitIfSold, snapshot]);

  if (loading && (!snapshot || snapshot.sellAvg === null)) {
    return <div className="p-8 text-center text-muted-foreground">{t('loading')}</div>;
  }

  const hasNoData = !snapshot || (snapshot.sellAvg === null && snapshot.buyAvg === null && !history.length);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={market} onValueChange={(v) => { setMarket(v as MarketId); setScanResults(null); }}>
            <TabsList className="bg-muted/50 border border-border/50">
              {MARKETS.map(m => (
                <TabsTrigger key={m.id} value={m.id} className="text-[11px] px-3">{m.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-1.5 h-8 text-[11px] border-border/50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('p2pRefresh')}
          </Button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md border border-border/20">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            {hasNoData ? t('p2pWaitingFirstSync') : t('p2pSync5Min')}
          </span>
        </div>
        <Badge variant="outline" className="font-mono text-[11px] bg-background border-border/50">{currentMarket.pair}</Badge>
      </div>

      {hasNoData ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <RefreshCw className="h-6 w-6 text-muted-foreground/30 animate-spin" />
          <p className="text-sm font-semibold text-muted-foreground">{t('p2pCollectingData').replace('{market}', currentMarket.label)}</p>
        </div>
      ) : snapshot && (
        <>
          <MarketKpiGrid
            snapshot={snapshot}
            market={market}
            todaySummary={todaySummary}
            profitIfSold={profitIfSold}
            roundTripSim={roundTripSim}
            egyptAverages={egyptAverages}
            qatarRates={qatarRates}
            t={t}
          />

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className="xl:col-span-1 space-y-4">
               <Card className="border-primary/20 shadow-lg shadow-primary/5 bg-gradient-to-br from-card to-background">
                 <CardHeader className="pb-3 pt-4 px-4">
                   <CardTitle className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
                     <Zap className="h-3.5 w-3.5 text-primary fill-primary/20" />
                     Deep Market Scan
                   </CardTitle>
                 </CardHeader>
                 <CardContent className="px-4 pb-4 space-y-4">
                   <div className="space-y-2">
                     <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Required USDT</Label>
                     <Input 
                       type="number" 
                       value={scanAmount} 
                       onChange={e => setScanAmount(e.target.value)}
                       className="h-9 font-black font-mono bg-muted/20 border-border/50"
                     />
                   </div>
                   <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                     <Label className="text-[10px] font-black uppercase tracking-widest cursor-pointer" htmlFor="single-merch">Single Merchant</Label>
                     <Switch id="single-merch" checked={singleMerchantOnly} onCheckedChange={setSingleMerchantOnly} />
                   </div>
                   <Button onClick={runDeepScan} disabled={isScanning} className="w-full h-10 font-black uppercase tracking-widest text-[11px] gap-2 shadow-lg shadow-primary/20">
                     {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                     Run Deep Scan
                   </Button>
                 </CardContent>
               </Card>
               <MerchantDepthStats merchantStats={merchantStats} t={t} />
            </div>

            <div className="xl:col-span-3 space-y-4">
              {scanResults && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
                  {scanResults.map((m, i) => <MerchantIntelligenceCard key={i} merchant={m} />)}
                </div>
              )}
              <PriceHistorySparklines history={history} dataAgeLabel={dataAgeLabel} t={t} />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <P2POfferTable offers={snapshot.sellOffers} type="sell" t={t} />
                <P2POfferTable offers={snapshot.buyOffers} type="buy" t={t} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}