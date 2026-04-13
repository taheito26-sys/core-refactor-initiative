import { useMemo, useState } from 'react';
import type { P2PSnapshot } from '../types';

interface MerchantStat {
  nick: string;
  appearances: number;
  availabilityRatio: number; // appearances / totalSnapshots
  maxAvailable: number;
  avgAvailable: number;
}

function computeStats(
  snapshots: P2PSnapshot[],
  side: 'sell' | 'buy',
): MerchantStat[] {
  const total = snapshots.length;
  if (!total) return [];

  const map = new Map<
    string,
    { appearances: number; availables: number[] }
  >();

  for (const snap of snapshots) {
    const offers = side === 'sell' ? snap.sellOffers : snap.buyOffers;
    const seen   = new Set<string>();
    for (const o of offers) {
      if (seen.has(o.nick)) continue;
      seen.add(o.nick);
      const entry = map.get(o.nick) ?? { appearances: 0, availables: [] };
      entry.appearances++;
      entry.availables.push(o.available);
      map.set(o.nick, entry);
    }
  }

  return Array.from(map.entries()).map(([nick, d]) => ({
    nick,
    appearances: d.appearances,
    availabilityRatio: d.appearances / total,
    maxAvailable: Math.max(...d.availables),
    avgAvailable:
      d.availables.reduce((s, v) => s + v, 0) / d.availables.length,
  }));
}

interface Props {
  snapshots: P2PSnapshot[];
}

export default function MerchantDepthStats({ snapshots }: Props) {
  const [side, setSide] = useState<'sell' | 'buy'>('sell');

  const stats = useMemo(() => computeStats(snapshots, side), [snapshots, side]);

  const topFreq = useMemo(
    () => [...stats].sort((a, b) => b.availabilityRatio - a.availabilityRatio).slice(0, 5),
    [stats],
  );
  const topVol = useMemo(
    () => [...stats].sort((a, b) => b.maxAvailable - a.maxAvailable).slice(0, 5),
    [stats],
  );

  const color = side === 'sell' ? 'var(--good)' : 'var(--bad)';

  return (
    <div className="tracker-root panel">
      <div className="panel-head" style={{ padding: '8px 12px' }}>
        <h2 style={{ fontSize: 11 }}>👥 Merchant Depth</h2>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            className="pill"
            style={{
              fontSize: 9,
              cursor: 'pointer',
              background:
                side === 'sell'
                  ? 'color-mix(in srgb, var(--good) 20%, transparent)'
                  : undefined,
              opacity: side === 'sell' ? 1 : 0.55,
            }}
            onClick={() => setSide('sell')}
          >
            Sell
          </button>
          <button
            className="pill"
            style={{
              fontSize: 9,
              cursor: 'pointer',
              background:
                side === 'buy'
                  ? 'color-mix(in srgb, var(--bad) 20%, transparent)'
                  : undefined,
              opacity: side === 'buy' ? 1 : 0.55,
            }}
            onClick={() => setSide('buy')}
          >
            Restock
          </button>
          <span className="pill" style={{ fontSize: 9 }}>
            {snapshots.length} snaps
          </span>
        </div>
      </div>

      <div
        className="panel-body"
        style={{
          padding: '8px 12px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          minHeight: 100,
        }}
      >
        {/* Top by frequency */}
        <div>
          <div
            className="text-[9px] font-extrabold tracking-widest uppercase muted"
            style={{ marginBottom: 6 }}
          >
            Top by Frequency
          </div>
          {!topFreq.length ? (
            <div style={{ fontSize: 10, opacity: 0.5 }}>No data yet</div>
          ) : (
            topFreq.map((m, i) => (
              <div
                key={m.nick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 9, opacity: 0.5 }}>{i + 1}.</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 90,
                    }}
                  >
                    {m.nick}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      width: 44,
                      height: 4,
                      borderRadius: 2,
                      background: 'var(--line)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${m.availabilityRatio * 100}%`,
                        height: '100%',
                        borderRadius: 2,
                        background: color,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 9, opacity: 0.6, fontFamily: 'monospace' }}>
                    {(m.availabilityRatio * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Top by volume */}
        <div>
          <div
            className="text-[9px] font-extrabold tracking-widest uppercase muted"
            style={{ marginBottom: 6 }}
          >
            Top by Volume
          </div>
          {!topVol.length ? (
            <div style={{ fontSize: 10, opacity: 0.5 }}>No data yet</div>
          ) : (
            topVol.map((m, i) => (
              <div
                key={m.nick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 9, opacity: 0.5 }}>{i + 1}.</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 80,
                    }}
                  >
                    {m.nick}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {m.maxAvailable.toFixed(0)}
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 8,
                      opacity: 0.5,
                    }}
                  >
                    avg {m.avgAvailable.toFixed(0)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
