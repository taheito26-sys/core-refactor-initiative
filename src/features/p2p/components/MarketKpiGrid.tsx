import { P2PSnapshot, MarketId } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
  todaySummary: any;
  profitIfSold: any;
  roundTripSim: any;
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, t }: Props) {
  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pBestSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)', fontSize: '14px' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
          <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{t('p2pTopSell')}</div>
        </div>
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t(market === 'qatar' ? 'p2pSellAvgTop5' : 'p2pSellAvgTop10')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)', fontSize: '14px' }}>{snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--good)', fontSize: '8px', marginTop: '2px' }}>
            {snapshot.spreadPct ? `+${fmtPrice(snapshot.spreadPct)}%` : t('p2pLiveWeightedAvg')}
          </div>
        </div>
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pBestRestock')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)', fontSize: '14px' }}>{snapshot.bestBuy ? fmtPrice(snapshot.bestBuy) : '—'}</div>
          <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{t('p2pCheapestRestock')}</div>
        </div>
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pSpread')}</div>
          <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)', fontSize: '14px' }}>
            {snapshot.spread != null ? fmtPrice(snapshot.spread) : '—'}
          </div>
          <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{snapshot.spreadPct != null ? `${fmtPrice(snapshot.spreadPct)}%` : t('p2pNoData')}</div>
        </div>
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pTodayHighSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)', fontSize: '14px' }}>{todaySummary?.highSell ? fmtPrice(todaySummary.highSell) : '—'}</div>
          <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{t('p2pLow')} {todaySummary?.lowSell ? fmtPrice(todaySummary.lowSell) : '—'}</div>
        </div>
        <div className="kpi-card" style={{ padding: '6px 8px' }}>
          <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pTodayLowBuy')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)', fontSize: '14px' }}>{todaySummary?.lowBuy ? fmtPrice(todaySummary.lowBuy) : '—'}</div>
          <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{t('p2pHigh')} {todaySummary?.highBuy ? fmtPrice(todaySummary.highBuy) : '—'}</div>
        </div>
        {profitIfSold && (
          <div className="kpi-card" style={{ padding: '6px 8px' }}>
            <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>{t('p2pProfitIfSoldNow')}</div>
            <div className="kpi-val" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)', fontSize: '14px' }}>
              {profitIfSold.profit >= 0 ? '+' : ''}${fmtTotal(profitIfSold.profit)}
            </div>
            <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{fmtPrice(profitIfSold.stock)} USDT</div>
          </div>
        )}
        {roundTripSim && (
          <div className="kpi-card" style={{ padding: '6px 8px' }}>
            <div className="kpi-lbl" style={{ fontSize: '9px', marginBottom: '2px' }}>Round-Trip</div>
            <div className="kpi-val" style={{ color: roundTripSim.profit >= 0 ? 'var(--good)' : 'var(--bad)', fontSize: '14px' }}>
              {roundTripSim.profit >= 0 ? '+' : ''}${fmtTotal(roundTripSim.profit)}
            </div>
            <div className="kpi-sub" style={{ fontSize: '8px', marginTop: '2px' }}>{fmtPrice(roundTripSim.pct)}% sim</div>
          </div>
        )}
      </div>
    </div>
  );
}