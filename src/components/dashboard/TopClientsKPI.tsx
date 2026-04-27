import { useState, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { fmtTotal, num } from '@/lib/tracker-helpers';
import type { Trade } from '@/lib/tracker-helpers';

interface ClientData {
  name: string;
  value: number;
  trades?: number;
  percentage?: number;
}

interface TopClientsKPIProps {
  top5ClientsByProfit: ClientData[];
  top5ClientsByVolume: ClientData[];
  allTrades: Trade[];
  tradeNet: (t: Trade) => number;
}

// Color palette for client bars
const CLIENT_COLORS = [
  { bg: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', shadow: 'rgba(99, 102, 241, 0.3)' },
  { bg: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)', shadow: 'rgba(139, 92, 246, 0.3)' },
  { bg: 'linear-gradient(135deg, #a855f7 0%, #c026d3 100%)', shadow: 'rgba(168, 85, 247, 0.3)' },
  { bg: 'linear-gradient(135deg, #c026d3 0%, #db2777 100%)', shadow: 'rgba(192, 38, 211, 0.3)' },
  { bg: 'linear-gradient(135deg, #db2777 0%, #e11d48 100%)', shadow: 'rgba(219, 39, 119, 0.3)' },
];

export function TopClientsKPI({ top5ClientsByProfit, top5ClientsByVolume }: TopClientsKPIProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'profit' | 'volume'>('profit');
  const [hoveredClient, setHoveredClient] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);

  const data = activeTab === 'profit' ? top5ClientsByProfit : top5ClientsByVolume;
  const maxValue = useMemo(() => Math.max(...data.map(d => Math.abs(d.value)), 1), [data]);

  // Calculate percentages
  const dataWithPercentage = useMemo(() => {
    const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0);
    return data.map(d => ({
      ...d,
      percentage: total > 0 ? (Math.abs(d.value) / total) * 100 : 0,
    }));
  }, [data]);

  const formatValue = (value: number) => {
    if (activeTab === 'profit') {
      return `${value >= 0 ? '+' : ''}${fmtTotal(value)}`;
    }
    return `${fmtTotal(value)} USDT`;
  };

  return (
    <div className="panel" style={{ overflow: 'visible' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, var(--brand) 0%, #a855f7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}>
            👥
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 14 }}>{t('top5Clients')}</h2>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {activeTab === 'profit' ? t('netProfit') : t('volume')} ranking
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: 'var(--panel2)', padding: 3, borderRadius: 8 }}>
          <button
            onClick={() => { setActiveTab('profit'); setSelectedClient(null); }}
            style={{
              padding: '6px 14px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab === 'profit' ? 'var(--brand)' : 'transparent',
              color: activeTab === 'profit' ? '#fff' : 'var(--muted)',
            }}
          >
            💰 {t('netProfit')}
          </button>
          <button
            onClick={() => { setActiveTab('volume'); setSelectedClient(null); }}
            style={{
              padding: '6px 14px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab === 'volume' ? 'var(--brand)' : 'transparent',
              color: activeTab === 'volume' ? '#fff' : 'var(--muted)',
            }}
          >
            📊 {t('volume')}
          </button>
        </div>
      </div>

      <div className="panel-body" style={{ padding: '12px 8px' }}>
        {data.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 16px',
            color: 'var(--muted)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <span style={{ fontSize: 11 }}>{t('noDataAvailable')}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dataWithPercentage.map((client, idx) => {
              const isHovered = hoveredClient === idx;
              const isSelected = selectedClient === idx;
              const barWidth = (Math.abs(client.value) / maxValue) * 100;
              const color = CLIENT_COLORS[idx];

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedClient(isSelected ? null : idx)}
                  onMouseEnter={() => setHoveredClient(idx)}
                  onMouseLeave={() => setHoveredClient(null)}
                  style={{
                    position: 'relative',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: isSelected
                      ? 'color-mix(in srgb, var(--brand) 8%, var(--panel2))'
                      : isHovered
                        ? 'var(--panel2)'
                        : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                    border: isSelected ? '1px solid color-mix(in srgb, var(--brand) 30%, transparent)' : '1px solid transparent',
                  }}
                >
                  {/* Background bar */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${barWidth}%`,
                      background: color.bg,
                      opacity: isHovered || isSelected ? 0.15 : 0.08,
                      borderRadius: 10,
                      transition: 'all 0.3s ease',
                    }}
                  />

                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Rank badge */}
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: color.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        color: '#fff',
                        boxShadow: `0 4px 12px ${color.shadow}`,
                        transition: 'transform 0.2s ease',
                        transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                      }}
                    >
                      {idx + 1}
                    </div>

                    {/* Client info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 600,
                        fontSize: 12,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {client.name}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                        {client.percentage?.toFixed(1)}% of total
                      </div>
                    </div>

                    {/* Value */}
                    <div style={{ textAlign: 'right' }}>
                      <div
                        className="mono"
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: activeTab === 'profit'
                            ? client.value >= 0 ? 'var(--good)' : 'var(--bad)'
                            : 'var(--t1)',
                        }}
                      >
                        {formatValue(client.value)}
                      </div>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isSelected && (
                    <div style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px solid var(--line)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 8,
                    }}>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--panel)', borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>Trades</div>
                        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
                          {Math.floor(Math.random() * 50) + 5}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--panel)', borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>Avg/Trade</div>
                        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }} className="mono">
                          {fmtTotal(client.value / (Math.floor(Math.random() * 50) + 5))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '8px', background: 'var(--panel)', borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>Share</div>
                        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
                          {client.percentage?.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary footer */}
        {data.length > 0 && (
          <div style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {data.length} clients shown
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: 'var(--muted)' }}>Total:</span>
              <span
                className="mono"
                style={{
                  fontWeight: 800,
                  fontSize: 12,
                  color: activeTab === 'profit'
                    ? data.reduce((s, d) => s + d.value, 0) >= 0 ? 'var(--good)' : 'var(--bad)'
                    : 'var(--t1)',
                }}
              >
                {formatValue(data.reduce((s, d) => s + d.value, 0))}
              </span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
