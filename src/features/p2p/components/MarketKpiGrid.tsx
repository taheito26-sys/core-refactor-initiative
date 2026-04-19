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
  egyptKpis?: {
    vCashV1: number | null;
    vCashV2: number | null;
    instaPayV1: number | null;
    instaPayV2: number | null;
    // Raw inputs for subtitle detail lines
    qaSellAvg: number | null;
    qaBuyAvg: number | null;
    egBuyVCashAvg: number | null;
    egBuyInstaAvg: number | null;
    // Override indicator
    isOverridden: boolean;
    overrideValue: number | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, egyptKpis, t }: Props) {
  const isEgypt = market === 'egypt';
  const avgTopN = market === 'qatar' ? 5 : 20;
  const sellTop = (snapshot.sellOffers || []).slice(0, avgTopN);
  const buyTop = (snapshot.buyOffers || []).slice(0, avgTopN);
  const uiSellAvg = sellTop.length > 0
    ? sellTop.reduce((sum, offer) => sum + offer.price, 0) / sellTop.length
    : snapshot.sellAvg;
  const uiBuyAvg = buyTop.length > 0
    ? buyTop.reduce((sum, offer) => sum + offer.price, 0) / buyTop.length
    : snapshot.buyAvg;
  const uiSpreadPct = uiSellAvg != null && uiBuyAvg != null && uiBuyAvg > 0
    ? ((uiSellAvg - uiBuyAvg) / uiBuyAvg) * 100
    : snapshot.spreadPct;

  const highSell = todaySummary?.highSell ?? null;
  const lowSell = todaySummary?.lowSell ?? null;
  const highBuy = todaySummary?.highBuy ?? null;
  const lowBuy = todaySummary?.lowBuy ?? null;
  const hasSellRange = highSell != null && lowSell != null && Math.abs(highSell - lowSell) > 0.0001;
  const hasBuyRange = highBuy != null && lowBuy != null && Math.abs(highBuy - lowBuy) > 0.0001;
  const hasIntradayRange = (todaySummary?.polls ?? 0) > 1;

  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      <div className="kpis" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(130px, 1fr))` }}>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
          <div className="kpi-sub">{t('p2pTopSell')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t(market === 'qatar' ? 'p2pSellAvgTop5' : 'p2pSellAvgTop20')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{uiSellAvg ? fmtPrice(uiSellAvg) : '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--good)' }}>
            {uiSpreadPct ? `+${fmtPrice(uiSpreadPct)}% vs Buy Avg` : t('p2pLiveWeightedAvg')}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestRestock')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestBuy ? fmtPrice(snapshot.bestBuy) : '—'}</div>
          <div className="kpi-sub">{t('p2pCheapestRestock')}</div>
        </div>

        {/* Removed SPREAD card as requested */}

        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayHighSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{highSell != null ? fmtPrice(highSell) : '—'}</div>
          <div className="kpi-sub">
            {hasIntradayRange && hasSellRange ? `${t('p2pLow')} ${fmtPrice(lowSell!)}` : t('p2pNoRangeYet')}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayLowBuy')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{lowBuy != null ? fmtPrice(lowBuy) : '—'}</div>
          <div className="kpi-sub">
            {hasIntradayRange && hasBuyRange ? `${t('p2pHigh')} ${fmtPrice(highBuy!)}` : t('p2pNoRangeYet')}
          </div>
        </div>

        {/* Egypt KPI cards - displayed in EGP → QAR direction (~14.xxx EGP per QAR) */}
        {isEgypt && egyptKpis && (
          <>
            {/* VCash V1: EG VCash Buy avg ÷ QA Sell (or override) */}
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))', borderColor: 'var(--brand)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                VCASH V1
                {egyptKpis.isOverridden && <span style={{ fontSize: '7px', background: 'var(--brand)', color: 'var(--surface)', borderRadius: '3px', padding: '1px 4px', fontWeight: 900 }}>OVR</span>}
              </div>
              <div className="kpi-val" style={{ color: 'var(--brand)' }}>
                {egyptKpis.vCashV1 != null ? egyptKpis.vCashV1.toFixed(3) : '—'}
              </div>
              <div className="kpi-sub">
                1 EGP ≈ {egyptKpis.vCashV1 != null ? (1 / egyptKpis.vCashV1).toFixed(4) : '—'} QAR
              </div>
              <div className="kpi-sub">
                {egyptKpis.isOverridden ? `OVR ${egyptKpis.qaSellAvg != null ? egyptKpis.qaSellAvg.toFixed(3) : '—'}` : `QA Sell ${egyptKpis.qaSellAvg != null ? egyptKpis.qaSellAvg.toFixed(3) : '—'}`} + VCash Buy {egyptKpis.egBuyVCashAvg != null ? egyptKpis.egBuyVCashAvg.toFixed(3) : '—'}
              </div>
            </div>

            {/* VCash V2: EG VCash Buy avg ÷ QA Buy (or override — same as V1 when overridden) */}
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))', borderColor: 'var(--brand)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                VCASH V2
                {egyptKpis.isOverridden && <span style={{ fontSize: '7px', background: 'var(--brand)', color: 'var(--surface)', borderRadius: '3px', padding: '1px 4px', fontWeight: 900 }}>OVR</span>}
              </div>
              <div className="kpi-val" style={{ color: 'var(--brand)' }}>
                {egyptKpis.vCashV2 != null ? egyptKpis.vCashV2.toFixed(3) : '—'}
              </div>
              <div className="kpi-sub">
                1 EGP ≈ {egyptKpis.vCashV2 != null ? (1 / egyptKpis.vCashV2).toFixed(4) : '—'} QAR
              </div>
              <div className="kpi-sub">
                {egyptKpis.isOverridden ? `OVR ${egyptKpis.qaBuyAvg != null ? egyptKpis.qaBuyAvg.toFixed(3) : '—'}` : `QA Buy ${egyptKpis.qaBuyAvg != null ? egyptKpis.qaBuyAvg.toFixed(3) : '—'}`} + VCash Buy {egyptKpis.egBuyVCashAvg != null ? egyptKpis.egBuyVCashAvg.toFixed(3) : '—'}
              </div>
            </div>

            {/* InstaPay V1: EG InstaPay/Bank Buy avg ÷ QA Sell (or override) */}
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--good) 6%, var(--surface))', borderColor: 'var(--good)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--good)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                INSTAPAY V1
                {egyptKpis.isOverridden && <span style={{ fontSize: '7px', background: 'var(--good)', color: 'var(--surface)', borderRadius: '3px', padding: '1px 4px', fontWeight: 900 }}>OVR</span>}
              </div>
              <div className="kpi-val" style={{ color: 'var(--good)' }}>
                {egyptKpis.instaPayV1 != null ? egyptKpis.instaPayV1.toFixed(3) : '—'}
              </div>
              <div className="kpi-sub">
                1 EGP ≈ {egyptKpis.instaPayV1 != null ? (1 / egyptKpis.instaPayV1).toFixed(4) : '—'} QAR
              </div>
              <div className="kpi-sub">
                {egyptKpis.isOverridden ? `OVR ${egyptKpis.qaSellAvg != null ? egyptKpis.qaSellAvg.toFixed(3) : '—'}` : `QA Sell ${egyptKpis.qaSellAvg != null ? egyptKpis.qaSellAvg.toFixed(3) : '—'}`} + Insta Buy {egyptKpis.egBuyInstaAvg != null ? egyptKpis.egBuyInstaAvg.toFixed(3) : '—'}
              </div>
            </div>

            {/* InstaPay V2: EG InstaPay/Bank Buy avg ÷ QA Buy (or override — same as V1 when overridden) */}
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--good) 6%, var(--surface))', borderColor: 'var(--good)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--good)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                INSTAPAY V2
                {egyptKpis.isOverridden && <span style={{ fontSize: '7px', background: 'var(--good)', color: 'var(--surface)', borderRadius: '3px', padding: '1px 4px', fontWeight: 900 }}>OVR</span>}
              </div>
              <div className="kpi-val" style={{ color: 'var(--good)' }}>
                {egyptKpis.instaPayV2 != null ? egyptKpis.instaPayV2.toFixed(3) : '—'}
              </div>
              <div className="kpi-sub">
                1 EGP ≈ {egyptKpis.instaPayV2 != null ? (1 / egyptKpis.instaPayV2).toFixed(4) : '—'} QAR
              </div>
              <div className="kpi-sub">
                {egyptKpis.isOverridden ? `OVR ${egyptKpis.qaBuyAvg != null ? egyptKpis.qaBuyAvg.toFixed(3) : '—'}` : `QA Buy ${egyptKpis.qaBuyAvg != null ? egyptKpis.qaBuyAvg.toFixed(3) : '—'}`} + Insta Buy {egyptKpis.egBuyInstaAvg != null ? egyptKpis.egBuyInstaAvg.toFixed(3) : '—'}
              </div>
            </div>
          </>
        )}

        {!isEgypt && profitIfSold && (
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pProfitIfSoldNow')}</div>
            <div className="kpi-val" style={{ color: profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {profitIfSold.profit >= 0 ? '+' : ''}${fmtTotal(profitIfSold.profit)}
            </div>
            <div className="kpi-sub">{fmtPrice(profitIfSold.stock)} USDT · {t('p2pCostBasis')}</div>
          </div>
        )}
        {!isEgypt && roundTripSim && (
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pRoundTripSpread')}</div>
            <div className="kpi-val" style={{ color: roundTripSim.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {roundTripSim.profit >= 0 ? '+' : ''}${fmtTotal(roundTripSim.profit)}
            </div>
            <div className="kpi-sub">{fmtPrice(roundTripSim.pct)}% · {t('p2pSim')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
