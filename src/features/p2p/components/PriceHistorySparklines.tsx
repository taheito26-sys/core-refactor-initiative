import { useState, useMemo } from 'react';
import { P2PHistoryPoint } from '../types';
import { fmtPrice } from '@/lib/tracker-helpers';

interface Props {
  history: P2PHistoryPoint[];
  dataAgeLabel: string | null;
  t: any;
}

export function PriceHistorySparklines({ history, dataAgeLabel, t }: Props) {
  const [hoveredBar, setHoveredBar] = useState<{ type: 'sell' | 'buy'; index: number } | null>(null);

  const priceBarData = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = history.filter(h => h.ts >= cutoff);
    if (!last24h.length) return { sellBars: [], buyBars: [], sellValues: [], buyValues: [], sellLatest: 0, buyLatest: 0, sellChange: 0, buyChange: 0 };
    
    const sellPts = last24h.filter(p => p.sellAvg != null).map(p => p.sellAvg!);
    const buyPts = last24h.filter(p => p.buyAvg != null).map(p => p.buyAvg!);
    const sellLatest = sellPts.length ? sellPts[sellPts.length - 1] : 0;
    const buyLatest = buyPts.length ? buyPts[buyPts.length - 1] : 0;
    const sellFirst = sellPts.length ? sellPts[0] : sellLatest;
    const buyFirst = buyPts.length ? buyPts[0] : buyLatest;

    const numBars = 12;
    const makeBarArray = (pts: number[]) => {
      if (!pts.length) return Array(numBars).fill(0);
      const step = Math.max(1, Math.floor(pts.length / numBars));
      const bars: number[] = [];
      for (let i = 0; i < pts.length && bars.length < numBars; i += step) bars.push(pts[i]);
      while (bars.length < numBars) bars.push(pts[pts.length - 1]);
      return bars;
    };

    const sellMin = sellPts.length ? Math.min(...sellPts) : 0;
    const sellMax = sellPts.length ? Math.max(...sellPts) : 1;
    const buyMin = buyPts.length ? Math.min(...buyPts) : 0;
    const buyMax = buyPts.length ? Math.max(...buyPts) : 1;

    const normalize = (vals: number[], min: number, max: number) => {
      const range = max - min || 0.01;
      return vals.map(v => Math.max(5, ((v - min) / range) * 100));
    };

    const sellValues = makeBarArray(sellPts);
    const buyValues = makeBarArray(buyPts);

    return {
      sellBars: normalize(sellValues, sellMin, sellMax),
      buyBars: normalize(buyValues, buyMin, buyMax),
      sellValues,
      buyValues,
      sellLatest,
      buyLatest,
      sellChange: sellLatest - sellFirst,
      buyChange: buyLatest - buyFirst,
    };
  }, [history]);

  return (
    <div className="tracker-root panel h-full flex flex-col overflow-hidden">
      <div className="panel-head shrink-0" style={{ padding: '6px 10px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>{t('p2pPriceHistory')}</h2>
        <span className="pill" style={{ fontSize: 8 }}>
          24h Trend {dataAgeLabel && <> · {dataAgeLabel}</>}
        </span>
      </div>
      <div className="panel-body flex-1 min-h-0" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase muted">{t('p2pSellAvgLabel')}</span>
          <span className="font-mono text-[12px] font-extrabold" style={{ color: 'var(--good)' }}>{priceBarData.sellLatest ? fmtPrice(priceBarData.sellLatest) : '—'}</span>
        </div>
        <div className="flex items-end gap-1 h-4 relative">
          {priceBarData.sellBars.map((pct, i) => (
            <div
              key={`sell-${i}`}
              className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
              style={{
                height: `${Math.max(2, pct * 0.16)}px`,
                background: hoveredBar?.type === 'sell' && hoveredBar.index === i
                  ? 'color-mix(in srgb, var(--good) 100%, transparent)'
                  : 'color-mix(in srgb, var(--good) 82%, transparent)',
                transform: hoveredBar?.type === 'sell' && hoveredBar.index === i ? 'scaleY(1.2)' : 'scaleY(1)',
                transformOrigin: 'bottom',
              }}
              onMouseEnter={() => setHoveredBar({ type: 'sell', index: i })}
              onMouseLeave={() => setHoveredBar(null)}
            />
          ))}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase muted">{t('p2pBuyAvgLabel')}</span>
          <span className="font-mono text-[12px] font-extrabold" style={{ color: 'var(--bad)' }}>{priceBarData.buyLatest ? fmtPrice(priceBarData.buyLatest) : '—'}</span>
        </div>
        <div className="flex items-end gap-1 h-4 relative">
          {priceBarData.buyBars.map((pct, i) => (
            <div
              key={`buy-${i}`}
              className="flex-1 rounded-sm cursor-pointer transition-all duration-100"
              style={{
                height: `${Math.max(2, pct * 0.16)}px`,
                background: hoveredBar?.type === 'buy' && hoveredBar.index === i
                  ? 'color-mix(in srgb, var(--bad) 100%, transparent)'
                  : 'color-mix(in srgb, var(--bad) 82%, transparent)',
                transform: hoveredBar?.type === 'buy' && hoveredBar.index === i ? 'scaleY(1.2)' : 'scaleY(1)',
                transformOrigin: 'bottom',
              }}
              onMouseEnter={() => setHoveredBar({ type: 'buy', index: i })}
              onMouseLeave={() => setHoveredBar(null)}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-auto">
          <span className="pill" style={{ fontSize: 8, padding: '1px 5px' }}>{t('sell')} {priceBarData.sellChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.sellChange)}</span>
          <span className="pill" style={{ fontSize: 8, padding: '1px 5px' }}>{t('buy')} {priceBarData.buyChange >= 0 ? '+' : ''}{fmtPrice(priceBarData.buyChange)}</span>
        </div>
      </div>
    </div>
  );
}