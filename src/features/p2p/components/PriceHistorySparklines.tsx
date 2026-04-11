import { useState, useMemo } from 'react';
import { P2PHistoryPoint } from '../types';
import { fmtPrice } from '@/lib/tracker-helpers';
import { format } from 'date-fns';

interface Props {
  history: P2PHistoryPoint[];
  dataAgeLabel: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

export function PriceHistorySparklines({ history, dataAgeLabel, t }: Props) {
  const [hoveredBar, setHoveredBar] = useState<{ type: 'sell' | 'buy'; index: number } | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);

  // Active bar = clicked (pinned) or hovered
  const activeBar = selectedBar ?? hoveredBar?.index ?? null;

  const priceBarData = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = history.filter(h => h.ts >= cutoff);
    if (!last24h.length) return { sellBars: [], buyBars: [], sellValues: [], buyValues: [], sellLatest: 0, buyLatest: 0, sellChange: 0, buyChange: 0, timestamps: [], spreads: [] };
    
    const sellPts = last24h.filter(p => p.sellAvg != null).map(p => ({ val: p.sellAvg!, ts: p.ts, spread: p.spread, buyAvg: p.buyAvg }));
    const buyPts = last24h.filter(p => p.buyAvg != null).map(p => ({ val: p.buyAvg!, ts: p.ts, spread: p.spread, sellAvg: p.sellAvg }));
    const sellLatest = sellPts.length ? sellPts[sellPts.length - 1].val : 0;
    const buyLatest = buyPts.length ? buyPts[buyPts.length - 1].val : 0;
    const sellFirst = sellPts.length ? sellPts[0].val : sellLatest;
    const buyFirst = buyPts.length ? buyPts[0].val : buyLatest;

    const numBars = 12;
    const makeBuckets = (pts: { val: number; ts: number; spread: number | null; buyAvg?: number | null; sellAvg?: number | null }[]) => {
      if (!pts.length) return Array(numBars).fill(null).map(() => ({ val: 0, ts: 0, spread: null as number | null, buyAvg: null as number | null, sellAvg: null as number | null }));
      const step = Math.max(1, Math.floor(pts.length / numBars));
      const buckets: typeof pts = [];
      for (let i = 0; i < pts.length && buckets.length < numBars; i += step) buckets.push(pts[i]);
      while (buckets.length < numBars) buckets.push(pts[pts.length - 1]);
      return buckets;
    };

    const sellBuckets = makeBuckets(sellPts);
    const buyBuckets = makeBuckets(buyPts);

    const sellVals = sellBuckets.map(b => b.val);
    const buyVals = buyBuckets.map(b => b.val);

    const sellMin = sellVals.length ? Math.min(...sellVals) : 0;
    const sellMax = sellVals.length ? Math.max(...sellVals) : 1;
    const buyMin = buyVals.length ? Math.min(...buyVals) : 0;
    const buyMax = buyVals.length ? Math.max(...buyVals) : 1;

    const normalize = (vals: number[], min: number, max: number) => {
      const range = max - min || 0.01;
      return vals.map(v => Math.max(5, ((v - min) / range) * 100));
    };

