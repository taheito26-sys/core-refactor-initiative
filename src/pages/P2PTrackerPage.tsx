import { useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import { MarketKpiGrid } from '@/features/p2p/components/MarketKpiGrid';
import { PriceHistorySparklines } from '@/features/p2p/components/PriceHistorySparklines';
import { MerchantDepthStats } from '@/features/p2p/components/MerchantDepthStats';
import { P2POfferTable } from '@/features/p2p/components/P2POfferTable';
import { DeepScanResults } from '@/features/p2p/components/DeepScanResults';

export default function P2PTrackerPage() {
  const t = useT();
  const { snapshot, history, merchantStats, loading, latestFetchedAt, qatarRates, refresh } = useP2PMarketData('egypt');

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

  if (loading && snapshot.sellAvg === null && snapshot.buyAvg === null) {
    return <div className="p-8 text-center text-muted-foreground">{t('loading')}</div>;
  }

  const hasNoData = snapshot.sellAvg === null && snapshot.buyAvg === null && !history.length;

  return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">USDT/EGP</Badge>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-1.5 h-8 text-[11px]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('p2pRefresh')}
        </Button>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          {hasNoData ? t('p2pWaitingFirstSync') : t('p2pSync5Min')}
        </span>
      </div>

      {hasNoData ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <span className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-sm font-semibold text-muted-foreground">{t('p2pCollectingData').replace('{market}', 'Egypt')}</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs">
            {t('p2pSyncHint')}
          </p>
        </div>
      ) : snapshot ? (
        <>
          <MarketKpiGrid
            snapshot={snapshot}
            market="egypt"
            qatarRates={qatarRates}
            t={t}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <PriceHistorySparklines history={history} dataAgeLabel={dataAgeLabel} t={t} />
            <MerchantDepthStats merchantStats={merchantStats} t={t} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <P2POfferTable offers={snapshot.sellOffers} type="sell" t={t} />
            <P2POfferTable offers={snapshot.buyOffers} type="buy" t={t} />
          </div>

          <DeepScanResults offers={snapshot.buyOffers} currency="EGP" />
        </>
      ) : null}
    </div>
  );
}
