import { useMemo } from 'react';
import { P2PSnapshot, MarketId } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { format } from 'date-fns';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
  todaySummary: any;
  profitIfSold: any;
  roundTripSim: any;
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, t }: Props) {
  const ccy = snapshot.sellAvg ? '' : ''; // Placeholder for currency logic if needed

  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      <div className="kpis" style={{ gridTemplateColumns: `repeat(${6 + (profitIfSold ? 1 : 0) + (roundTripSim ? 1 : 0)}, minmax(0, 1fr))` }}>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
          <div className="kpi-sub">{t('p2pTopSell')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t(market === 'qatar' ? 'p2pSellAvgTop5' : 'p2pSellAvgTop10')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--good)' }}>
            {snapshot.spreadPct ? `+${fmtPrice(snapshot.spreadPct)}% ${t('p2pSpreadLabel').toLowerCase()}` : t('p2pLiveWeightedAvg')}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestRestock')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestBuy ? fmtPrice(snapshot.bestBuy) : '—'}</div>
          <div className="kpi-sub">{t('p2pCheapestRestock')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pSpread')}</div>
          <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
            {snapshot.spread != null ? fmtPrice(snapshot.spread) : '—'}
          </div>
          <div className="kpi-sub">{snapshot.spreadPct != null ? `${fmtPrice(snapshot.spreadPct)}%` : t('p2pNoData')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayHighSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{todaySummary?.highSell ? fmtPrice(todaySummary.highSell) : '—'}</div>
          <div className="kpi-sub">{t('p2pLow')} {todaySummary?.lowSell ? fmtPrice(todaySummary.lowSell) : '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayLowBuy')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{todaySummary?.lowBuy ? fmtPrice(todaySummary.lowBuy) : '—'}</div>
          <div className="kpi-sub">{t('p2pHigh')} {todaySummary?.highBuy ? fmtPrice(todaySummary.highBuy) : '—'}</div>
        </div>
        {profitIfSold && (
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pProfitIfSoldNow')}</div>
            <div className="kpi-val" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {profitIfSold.profit >= 0 ? '+' : ''}${fmtTotal(profitIfSold.profit)}
            </div>
            <div className="kpi-sub">{fmtPrice(profitIfSold.stock)} USDT · {t('p2pCostBasis')}</div>
          </div>
        )}
        {roundTripSim && (
          <div className="kpi-card">
            <div className="kpi-lbl">Round-Trip Spread</div>
            <div className="kpi-val" style={{ color: roundTripSim.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {roundTripSim.profit >= 0 ? '+' : ''}${fmtTotal(roundTripSim.profit)}
            </div>
            <div className="kpi-sub">{fmtPrice(roundTripSim.pct)}% · sim</div>
          </div>
        )}
      </div>
    </div>
  );
}