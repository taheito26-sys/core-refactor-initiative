import { useMemo } from 'react';
import { fmtPrice, fmtTotal } from '@/lib/tracker-helpers';
import {
  computeFIFO,
  totalStock,
  getWACOP,
  stockCostQAR,
  type TrackerState,
} from '@/lib/tracker-helpers';
import { getCurrentTrackerState } from '@/lib/tracker-backup';
import { useT } from '@/lib/i18n';
import type { P2PSnapshot, P2PHistoryPoint, MarketId } from '../types';
import { MARKET_AVG_TOP } from '../types';

// Egypt payment method regexes
const VCASH_RE = /vodafone|vcash|v[\s-]?cash|فودافون/i;
const INSTA_RE =
  /instapay|insta\s*pay|إنستاباي|\bcib\b|\bnbe\b|national\s*bank|ahli|banque\s*misr|alex\s*bank|\bqnb\b|faisal|arab\s*bank|\bhsbc\b|standard\s*char|\bmeeza\b/i;

interface Props {
  market: MarketId;
  snapshot: P2PSnapshot;
  qatarSnapshot: P2PSnapshot | null;
  history: P2PHistoryPoint[];
  currency: string;
}

export default function MarketKpiGrid({
  market,
  snapshot,
  qatarSnapshot,
  history,
  currency,
}: Props) {
  const t = useT();
  const avgTop  = MARKET_AVG_TOP[market];
  const isEgypt = market === 'egypt';

  // ── Today's summary from history ─────────────────────────────────────────
  const todaySummary = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const pts = history.filter(
      h => new Date(h.ts).toISOString().slice(0, 10) === todayStr,
    );
    if (!pts.length) return null;
    const sells = pts.filter(p => p.sellAvg != null).map(p => p.sellAvg!);
    const buys  = pts.filter(p => p.buyAvg  != null).map(p => p.buyAvg!);
    return {
      highSell: sells.length ? Math.max(...sells) : null,
      lowSell:  sells.length ? Math.min(...sells) : null,
      highBuy:  buys.length  ? Math.max(...buys)  : null,
      lowBuy:   buys.length  ? Math.min(...buys)  : null,
      polls: pts.length,
    };
  }, [history]);

  // ── Non-Egypt: Profit if sold now (tracker inventory) ────────────────────
  const profitIfSold = useMemo(() => {
    if (isEgypt) return null;
    try {
      const stateRaw = getCurrentTrackerState(localStorage);
      if (!stateRaw || !Array.isArray((stateRaw as any).batches) || !(stateRaw as any).batches.length)
        return null;
      const state = stateRaw as unknown as TrackerState;
      const derived  = computeFIFO(state.batches, state.trades || []);
      const stock     = totalStock(derived);
      if (stock <= 0) return null;
      const wacop     = getWACOP(derived);
      const costBasis = stockCostQAR(derived);
      if (!wacop || wacop <= 0) return null;
      const sellAvg = snapshot.sellAvg ?? 0;
      if (!sellAvg) return null;
      return {
        stock,
        costBasis,
        wacop,
        profit: stock * sellAvg - costBasis,
      };
    } catch {
      return null;
    }
  }, [snapshot.sellAvg, isEgypt]);

  // ── Egypt cross-rate KPIs ─────────────────────────────────────────────────
  const egyptKPIs = useMemo(() => {
    if (!isEgypt) return null;
    if (!qatarSnapshot) return null;
    const qaSellAvg = qatarSnapshot.sellAvg;
    const qaBuyAvg  = qatarSnapshot.buyAvg;
    if (!qaSellAvg || !qaBuyAvg) return null;

    const egBuyOffers = snapshot.buyOffers;
    if (!egBuyOffers.length) return null;

    const vCashOffers = egBuyOffers.filter(o =>
      o.methods.some(m => VCASH_RE.test(m)),
    );
    let instaOffers = egBuyOffers.filter(
      o =>
        !o.methods.some(m => VCASH_RE.test(m)) &&
        o.methods.some(m => INSTA_RE.test(m)),
    );
    // Safety fallback: if explicit InstaPay regex yields none, use all non-VCash
    if (!instaOffers.length) {
      instaOffers = egBuyOffers.filter(
        o => !o.methods.some(m => VCASH_RE.test(m)),
      );
    }

    // Deduplicate by nick, take cheapest 20 distinct offers per bucket
    const dedupeTop20 = (offers: typeof egBuyOffers) => {
      const seen = new Set<string>();
      return [...offers]
        .sort((a, b) => a.price - b.price)
        .filter(o => !seen.has(o.nick) && seen.add(o.nick))
        .slice(0, 20);
    };

    const vTop  = dedupeTop20(vCashOffers);
    const iTop  = dedupeTop20(instaOffers);
    const avg   = (arr: typeof vTop) =>
      arr.length ? arr.reduce((s, o) => s + o.price, 0) / arr.length : null;

    const egBuyVCashAvg = avg(vTop);
    const egBuyInstaAvg = avg(iTop);

    return {
      vCashV1:    egBuyVCashAvg ? egBuyVCashAvg / qaSellAvg : null,
      vCashV2:    egBuyVCashAvg ? egBuyVCashAvg / qaBuyAvg  : null,
      instaPayV1: egBuyInstaAvg ? egBuyInstaAvg / qaSellAvg : null,
      instaPayV2: egBuyInstaAvg ? egBuyInstaAvg / qaBuyAvg  : null,
      egBuyVCashAvg,
      egBuyInstaAvg,
      vCashCount: vTop.length,
      instaCount: iTop.length,
    };
  }, [isEgypt, snapshot.buyOffers, qatarSnapshot]);

  const fmt = (v: number | null) => (v ? fmtPrice(v) : '—');

  // Extra cards: non-Egypt profit simulation
  const extraCols = !isEgypt && profitIfSold ? 2 : !isEgypt && snapshot.spreadPct != null ? 1 : 0;
  const coreColsStr = `repeat(${6 + extraCols}, minmax(0, 1fr))`;

  return (
    <div className="tracker-root" style={{ background: 'transparent' }}>
      {/* ── Core KPIs (6 + optional extras) ─────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: coreColsStr }}>

        {/* Best Sell */}
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>
            {fmt(snapshot.bestSell)}
          </div>
          <div className="kpi-sub">Top sell {currency}</div>
        </div>

        {/* Sell Avg */}
        <div className="kpi-card">
          <div className="kpi-lbl">SELL AVG (TOP {avgTop})</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>
            {fmt(snapshot.sellAvg)}
          </div>
          <div className="kpi-sub" style={{ color: 'var(--good)' }}>
            {snapshot.spreadPct
              ? `+${fmtPrice(snapshot.spreadPct)}% spread`
              : 'Live avg'}
          </div>
        </div>

        {/* Best Restock */}
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pBestRestock')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>
            {fmt(snapshot.bestBuy)}
          </div>
          <div className="kpi-sub">Cheapest restock {currency}</div>
        </div>

        {/* Spread */}
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pSpread')}</div>
          <div
            className="kpi-val"
            style={{
              color:
                snapshot.spread != null && snapshot.spread > 0
                  ? 'var(--good)'
                  : 'var(--bad)',
            }}
          >
            {fmt(snapshot.spread)}
          </div>
          <div className="kpi-sub">
            {snapshot.spreadPct != null
              ? `${fmtPrice(snapshot.spreadPct)}%`
              : '—'}
          </div>
        </div>

        {/* Today High Sell */}
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayHighSell')}</div>
          <div className="kpi-val" style={{ color: 'var(--good)' }}>
            {todaySummary?.highSell ? fmtPrice(todaySummary.highSell) : '—'}
          </div>
          <div className="kpi-sub">
            {t('p2pLow')}{' '}
            {todaySummary?.lowSell ? fmtPrice(todaySummary.lowSell) : '—'}
            {' · '}{todaySummary?.polls ?? 0} polls
          </div>
        </div>

        {/* Today Low Buy */}
        <div className="kpi-card">
          <div className="kpi-lbl">{t('p2pTodayLowBuy')}</div>
          <div className="kpi-val" style={{ color: 'var(--bad)' }}>
            {todaySummary?.lowBuy ? fmtPrice(todaySummary.lowBuy) : '—'}
          </div>
          <div className="kpi-sub">
            {t('p2pHigh')}{' '}
            {todaySummary?.highBuy ? fmtPrice(todaySummary.highBuy) : '—'}
          </div>
        </div>

        {/* Non-Egypt: Profit if sold now */}
        {!isEgypt && profitIfSold && (
          <div className="kpi-card">
            <div className="kpi-lbl">{t('p2pProfitIfSoldNow')}</div>
            <div
              className="kpi-val"
              style={{
                color:
                  profitIfSold.profit >= 0 ? 'var(--good)' : 'var(--bad)',
              }}
            >
              {profitIfSold.profit >= 0 ? '+' : ''}
              {fmtTotal(profitIfSold.profit)} {currency}
            </div>
            <div className="kpi-sub">
              {fmtPrice(profitIfSold.stock)} USDT · cost basis
            </div>
          </div>
        )}

        {/* Non-Egypt: Round-trip spread */}
        {!isEgypt && snapshot.spreadPct != null && (
          <div className="kpi-card">
            <div className="kpi-lbl">ROUND-TRIP</div>
            <div
              className="kpi-val"
              style={{
                color:
                  snapshot.spreadPct > 0 ? 'var(--good)' : 'var(--bad)',
              }}
            >
              {fmtPrice(snapshot.spreadPct)}%
            </div>
            <div className="kpi-sub">
              {profitIfSold
                ? `${fmtTotal(
                    profitIfSold.stock * (snapshot.spread ?? 0),
                  )} ${currency} simulated`
                : 'Sell → Restock margin'}
            </div>
          </div>
        )}
      </div>

      {/* ── Egypt cross-rate cards ───────────────────────────────────────── */}
      {isEgypt && egyptKPIs && (
        <div
          className="kpis"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginTop: 6 }}
        >
          <div className="kpi-card" style={{ borderColor: 'var(--warn, #f59e0b)' }}>
            <div className="kpi-lbl">VCASH ÷ QAR SELL</div>
            <div className="kpi-val" style={{ color: 'var(--warn, #f59e0b)' }}>
              {fmt(egyptKPIs.vCashV1)}
            </div>
            <div className="kpi-sub">
              EGP/QAR · {egyptKPIs.vCashCount} offers
            </div>
          </div>

          <div className="kpi-card" style={{ borderColor: 'var(--warn, #f59e0b)' }}>
            <div className="kpi-lbl">VCASH ÷ QAR BUY</div>
            <div className="kpi-val" style={{ color: 'var(--warn, #f59e0b)' }}>
              {fmt(egyptKPIs.vCashV2)}
            </div>
            <div className="kpi-sub">EGP/QAR · vs buy avg</div>
          </div>

          <div className="kpi-card" style={{ borderColor: 'var(--info, #38bdf8)' }}>
            <div className="kpi-lbl">INSTAPAY ÷ QAR SELL</div>
            <div className="kpi-val" style={{ color: 'var(--info, #38bdf8)' }}>
              {fmt(egyptKPIs.instaPayV1)}
            </div>
            <div className="kpi-sub">
              EGP/QAR · {egyptKPIs.instaCount} offers
            </div>
          </div>

          <div className="kpi-card" style={{ borderColor: 'var(--info, #38bdf8)' }}>
            <div className="kpi-lbl">INSTAPAY ÷ QAR BUY</div>
            <div className="kpi-val" style={{ color: 'var(--info, #38bdf8)' }}>
              {fmt(egyptKPIs.instaPayV2)}
            </div>
            <div className="kpi-sub">EGP/QAR · vs buy avg</div>
          </div>
        </div>
      )}
    </div>
  );
}
