import { useMemo, useState } from 'react';
import { P2PSnapshot, MarketId } from '../types';
import { filterSnapshotByPaymentMethods } from '../utils/converters';
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
  egyBuyOverride?: number | null;
  onEgyBuyOverrideChange?: (v: number | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, qatarRates, egyBuyOverride, onEgyBuyOverrideChange, t }: Props) {
  const isCrossMarket = (market === 'egypt' || market === 'ksa');
  const isEgypt = market === 'egypt';
  const currLabel = isEgypt ? 'EGP' : market === 'ksa' ? 'SAR' : '';
  const buyLabel = isEgypt ? 'EG Buy' : 'KSA Buy';
  const sellLabel = isEgypt ? 'EG Sell' : 'KSA Sell';

  // Local input state for the override field
  const [overrideInput, setOverrideInput] = useState(egyBuyOverride != null ? String(egyBuyOverride) : '');

  // FX rate: Qatar sell avg ÷ local buy avg
  const fxRate = isCrossMarket && qatarRates?.sellAvg && snapshot.buyAvg
    ? qatarRates.sellAvg / snapshot.buyAvg
    : null;
  const fxRateV2 = isCrossMarket && qatarRates?.sellAvg && snapshot.sellAvg
    ? qatarRates.sellAvg / snapshot.sellAvg
    : null;

  // Egypt-specific payment rail KPIs
  const vcashKpi = useMemo(() => {
    if (!isEgypt || !qatarRates?.sellAvg) return null;
    const filtered = filterSnapshotByPaymentMethods(snapshot, new Set(['vodafone_cash']));
    if (!filtered.buyAvg || !filtered.sellAvg) return null;
    const fxBuy = qatarRates.sellAvg / filtered.buyAvg;
    const fxSell = qatarRates.sellAvg / filtered.sellAvg;
    return { buyAvg: filtered.buyAvg, sellAvg: filtered.sellAvg, fxBuy, fxSell };
  }, [isEgypt, qatarRates, snapshot]);

  // Bank/InstaPay KPI — uses egyBuyOverride if set
  const bankKpi = useMemo(() => {
    if (!isEgypt || !qatarRates?.sellAvg) return null;
    const filtered = filterSnapshotByPaymentMethods(
      snapshot,
      new Set(['instapay', 'bank']),
      new Set(['wallet'])
    );
    const computedBuyAvg = filtered.buyAvg;
    const effectiveBuyAvg = (egyBuyOverride != null && egyBuyOverride > 0) ? egyBuyOverride : computedBuyAvg;
    if (!effectiveBuyAvg || !filtered.sellAvg) return null;
    const fxBuy = qatarRates.sellAvg / effectiveBuyAvg;
    const fxSell = qatarRates.sellAvg / filtered.sellAvg;
    const isOverride = egyBuyOverride != null && egyBuyOverride > 0;
    return { buyAvg: effectiveBuyAvg, sellAvg: filtered.sellAvg, fxBuy, fxSell, isOverride, computedBuyAvg };
  }, [isEgypt, qatarRates, snapshot, egyBuyOverride]);

  const handleOverrideApply = () => {
    const v = Number(overrideInput);
    if (Number.isFinite(v) && v > 0) {
      onEgyBuyOverrideChange?.(v);
    } else {
      onEgyBuyOverrideChange?.(null);
      setOverrideInput('');
    }
  };

  const handleOverrideClear = () => {
    onEgyBuyOverrideChange?.(null);
    setOverrideInput('');
  };

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
        {/* Egypt VCash KPI */}
        {vcashKpi && (
          <div className="kpi-card">
            <div className="kpi-lbl">VCash → QAR FX</div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / vcashKpi.fxBuy)}
            </div>
            <div className="kpi-sub">1 EGP ≈ {fmtPrice(vcashKpi.fxBuy)} QAR</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ VCash Buy {fmtPrice(vcashKpi.buyAvg)}
            </div>
          </div>
        )}
        {/* Egypt InstaPay+Bank KPI — supports manual override */}
        {bankKpi && (
          <div className="kpi-card">
            <div className="kpi-lbl">
              Bank/InstaPay → QAR FX
              {bankKpi.isOverride && (
                <span style={{ fontSize: '8px', color: 'hsl(var(--destructive))', marginLeft: '4px', fontWeight: 600 }}>MANUAL</span>
              )}
            </div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / bankKpi.fxBuy)}
            </div>
            <div className="kpi-sub">1 EGP ≈ {fmtPrice(bankKpi.fxBuy)} QAR</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ Bank Buy {fmtPrice(bankKpi.buyAvg)}
              {bankKpi.isOverride && bankKpi.computedBuyAvg ? (
                <span style={{ marginLeft: '4px', opacity: 0.7 }}>(mkt: {fmtPrice(bankKpi.computedBuyAvg)})</span>
              ) : null}
            </div>
          </div>
        )}
        {/* EGY Average Buy override control — Egypt only */}
        {isEgypt && (
          <div className="kpi-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
            <div className="kpi-lbl">EGY Average Buy</div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder={snapshot.buyAvg ? fmtPrice(snapshot.buyAvg) : '—'}
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleOverrideApply(); }}
                style={{
                  width: '80px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleOverrideApply}
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  cursor: 'pointer',
                }}
              >
                Set
              </button>
              {egyBuyOverride != null && (
                <button
                  onClick={handleOverrideClear}
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid hsl(var(--border))',
                    background: 'transparent',
                    color: 'hsl(var(--destructive))',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="kpi-sub" style={{ fontSize: '9px' }}>
              {egyBuyOverride != null
                ? `Override: ${fmtPrice(egyBuyOverride)} EGP`
                : `Using market avg${snapshot.buyAvg ? ': ' + fmtPrice(snapshot.buyAvg) : ''}`
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