    return {
      sellBars: normalize(sellVals, sellMin, sellMax),
      buyBars: normalize(buyVals, buyMin, buyMax),
      sellValues: sellVals,
      buyValues: buyVals,
      sellLatest,
      buyLatest,
      sellChange: sellLatest - sellFirst,
      buyChange: buyLatest - buyFirst,
      timestamps: sellBuckets.map(b => b.ts),
      spreads: sellBuckets.map((b, i) => {
        const sell = b.val;
        const buy = buyBuckets[i]?.val ?? 0;
        return sell && buy ? sell - buy : (b.spread ?? null);
      }),
      sellBuckets,
      buyBuckets,
    };
  }, [history]);

  const selected = activeBar !== null ? {
    ts: priceBarData.timestamps?.[activeBar] ?? 0,
    sell: priceBarData.sellValues?.[activeBar] ?? null,
    buy: priceBarData.buyValues?.[activeBar] ?? null,
    spread: priceBarData.spreads?.[activeBar] ?? null,
  } : null;

  const handleBarClick = (index: number) => {
    setSelectedBar(prev => prev === index ? null : index);
  };

  return (
    <div className="tracker-root panel">
      <div className="panel-head" style={{ padding: '8px 12px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{t('p2pPriceHistory')}</h2>
        <span className="pill" style={{ fontSize: 9 }}>
          {t('p2pTrend24h')} {dataAgeLabel && <> · {dataAgeLabel}</>}
        </span>
      </div>
      <div className="panel-body" style={{ padding: '8px 12px 12px', minHeight: 150, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">{t('p2pSellAvgLabel')}</span>
          <span className="font-mono text-[14px] font-extrabold" style={{ color: 'var(--good)' }}>{priceBarData.sellLatest ? fmtPrice(priceBarData.sellLatest) : '—'}</span>
        </div>
        <div className="flex items-end gap-1 h-5 relative">
          {priceBarData.sellBars.map((pct, i) => (
            <div
              key={`sell-${i}`}
              className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
              style={{
                height: `${Math.max(2, pct * 0.22)}px`,
                background: activeBar === i
                  ? 'var(--brand)'
                  : hoveredBar?.type === 'sell' && hoveredBar.index === i
                    ? 'color-mix(in srgb, var(--good) 100%, transparent)'
                    : 'color-mix(in srgb, var(--good) 82%, transparent)',
                transform: activeBar === i ? 'scaleY(1.3)' : 'scaleY(1)',
                transformOrigin: 'bottom',
                outline: activeBar === i ? '1px solid var(--brand)' : 'none',
              }}
              onMouseEnter={() => setHoveredBar({ type: 'sell', index: i })}
              onMouseLeave={() => setHoveredBar(null)}
              onClick={() => handleBarClick(i)}
            />
          ))}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">{t('p2pBuyAvgLabel')}</span>
          <span className="font-mono text-[14px] font-extrabold" style={{ color: 'var(--bad)' }}>{priceBarData.buyLatest ? fmtPrice(priceBarData.buyLatest) : '—'}</span>
        </div>
        <div className="flex items-end gap-1 h-5 relative">
          {priceBarData.buyBars.map((pct, i) => (
            <div
              key={`buy-${i}`}
              className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
              style={{
                height: `${Math.max(2, pct * 0.22)}px`,
                background: activeBar === i
                  ? 'var(--brand)'
                  : hoveredBar?.type === 'buy' && hoveredBar.index === i
                    ? 'color-mix(in srgb, var(--bad) 100%, transparent)'
                    : 'color-mix(in srgb, var(--bad) 82%, transparent)',
                transform: activeBar === i ? 'scaleY(1.3)' : 'scaleY(1)',
                transformOrigin: 'bottom',
                outline: activeBar === i ? '1px solid var(--brand)' : 'none',
              }}
              onMouseEnter={() => setHoveredBar({ type: 'buy', index: i })}
              onMouseLeave={() => setHoveredBar(null)}
              onClick={() => handleBarClick(i)}
            />
          ))}
        </div>

        {/* Selected bar detail panel */}
        {selected && selected.ts > 0 && (
          <div
            className="rounded-md border"
            style={{
              padding: '6px 10px',
              background: 'var(--panel2)',
              borderColor: 'var(--line)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 6,
              fontSize: 10,
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Time</div>
              <div className="font-mono font-bold" style={{ fontSize: 11 }}>
                {format(new Date(selected.ts), 'HH:mm')}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Sell Avg</div>
              <div className="font-mono font-bold" style={{ fontSize: 11, color: 'var(--good)' }}>
                {selected.sell ? fmtPrice(selected.sell) : '—'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Buy Avg</div>
              <div className="font-mono font-bold" style={{ fontSize: 11, color: 'var(--bad)' }}>
                {selected.buy ? fmtPrice(selected.buy) : '—'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Spread</div>
              <div className="font-mono font-bold" style={{ fontSize: 11, color: 'var(--brand)' }}>
                {selected.spread != null ? fmtPrice(selected.spread) : '—'}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <span className="pill" style={{ fontSize: 9 }}>{t('sell')} {priceBarData.sellChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.sellChange)}</span>
          <span className="pill" style={{ fontSize: 9 }}>{t('buy')} {priceBarData.buyChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.buyChange)}</span>
        </div>
      </div>
    </div>
  );
}
