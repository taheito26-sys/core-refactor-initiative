import { P2PSnapshot, MarketId } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  todaySummary: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profitIfSold: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roundTripSim: any;
  qatarRates?: { sellAvg: number; buyAvg: number } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, qatarRates, t }: Props) {
  const isCrossMarket = (market === 'egypt' || market === 'ksa' || market === 'egypt_fx_qar' || market === 'egypt_vcash' || market === 'egypt_bank');
  const isEgyptVariant = market === 'egypt' || market === 'egypt_fx_qar' || market === 'egypt_vcash' || market === 'egypt_bank';
  const currLabel = isEgyptVariant ? 'EGP' : market === 'ksa' ? 'SAR' : '';
  const buyLabel = isEgyptVariant ? 'EG Buy' : 'KSA Buy';
  const sellLabel = isEgyptVariant ? 'EG Sell' : 'KSA Sell';

  // FX rate: Qatar sell avg ÷ local buy avg
  const fxRate = isCrossMarket && qatarRates?.sellAvg && snapshot.buyAvg
    ? qatarRates.sellAvg / snapshot.buyAvg
    : null;
  const fxRateV2 = isCrossMarket && qatarRates?.sellAvg && snapshot.sellAvg
    ? qatarRates.sellAvg / snapshot.sellAvg
    : null;
  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      <div className="kpis kpis-p2p">
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
            <div className="kpi-lbl">{t('p2pRoundTripSpread')}</div>
            <div className="kpi-val" style={{ color: roundTripSim.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {roundTripSim.profit >= 0 ? '+' : ''}${fmtTotal(roundTripSim.profit)}
            </div>
            <div className="kpi-sub">{fmtPrice(roundTripSim.pct)}% · {t('p2pSim')}</div>
          </div>
        )}
        {fxRate != null && (
          <div className="kpi-card">
            <div className="kpi-lbl">{currLabel} → QAR FX</div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / fxRate)}
            </div>
            <div className="kpi-sub">1 {currLabel} ≈ {fmtPrice(fxRate)} QAR</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ {buyLabel} {snapshot.buyAvg ? fmtPrice(snapshot.buyAvg) : '—'}
            </div>
          </div>
        )}
        {fxRateV2 != null && (
          <div className="kpi-card">
            <div className="kpi-lbl">{currLabel} V2</div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / fxRateV2)}
            </div>
            <div className="kpi-sub">1 QAR ≈ {fmtPrice(1 / fxRateV2)} {currLabel}</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ {sellLabel} {snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}