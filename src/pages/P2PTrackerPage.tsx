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
import { computeFIFO, totalStock, getWACOP, stockCostQAR, fmtU } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import type { TrackerState } from '@/lib/tracker-helpers';
import { MarketKpiGrid } from '@/features/p2p/components/MarketKpiGrid';
import { PriceHistorySparklines } from '@/features/p2p/components/PriceHistorySparklines';
import { MerchantDepthStats } from '@/features/p2p/components/MerchantDepthStats';
import { P2POfferTable } from '@/features/p2p/components/P2POfferTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DeepScanResults } from '@/features/p2p/components/DeepScanResults';

export default function P2PTrackerPage() {
  const t = useT();
  const [market, setMarket] = useState<MarketId>('qatar');
  const { snapshot, history, merchantStats, loading, latestFetchedAt, qatarRates, refresh } = useP2PMarketData(market);
  const currentMarket = MARKETS.find(m => m.id === market)!;

  // ── Deep Scan State ──
  const [scanAmount, setScanAmount] = useState('10000');
  const [singleMerchantOnly, setSingleMerchantOnly] = useState(true);
  const [scanResults, setScanResults] = useState<P2POffer[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

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

  // ── Egypt Cross-Rate KPIs ──
  const egyptKpis = useMemo(() => {
    if (market !== 'egypt' || !snapshot || !qatarRates) return undefined;

    const egBuyOffers = snapshot.buyOffers || [];
    const qaSellAvg = qatarRates.sellAvg;
    const qaBuyAvg = qatarRates.buyAvg;

    const computeEgAvg = (offers: P2POffer[], regex: RegExp) => {
      const deduped = new Map<string, P2POffer>();
      offers.forEach(o => {
        if (o.methods.some(m => regex.test(m)) && !deduped.has(o.nick)) {
          deduped.set(o.nick, o);
        }
      });
      // Sort cheapest first before taking top 20 distinct merchants
      const top20 = Array.from(deduped.values()).sort((a, b) => a.price - b.price).slice(0, 20);
      if (top20.length === 0) return null;
      return top20.reduce((s, o) => s + o.price, 0) / top20.length;
    };

    // VCash: Vodafone-branded methods
    const egBuyVCashAvg = computeEgAvg(egBuyOffers, /vodafone|vcash|vf.?cash|فودافون/i);

    // InstaPay + all bank transfer methods (broad to catch any naming variant)
    const egBuyInstaAvg = computeEgAvg(
      egBuyOffers,
      /instapay|insta[- ]?pay|انستاباي|انستا|bank|بنك|cib|nbe|qnb|misr|alex|faisal|banque|ahli|national|commercial|transfer|تحويل/i,
    );

    // Values expressed as EGP per QAR (EGP → QAR direction, ~14.xxx)
    // Formula: EG Buy avg ÷ QA rate  →  how many EGP you get per 1 QAR
    return {
      vCashV1:    egBuyVCashAvg && qaSellAvg ? egBuyVCashAvg / qaSellAvg : null,
      vCashV2:    egBuyVCashAvg && qaBuyAvg  ? egBuyVCashAvg / qaBuyAvg  : null,
      instaPayV1: egBuyInstaAvg && qaSellAvg ? egBuyInstaAvg / qaSellAvg : null,
      instaPayV2: egBuyInstaAvg && qaBuyAvg  ? egBuyInstaAvg / qaBuyAvg  : null,
      // Raw inputs passed through for KPI subtitle display
      qaSellAvg,
      qaBuyAvg,
      egBuyVCashAvg,
      egBuyInstaAvg,
    };
  }, [market, snapshot, qatarRates]);

  const dataAgeLabel = useMemo(() => {
    if (!latestFetchedAt) return null;
    const ageMin = Math.floor((Date.now() - new Date(latestFetchedAt).getTime()) / 60000);
    if (ageMin < 1) return t('p2pJustNow');
    if (ageMin < 60) return t('p2pMinAgo').replace('{n}', String(ageMin));
    return t('p2pHAgo').replace('{n}', String(Math.floor(ageMin / 60)));
  }, [latestFetchedAt, t]);

  const runDeepScan = () => {
    setScanError(null);
    const amount = parseFloat(scanAmount);
    if (isNaN(amount) || amount <= 0) {
      setScanError('Required USDT must be a positive number');
      return;
    }

    if (!snapshot) return;

    setIsScanning(true);
    setTimeout(() => {
      const offers = snapshot.buyOffers || [];
      const matches = offers.filter(o => {
        // Always require merchant has enough available USDT stock
        if (o.available < amount) return false;
        if (singleMerchantOnly) {
          // Max limit is in local currency; convert to USDT via price to verify
          // a single transaction can cover the full required amount
          const maxUsdt = o.price > 0 ? o.max / o.price : 0;
          return maxUsdt >= amount;
        }
        return true;
      });

      setScanResults(matches.sort((a, b) => a.price - b.price));
      setIsScanning(false);
    }, 400);
  };

  const deriveMid = (s: number | null, b: number | null): number | null => {
    if (s != null && b != null && s > 0 && b > 0) return (s + b) / 2;
    return s ?? b ?? null;
  };

  const sellAvg = snapshot?.sellAvg ?? null;
  const buyAvg  = snapshot?.buyAvg  ?? null;

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
          <div className="h-12 w-12 rounded-2xl bg-muted/50 flex items-center justify-center">
             <RefreshCw className="h-6 w-6 text-muted-foreground/30 animate-spin" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">{t('p2pCollectingData').replace('{market}', currentMarket.label)}</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs leading-relaxed">
            {t('p2pSyncHint')}
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
            egyptKpis={egyptKpis}
            t={t}
          />

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className="xl:col-span-1 space-y-4">
               {/* Simplified Deep Scan Tool */}
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
                     <div className="relative">
                       <Input 
                         type="number" 
                         value={scanAmount} 
                         onChange={e => setScanAmount(e.target.value)}
                         className={cn("h-9 font-black font-mono bg-muted/20 border-border/50", scanError && "border-destructive focus-visible:ring-destructive")}
                       />
                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black opacity-30">USDT</span>
                     </div>
                     {scanError && <p className="text-[10px] text-destructive font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {scanError}</p>}
                   </div>

                   <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                     <div className="space-y-0.5">
                       <Label className="text-[10px] font-black uppercase tracking-widest cursor-pointer" htmlFor="single-merch">Single Merchant</Label>
                       <p className="text-[9px] text-muted-foreground leading-tight">Must fulfill full amount alone</p>
                     </div>
                     <Switch 
                       id="single-merch"
                       checked={singleMerchantOnly} 
                       onCheckedChange={setSingleMerchantOnly} 
                     />
                   </div>

                   <Button 
                     onClick={runDeepScan} 
                     disabled={isScanning} 
                     className="w-full h-10 font-black uppercase tracking-widest text-[11px] gap-2 shadow-lg shadow-primary/20"
                   >
                     {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                     Run Deep Scan
                   </Button>
                 </CardContent>
               </Card>

               <MerchantDepthStats merchantStats={merchantStats} t={t} />
            </div>

            <div className="xl:col-span-3 space-y-4">
              {/* Scan Results Display */}
              {scanResults && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      Scan Results for {fmtU(parseFloat(scanAmount))} USDT
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                      {scanResults.length} Matches Found
                    </h3>
                    <button onClick={() => setScanResults(null)} className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">Clear Results</button>
                  </div>
                  
                  <DeepScanResults
                    results={scanResults}
                    amount={parseFloat(scanAmount)}
                    currency={currentMarket.currency}
                  />
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