import { P2PSnapshot, MarketId } from '../types';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface Props {
  snapshot: P2PSnapshot;
  market: MarketId;
  todaySummary: any;
  profitIfSold: any;
  roundTripSim: any;
  egyptAverages?: { vCashBuyAvg: number | null; instaBuyAvg: number | null } | null;
  qatarRates?: { sellAvg: number; buyAvg: number } | null;
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, egyptAverages, qatarRates, t }: Props) {
  const isEgypt = market === 'egypt';
  const [egyOverride, setEgyOverride] = useState('');
  const overrideVal = parseFloat(egyOverride);
  const hasValidOverride = isEgypt && Number.isFinite(overrideVal) && overrideVal > 0;

  const egyptKpis = isEgypt && egyptAverages && qatarRates ? {
    vCashV1: egyptAverages.vCashBuyAvg ? qatarRates.sellAvg / egyptAverages.vCashBuyAvg : null,
    vCashV2: egyptAverages.vCashBuyAvg ? qatarRates.buyAvg / egyptAverages.vCashBuyAvg : null,
    instaPayV1: qatarRates.sellAvg / (hasValidOverride ? overrideVal : (egyptAverages.instaBuyAvg || 1)),
    instaPayV2: egyptAverages.instaBuyAvg ? qatarRates.buyAvg / egyptAverages.instaBuyAvg : null,
  } : null;

  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      <div className="kpis" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(130px, 1fr))` }}>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.bestSell ? fmtPrice(snapshot.bestSell) : '—'}</div>
          <div className="kpi-sub">{t('p2pTopSell')}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t(market === 'qatar' ? 'p2pSellAvgTop5' : 'p2pSellAvgTop10')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>{snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}</div>
          <div className="kpi-sub" style={{ color: 'var(--good)' }}>
            {snapshot.spreadPct ? `+${fmtPrice(snapshot.spreadPct)}% vs Buy Avg` : t('p2pLiveWeightedAvg')}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestRestock')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>{snapshot.bestBuy ? fmtPrice(snapshot.bestBuy) : '—'}</div>
          <div className="kpi-sub">{t('p2pCheapestRestock')}</div>
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

        {isEgypt && egyptKpis && (
          <>
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))', borderColor: 'var(--brand)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--brand)' }}>VCASH V1</div>
              <div className="kpi-val" style={{ color: 'var(--brand)' }}>{egyptKpis.vCashV1 ? egyptKpis.vCashV1.toFixed(4) : '—'}</div>
              <div className="kpi-sub">QA Sell / EG VCash Buy</div>
            </div>
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))', borderColor: 'var(--brand)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--brand)' }}>VCASH V2</div>
              <div className="kpi-val" style={{ color: 'var(--brand)' }}>{egyptKpis.vCashV2 ? egyptKpis.vCashV2.toFixed(4) : '—'}</div>
              <div className="kpi-sub">QA Buy / EG VCash Buy</div>
            </div>
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--good) 6%, var(--surface))', borderColor: 'var(--good)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--good)' }}>INSTAPAY V1</div>
              <div className="kpi-val" style={{ color: 'var(--good)' }}>{egyptKpis.instaPayV1 ? egyptKpis.instaPayV1.toFixed(4) : '—'}</div>
              <div className="kpi-sub">QA Sell / EG Insta Buy</div>
            </div>
            <div className="kpi-card" style={{ background: 'color-mix(in srgb, var(--good) 6%, var(--surface))', borderColor: 'var(--good)' }}>
              <div className="kpi-lbl" style={{ color: 'var(--good)' }}>INSTAPAY V2</div>
              <div className="kpi-val" style={{ color: 'var(--good)' }}>{egyptKpis.instaPayV2 ? egyptKpis.instaPayV2.toFixed(4) : '—'}</div>
              <div className="kpi-sub">QA Buy / EG Insta Buy</div>
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
      </div>

      {isEgypt && (
        <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', marginBottom: 4, display: 'block' }}>EGY Average Buy Override</Label>
            <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0 }}>Affects InstaPay V1 calculation. Computed: {egyptAverages?.instaBuyAvg?.toFixed(2) || '—'}</p>
          </div>
          <div style={{ width: 120 }}>
            <Input 
              type="number" 
              value={egyOverride} 
              onChange={e => setEgyOverride(e.target.value)}
              placeholder="0.00"
              className="h-8 font-black font-mono text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}