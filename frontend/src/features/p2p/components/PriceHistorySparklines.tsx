import { useMemo } from 'react';
import { fmtPrice } from '@/lib/tracker-helpers';
import type { P2PHistoryPoint } from '../types';

interface Props {
  history: P2PHistoryPoint[];
  nextRefreshIn: number | null; // seconds until next auto-refresh, or null if disabled
}

const NUM_BARS = 12;

function makeBarArray(pts: number[]): number[] {
  if (!pts.length) return Array(NUM_BARS).fill(0);
  const step = Math.max(1, Math.floor(pts.length / NUM_BARS));
  const bars: number[] = [];
  for (let i = 0; i < pts.length && bars.length < NUM_BARS; i += step)
    bars.push(pts[i]);
  while (bars.length < NUM_BARS) bars.push(pts[pts.length - 1]);
  return bars;
}

function normalizeHeights(vals: number[]): number[] {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.01;
  return vals.map(v => Math.max(5, ((v - min) / range) * 100));
}

export default function PriceHistorySparklines({ history, nextRefreshIn }: Props) {
  const data = useMemo(() => {
    if (!history.length)
      return {
        sellBars: Array(NUM_BARS).fill(0),
        buyBars:  Array(NUM_BARS).fill(0),
        sellLatest: 0, buyLatest: 0,
        sellChange: 0, buyChange: 0,
      };

    const sellPts = history.filter(p => p.sellAvg != null).map(p => p.sellAvg!);
    const buyPts  = history.filter(p => p.buyAvg  != null).map(p => p.buyAvg!);

    const sellLatest = sellPts.at(-1) ?? 0;
    const buyLatest  = buyPts.at(-1)  ?? 0;
    const sellFirst  = sellPts[0]     ?? sellLatest;
    const buyFirst   = buyPts[0]      ?? buyLatest;

    return {
      sellBars:   normalizeHeights(makeBarArray(sellPts)),
      buyBars:    normalizeHeights(makeBarArray(buyPts)),
      sellLatest,
      buyLatest,
      sellChange: sellLatest - sellFirst,
      buyChange:  buyLatest  - buyFirst,
    };
  }, [history]);

  const timerStr =
    nextRefreshIn != null
      ? ` · ${Math.floor(nextRefreshIn / 60)}:${String(nextRefreshIn % 60).padStart(2, '0')}`
      : '';

  return (
    <div className="tracker-root panel">
      <div className="panel-head" style={{ padding: '8px 12px' }}>
        <h2 style={{ fontSize: 11 }}>📊 Price History</h2>
        <span className="pill" style={{ fontSize: 9 }}>
          {history.length} pts · 24h{timerStr}
        </span>
      </div>

      <div
        className="panel-body"
        style={{
          padding: '8px 12px 12px',
          minHeight: 130,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Sell sparkline */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">
              Sell Avg
            </span>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono text-[14px] font-extrabold"
                style={{ color: 'var(--good)' }}
              >
                {data.sellLatest ? fmtPrice(data.sellLatest) : '—'}
              </span>
              {data.sellChange !== 0 && (
                <span
                  className="font-mono text-[10px]"
                  style={{
                    color: data.sellChange >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  {data.sellChange >= 0 ? '+' : ''}{fmtPrice(data.sellChange)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-0.5 h-[22px]">
            {data.sellBars.map((pct, i) => (
              <div
                key={`sell-${i}`}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(2, pct * 0.22)}px`,
                  background:
                    'color-mix(in srgb, var(--good) 82%, transparent)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Buy sparkline */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted">
              Buy Avg
            </span>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono text-[14px] font-extrabold"
                style={{ color: 'var(--bad)' }}
              >
                {data.buyLatest ? fmtPrice(data.buyLatest) : '—'}
              </span>
              {data.buyChange !== 0 && (
                <span
                  className="font-mono text-[10px]"
                  style={{
                    color: data.buyChange >= 0 ? 'var(--bad)' : 'var(--good)',
                  }}
                >
                  {data.buyChange >= 0 ? '+' : ''}{fmtPrice(data.buyChange)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-0.5 h-[22px]">
            {data.buyBars.map((pct, i) => (
              <div
                key={`buy-${i}`}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(2, pct * 0.22)}px`,
                  background:
                    'color-mix(in srgb, var(--bad) 82%, transparent)',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
