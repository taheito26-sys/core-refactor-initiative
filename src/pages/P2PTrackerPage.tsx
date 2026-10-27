import { useState, useMemo, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { localCur } from '@/lib/currency-locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, Search, Loader2, Zap, SlidersHorizontal, X, ScanLine, ChevronRight } from 'lucide-react';
import { MarketId, MARKETS, P2POffer } from '@/features/p2p/types';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import { computeFIFO, totalStock, getWACOP, stockCostQAR, fmtU } from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import type { TrackerState } from '@/lib/tracker-helpers';
import { MarketKpiGrid } from '@/features/p2p/components/MarketKpiGrid';
import { PriceHistorySparklines } from '@/features/p2p/components/PriceHistorySparklines';
import { MerchantDepthStats } from '@/features/p2p/components/MerchantDepthStats';
import { MarketOffers } from '@/features/p2p/components/MarketOffers';
import { ZoomControls } from '@/components/shared/ZoomControls';
import { ThemeColorPicker } from '@/components/layout/ThemeColorPicker';
import { MarketOverview } from '@/features/p2p/components/MarketOverview';
import '@/features/p2p/p2p-market.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DeepScanResults } from '@/features/p2p/components/DeepScanResults';
import { computeDailySummaries } from '@/features/p2p/utils/converters';
import { supabase } from '@/integrations/supabase/client';
import { MerchantWatchCard } from '@/features/p2p/merchant-watch/MerchantWatchCard';

export default function P2PTrackerPage() {
  const t = useT();
  const [market, setMarket] = useState<MarketId>('qatar');
  const { snapshot, history, merchantStats, loading, error, latestFetchedAt, qatarRates, refresh } = useP2PMarketData(market);
  const currentMarket = MARKETS.find(m => m.id === market)!;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const scanRef = useRef<HTMLElement>(null);
  const changeMarket = (value: MarketId) => { setMarket(value); setScanResults(null); };
  const marketLabel = t(market === 'qatar' ? 'pmQatar' : 'pmEgypt');

  // ── Egypt QA Sell Override ──
  // When set, both qaSellAvg and qaBuyAvg use this value for KPI calculations.
  const [qaSellOverrideText, setQaSellOverrideText] = useState('');
  const qaSellOverride = useMemo(() => {
    const v = parseFloat(qaSellOverrideText);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [qaSellOverrideText]);

  // ── Deep Scan State ──
  const [scanAmount, setScanAmount] = useState('10000');
  const [singleMerchantOnly, setSingleMerchantOnly] = useState(true);
  const [scanResults, setScanResults] = useState<P2POffer[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const triggerManualRefresh = async () => {
    setIsManualRefresh(true);
    try {
      // Directly call the p2p-scraper function to force refresh
      await supabase.functions.invoke('p2p-scraper', {
        body: { market },
      });
      // Wait a moment for the data to be inserted
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Then refresh the data
      await refresh();
    } catch (err) {
      console.error('Manual refresh failed:', err);
    } finally {
      setIsManualRefresh(false);
    }
  };

  const todaySummary = useMemo(() => {
    const summaries = computeDailySummaries(history);
    if (!summaries.length) return null;

    const todayUtc = new Date().toISOString().slice(0, 10);
    return summaries.find(day => day.date === todayUtc) ?? summaries[summaries.length - 1] ?? null;
  }, [history]);

  // ── Egypt Cross-Rate KPIs ──
  const egyptKpis = useMemo(() => {
    if (market !== 'egypt' || !snapshot || !qatarRates) return undefined;

    const egBuyOffers = snapshot.buyOffers || [];

    // When user has set a QA Sell override, both sell and buy use that single rate
    // (user's personal average sell rate applies uniformly to both V1 and V2).
    const qaSellAvg = qaSellOverride ?? qatarRates.sellAvg;
    const qaBuyAvg  = qaSellOverride ?? qatarRates.buyAvg;

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

    // VCash: Vodafone-branded methods only
    const VCASH_RE = /vodafone|vcash|vf.?cash|فودافون/i;
    const egBuyVCashAvg = computeEgAvg(egBuyOffers, VCASH_RE);

    // InstaPay / non-VCash wallets + banks:
    // Egypt P2P buy offers use mobile carrier wallets — the real method names from
    // the live Binance feed are: "Orange Cash", "Etisalat Cash", "we Pay",
    // "Qahera Cash" (and classic "InstaPay" / bank names when they appear).
    const INSTA_RE =
      /orange|etisalat|we.?pay|wepay|qahera|instapay|insta[- ]?pay|إنستاباي|انستاباي|إنستا|انستا|bank|بنك|cib|nbe|qnb|misr|alex|faisal|banque|ahli|national|commercial|transfer|تحويل|fawry/i;

    let egBuyInstaAvg: number | null = computeEgAvg(egBuyOffers, INSTA_RE);

    // Safety fallback: if the named regex still matches nothing, use every offer
    // whose methods do NOT include a VCash pattern (catches any future unlisted
    // non-VCash method without needing regex updates).
    if (egBuyInstaAvg === null) {
      const nonVCashOffers = egBuyOffers.filter(
        o => o.methods.length === 0 || !o.methods.some(m => VCASH_RE.test(m)),
      );
      if (nonVCashOffers.length > 0) {
        const deduped = new Map<string, P2POffer>();
        nonVCashOffers.forEach(o => { if (!deduped.has(o.nick)) deduped.set(o.nick, o); });
        const top20 = Array.from(deduped.values()).sort((a, b) => a.price - b.price).slice(0, 20);
        egBuyInstaAvg = top20.length > 0 ? top20.reduce((s, o) => s + o.price, 0) / top20.length : null;
      }
    }

    // Values expressed as EGP per QAR (EGP → QAR direction, ~14.xxx)
    // Formula: EG Buy avg ÷ QA rate  →  how many EGP you get per 1 QAR
    // V1 uses QA Sell rate (what you receive when selling QAR)
    // V2 uses QA Buy rate (what you pay when buying QAR) — removed per user request
    return {
      vCashV1:    egBuyVCashAvg && qaSellAvg ? egBuyVCashAvg / qaSellAvg : null,
      instaPayV1: egBuyInstaAvg && qaSellAvg ? egBuyInstaAvg / qaSellAvg : null,
      // Raw inputs passed through for KPI subtitle display
      qaSellAvg,
      qaBuyAvg,
      egBuyVCashAvg,
      egBuyInstaAvg,
      // Override state for UI indicator
      isOverridden: qaSellOverride !== null,
      overrideValue: qaSellOverride,
    };
  }, [market, snapshot, qatarRates, qaSellOverride]);

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
      setScanError(t('pmPositiveAmount'));
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
      if (!stateRaw || !Array.isArray(stateRaw.batches) || !stateRaw.batches.length) return null;
      const st = stateRaw as unknown as TrackerState;
      const derived = computeFIFO(st.batches, st.trades || [], st.usdtTransfers);
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

  const hasNoData = !snapshot || (snapshot.sellAvg === null && snapshot.buyAvg === null && !history.length);

  return (
    <div className="pm-page" dir={t.isRTL ? 'rtl' : 'ltr'}>
      <header className="pm-header">
        <div><h1>{t('p2pTracker')}</h1><p>{t('pmSubtitle')}</p></div>
        <label className="pm-market-select"><span aria-hidden="true">{market === 'qatar' ? '🇶🇦' : '🇪🇬'}</span><select aria-label={t('pmMarket')} value={market} onChange={event => changeMarket(event.target.value as MarketId)}>{MARKETS.map(item => <option key={item.id} value={item.id}>{t(item.id === 'qatar' ? 'pmQatar' : 'pmEgypt')}</option>)}</select></label>
      </header>
      <div className="pm-trade-tabs">
        <div className="pm-side-tabs" role="group" aria-label={t('pmTradeSide')}>
          <button type="button" aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>{t('pmBuy')}</button>
          <button type="button" aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>{t('pmSell')}</button>
        </div>
        <button type="button" className="pm-scan-shortcut" onClick={() => scanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><ScanLine size={14} />{t('pmDeepScan')}<ChevronRight size={12} /></button>
      </div>
      {error && <div role="alert" className="pm-panel text-destructive">{t('pmLoadError')} <button type="button" onClick={refresh}>{t('p2pRefresh')}</button></div>}
      {loading ? <div className="pm-panel pm-empty" role="status"><Loader2 className="animate-spin" />{t('loading')}</div> : hasNoData ? <div className="pm-panel pm-empty"><RefreshCw size={24} /><h2>{t('p2pCollectingData').replace('{market}', marketLabel)}</h2><p>{t('p2pSyncHint')}</p></div> : snapshot && <>
        <MarketOverview snapshot={snapshot} history={history} market={currentMarket} fetchedAt={latestFetchedAt} refreshing={loading} refresh={refresh} side={side} />
        <section ref={scanRef} className="pm-panel pm-deep-scan" aria-label={t('pmDeepScan')}>
          <div className="pm-scan-title"><span className="pm-scan-icon"><ScanLine size={21} /></span><div><h2>{t('pmDeepScan')}</h2><p>{t('pmScanSubtitle')}</p></div></div>
          <label className="pm-scan-amount" htmlFor="pm-scan-amount">{t('pmWantBuy')}<span className="pm-scan-input"><input id="pm-scan-amount" aria-label={t('pmWantBuy')} type="number" min="0" step="any" value={scanAmount} onChange={event => setScanAmount(event.target.value)} aria-invalid={Boolean(scanError)} /><span>USDT</span></span></label>
          <button type="button" className="pm-scan-submit" onClick={runDeepScan} disabled={isScanning}>{isScanning ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{t('pmFindOffers')}</button>

          {scanError && <p role="alert" className="pm-scan-error">{scanError}</p>}
        </section>
        {scanResults && <section className="pm-panel"><div className="pm-section-head"><h2>{t('pmScanResults')} · {fmtU(parseFloat(scanAmount))} USDT · {scanResults.length}</h2><button type="button" className="pm-outline" onClick={() => setScanResults(null)}>{t('pmClearResults')}</button></div><DeepScanResults results={scanResults} amount={parseFloat(scanAmount)} currency={currentMarket.currency} /></section>}
      </>}
      {!loading && snapshot && !hasNoData && <MarketOffers key={market} offers={side === 'buy' ? snapshot.buyOffers : snapshot.sellOffers} side={side} market={currentMarket} onMarketChange={changeMarket} />}
      <details className="pm-extras"><summary>{t('pmMarketTools')}</summary><div className="pm-refresh-tools"><button type="button" className="pm-outline" disabled={loading} onClick={refresh}><RefreshCw size={12} />{t('p2pRefresh')}</button><button type="button" className="pm-outline" disabled={loading || isManualRefresh} onClick={triggerManualRefresh}><Zap size={12} />{isManualRefresh ? t('p2pRefreshing') : t('p2pForceRefresh')}</button><span>{t('p2pSync5Min')}</span><ZoomControls showPercent="always" /><ThemeColorPicker /><details className="pm-scan-settings"><summary>{t('pmScanOptions')}</summary><div><Switch dir="ltr" id="single-merch" checked={singleMerchantOnly} onCheckedChange={setSingleMerchantOnly} /><Label htmlFor="single-merch">{t('pmSingleMerchant')}</Label></div></details></div></details>
      <details className="pm-extras"><summary>{t('pmWatchlist')}</summary><div className="pm-extras-content"><MerchantWatchCard /></div></details>
      {!loading && snapshot && !hasNoData && <details className="pm-extras"><summary>{t('pmAnalytics')}</summary><div className="pm-extras-content">
        <MarketKpiGrid snapshot={snapshot} market={market} todaySummary={todaySummary} profitIfSold={profitIfSold} roundTripSim={roundTripSim} egyptKpis={egyptKpis} t={t} />
               {/* Egypt QA Sell Override — Egypt market only */}
               {market === 'egypt' && (
                 <Card className={cn(
                   "border-border/40 bg-card/60",
                   qaSellOverride !== null && "border-primary/40 bg-primary/5"
                 )}>
                   <CardHeader className="pb-2 pt-3 px-4">
                     <CardTitle className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
                       <SlidersHorizontal className="h-3.5 w-3.5 text-primary/70" />
                       {t('pmOverride')}
                       {qaSellOverride !== null && (
                         <span className="ml-auto text-[9px] font-black text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                           {t('pmActive')}
                         </span>
                       )}
                     </CardTitle>
                   </CardHeader>
                   <CardContent className="px-4 pb-4 space-y-3">
                     <p className="text-[9px] text-muted-foreground leading-relaxed">
                       {t('pmOverrideHint')}
                     </p>
                     <div className="flex gap-2">
                       <div className="relative flex-1">
                         <Input
                           type="number"
                           placeholder={qatarRates?.sellAvg?.toFixed(4) ?? 'e.g. 3.840'}
                           value={qaSellOverrideText}
                           onChange={e => setQaSellOverrideText(e.target.value)}
                           className="h-9 font-black font-mono bg-muted/20 border-border/50 pr-10 text-[12px]"
                         />
                         <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black opacity-30">{localCur('QAR', t.lang)}</span>
                       </div>
                       {qaSellOverride !== null && (
                         <Button
                           variant="outline"
                           size="sm"
                           className="h-9 px-3 border-destructive/40 text-destructive hover:bg-destructive/10"
                           aria-label={t('pmClearOverride')}
                           onClick={() => setQaSellOverrideText('')}
                         >
                           <X className="h-3.5 w-3.5" />
                         </Button>
                       )}
                     </div>
                     {qaSellOverride !== null && (
                       <p className="text-[9px] text-primary font-bold">
                         {t('pmUsingOverride').replace('{rate}', qaSellOverride.toFixed(4))}
                       </p>
                     )}
                   </CardContent>
                 </Card>
               )}


        <PriceHistorySparklines history={history} dataAgeLabel={dataAgeLabel} t={t} />
        <MerchantDepthStats merchantStats={merchantStats} t={t} />
      </div></details>}
    </div>
  );
}
