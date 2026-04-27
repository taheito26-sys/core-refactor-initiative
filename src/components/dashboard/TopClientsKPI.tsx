import { useState, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { fmtTotal } from '@/lib/tracker-helpers';

interface ClientData {
  name: string;
  value: number;
  trades: number;
}

interface TopClientsKPIProps {
  top5ClientsByProfit: ClientData[];
  top5ClientsByVolume: ClientData[];
  allTrades: unknown[];
  tradeNet: (t: any) => number;
}

const RANK_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#c026d3', '#db2777',
];

export function TopClientsKPI({ top5ClientsByProfit, top5ClientsByVolume }: TopClientsKPIProps) {
  const t = useT();
  const [tab, setTab] = useState<'profit' | 'volume'>('profit');
  const [expanded, setExpanded] = useState<number | null>(null);

  const data = tab === 'profit' ? top5ClientsByProfit : top5ClientsByVolume;
  const maxVal = useMemo(() => Math.max(...data.map(d => Math.abs(d.value)), 1), [data]);
  const total = useMemo(() => data.reduce((s, d) => s + Math.abs(d.value), 0), [data]);

  const fmt = (v: number) =>
    tab === 'profit'
      ? `${v >= 0 ? '+' : ''}${fmtTotal(v)}`
      : `${fmtTotal(v)} USDT`;

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-head">
        <h2>{t('top5Clients')}</h2>
        <div style={{ display: 'flex', gap: 2, background: 'var(--panel2)', padding: 2, borderRadius: 6 }}>
          {(['profit', 'volume'] as const).map(k => (
            <span
              key={k}
              onClick={() => { setTab(k); setExpanded(null); }}
              style={{
                fontSize: 9, padding: '3px 10px', cursor: 'pointer', borderRadius: 4,
                fontWeight: tab === k ? 700 : 400,
                color: tab === k ? '#fff' : 'var(--muted)',
                background: tab === k ? 'var(--brand)' : 'transparent',
                transition: 'all .15s ease',
              }}
            >
              {k === 'profit' ? t('netProfit') : t('volume')}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="panel-body" style={{ padding: '6px 8px' }}>
        {data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted)', fontSize: 11 }}>
            {t('noDataAvailable')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.map((c, i) => {
              const pct = total > 0 ? (Math.abs(c.value) / total) * 100 : 0;
              const barW = (Math.abs(c.value) / maxVal) * 100;
              const color = RANK_COLORS[i];
              const isOpen = expanded === i;

              return (
                <div
                  key={i}
                  onClick={() => setExpanded(isOpen ? null : i)}
                  style={{
                    position: 'relative',
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'background .15s',
                    background: isOpen ? 'var(--panel2)' : 'transparent',
                  }}
                >
                  {/* Bar bg */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${barW}%`, background: color, opacity: 0.07,
                    borderRadius: 6, transition: 'width .3s ease',
                  }} />

                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Rank */}
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>

                    {/* Name + trades */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {c.name}
                      </div>
                    </div>

                    {/* Value */}
                    <span
                      className="mono"
                      style={{
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                        color: tab === 'profit'
                          ? c.value >= 0 ? 'var(--good)' : 'var(--bad)'
                          : 'var(--t1)',
                      }}
                    >
                      {fmt(c.value)}
                    </span>
                  </div>

                  {/* Expanded row */}
                  {isOpen && (
                    <div style={{
                      display: 'flex', gap: 12, marginTop: 6, paddingTop: 6,
                      borderTop: '1px solid var(--line)', fontSize: 10, color: 'var(--muted)',
                    }}>
                      <span>📈 {c.trades} trades</span>
                      <span>⌀ {c.trades > 0 ? fmtTotal(c.value / c.trades) : '—'}{tab === 'volume' ? ' USDT' : ''}/trade</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text)' }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {data.length > 0 && (
          <div style={{
            marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line)',
            display: 'flex', justifyContent: 'space-between', fontSize: 10,
          }}>
            <span style={{ color: 'var(--muted)' }}>{data.length} clients</span>
            <span className="mono" style={{
              fontWeight: 700,
              color: tab === 'profit'
                ? data.reduce((s, d) => s + d.value, 0) >= 0 ? 'var(--good)' : 'var(--bad)'
                : 'var(--t1)',
            }}>
              Σ {fmt(data.reduce((s, d) => s + d.value, 0))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
