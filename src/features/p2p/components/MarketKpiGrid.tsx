import { useMemo, useState } from 'react';
import { P2PSnapshot, MarketId } from '../types';
import { computeDistinctMerchantAverage } from '../utils/converters';
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

interface EgyptFxCard {
  label: string;
  numeratorLabel: string;
  numeratorValue: number;
  denominatorValue: number;
  isOverride?: boolean;
  marketDenominatorValue?: number | null;
}

export function MarketKpiGrid({ snapshot, market, todaySummary, profitIfSold, roundTripSim, qatarRates, egyBuyOverride, onEgyBuyOverrideChange, t }: Props) {
  const isEgypt = market === 'egypt';
  const isKsa = market === 'ksa';
  const [overrideInput, setOverrideInput] = useState(egyBuyOverride != null ? String(egyBuyOverride) : '');

  const appliedEgyptBuyOverride = egyBuyOverride != null && Number.isFinite(egyBuyOverride) && egyBuyOverride > 0
    ? egyBuyOverride
    : null;

  const fxRate = isKsa && qatarRates?.sellAvg && snapshot.buyAvg
    ? qatarRates.sellAvg / snapshot.buyAvg
    : null;

  const fxRateV2 = isKsa && qatarRates?.sellAvg && snapshot.sellAvg
    ? qatarRates.sellAvg / snapshot.sellAvg
    : null;

  const hasVodafoneCash = (offer: P2PSnapshot['buyOffers'][number]) =>
    (offer.paymentMethodCategories ?? []).includes('vodafone_cash');

  const hasOnlyInstaPayOrBank = (offer: P2PSnapshot['buyOffers'][number]) => {
    const categories = offer.paymentMethodCategories ?? [];
    return categories.length > 0
      && categories.some((category) => category === 'instapay' || category === 'bank')
      && categories.every((category) => category === 'instapay' || category === 'bank');
  };

  const vcashBuyTop20 = useMemo(
    () => computeDistinctMerchantAverage(snapshot.buyOffers.filter(hasVodafoneCash), 'lowest'),
    [snapshot.buyOffers]
  );

  const instaPayBankBuyTop20 = useMemo(
    () => computeDistinctMerchantAverage(snapshot.buyOffers.filter(hasOnlyInstaPayOrBank), 'lowest'),
    [snapshot.buyOffers]
  );

  const egyptFxCards = useMemo(() => {
    if (!isEgypt || !qatarRates) return [] as EgyptFxCard[];

    const cards: EgyptFxCard[] = [];

    if (vcashBuyTop20 != null && vcashBuyTop20 > 0) {
      cards.push(
        {
          label: 'VCash V1',
          numeratorLabel: 'QA Sell average',
          numeratorValue: qatarRates.sellAvg,
          denominatorValue: vcashBuyTop20,
        },
        {
          label: 'VCash V2',
          numeratorLabel: 'QA Buy average',
          numeratorValue: qatarRates.buyAvg,
          denominatorValue: vcashBuyTop20,
        }
      );
    }

    if (instaPayBankBuyTop20 != null && instaPayBankBuyTop20 > 0) {
      cards.push(
        {
          label: 'InstaPay V1',
          numeratorLabel: 'QA Sell average',
          numeratorValue: qatarRates.sellAvg,
          denominatorValue: appliedEgyptBuyOverride ?? instaPayBankBuyTop20,
          isOverride: appliedEgyptBuyOverride != null,
          marketDenominatorValue: instaPayBankBuyTop20,
        },
        {
          label: 'InstaPay V2',
          numeratorLabel: 'QA Buy average',
          numeratorValue: qatarRates.buyAvg,
          denominatorValue: instaPayBankBuyTop20,
        }
      );
    }

    return cards;
  }, [appliedEgyptBuyOverride, instaPayBankBuyTop20, isEgypt, qatarRates, vcashBuyTop20]);

  const handleOverrideApply = () => {
    const value = Number(overrideInput);
    if (Number.isFinite(value) && value > 0) {
      onEgyBuyOverrideChange?.(value);
      return;
    }

    onEgyBuyOverrideChange?.(null);
    setOverrideInput('');
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
        {!isEgypt && (
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pSpread')}</div>
            <div className="kpi-val" style={{ color: snapshot.spread != null && snapshot.spread > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {snapshot.spread != null ? fmtPrice(snapshot.spread) : '—'}
            </div>
            <div className="kpi-sub">{snapshot.spreadPct != null ? `${fmtPrice(snapshot.spreadPct)}%` : t('p2pNoData')}</div>
          </div>
        )}
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
            <div className="kpi-lbl">SAR → QAR FX</div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / fxRate)}
            </div>
            <div className="kpi-sub">1 SAR ≈ {fmtPrice(fxRate)} QAR</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ KSA Buy {snapshot.buyAvg ? fmtPrice(snapshot.buyAvg) : '—'}
            </div>
          </div>
        )}
        {fxRateV2 != null && (
          <div className="kpi-card">
            <div className="kpi-lbl">SAR V2</div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(1 / fxRateV2)}
            </div>
            <div className="kpi-sub">1 QAR ≈ {fmtPrice(1 / fxRateV2)} SAR</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              QA Sell {qatarRates?.sellAvg ? fmtPrice(qatarRates.sellAvg) : '—'} ÷ KSA Sell {snapshot.sellAvg ? fmtPrice(snapshot.sellAvg) : '—'}
            </div>
          </div>
        )}
        {egyptFxCards.map((card) => (
          <div key={card.label} className="kpi-card">
            <div className="kpi-lbl">
              {card.label}
              {card.isOverride && (
                <span style={{ fontSize: '8px', color: 'hsl(var(--destructive))', marginLeft: '4px', fontWeight: 600 }}>MANUAL</span>
              )}
            </div>
            <div className="kpi-val" style={{ color: 'var(--accent-color, hsl(var(--primary)))' }}>
              {fmtPrice(card.numeratorValue / card.denominatorValue)}
            </div>
            <div className="kpi-sub">{card.numeratorLabel} / EG Buy (top 20)</div>
            <div className="kpi-sub" style={{ opacity: 0.55, fontSize: '9px', marginTop: '2px' }}>
              {card.numeratorLabel} {fmtPrice(card.numeratorValue)} ÷ EG Buy {fmtPrice(card.denominatorValue)}
              {card.isOverride && card.marketDenominatorValue != null ? (
                <span style={{ marginLeft: '4px', opacity: 0.7 }}>(mkt: {fmtPrice(card.marketDenominatorValue)})</span>
              ) : null}
            </div>
          </div>
        ))}
        {isEgypt && (
          <div className="kpi-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
            <div className="kpi-lbl">EGY Average Buy</div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder={instaPayBankBuyTop20 ? fmtPrice(instaPayBankBuyTop20) : '—'}
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
              {appliedEgyptBuyOverride != null && (
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
                  ×
                </button>
              )}
            </div>
            <div className="kpi-sub" style={{ fontSize: '9px' }}>
              {appliedEgyptBuyOverride != null
                ? `Override: ${fmtPrice(appliedEgyptBuyOverride)} EGP`
                : `Using EG Buy (top 20)${instaPayBankBuyTop20 ? ': ' + fmtPrice(instaPayBankBuyTop20) : ''}`
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
