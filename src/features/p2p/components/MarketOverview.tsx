import { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartNoAxesCombined, Layers, RefreshCw, Users, Wallet } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { MarketConfig, P2PHistoryPoint, P2PSnapshot } from '../types';

interface Props {
  snapshot: P2PSnapshot;
  history: P2PHistoryPoint[];
  market: MarketConfig;
  fetchedAt: string | null;
  refreshing: boolean;
  refresh: () => void;
  side: 'buy' | 'sell';
}

export function MarketOverview({ snapshot, history, market, fetchedAt, refreshing, refresh, side }: Props) {
  const t = useT();
  const [range, setRange] = useState('7d');
  const gradient = useId().replace(/:/g, '');
  const points = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - (range === '1d' ? 1 : range === '7d' ? 7 : 30) * 864e5;
    return history.filter(point => point.ts >= cutoff);
  }, [history, range]);
  const prices = points.flatMap(point => [point.buyAvg, point.sellAvg]).filter((price): price is number => price != null && price > 0);
  const offers = [...snapshot.buyOffers, ...snapshot.sellOffers];
  const merchants = new Set(offers.map(offer => offer.nick)).size;
  const listed = offers.reduce((total, offer) => total + offer.available, 0);
  const number = (value: number | null, digits = 4) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const dayAgo = history.filter(point => point.ts <= Date.now() - 864e5).at(-1);
  const kpis = [
    { label: t('p2pBestRestock'), value: snapshot.bestBuy, previous: dayAgo?.bestBuy },
    { label: t('p2pBuyAvgLabel'), value: snapshot.buyAvg, previous: dayAgo?.buyAvg },
    { label: t('p2pSellAvgLabel'), value: snapshot.sellAvg, previous: dayAgo?.sellAvg },
    { label: t('p2pBestSell'), value: snapshot.bestSell, previous: dayAgo?.bestSell },
  ];
  return <>
    <section className="pm-overview pm-panel" aria-label={t('pmOverview')}>
      <div className="pm-section-head"><h2>{t('pmOverview')} <span className="pm-country-name">({t(market.id === 'qatar' ? 'pmQatar' : 'pmEgypt')})</span></h2>
        <span className="pm-freshness">{fetchedAt ? <><span className="pm-dot" />{t('pmUpdated')} {new Date(fetchedAt).toLocaleTimeString(t.lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })}</> : t('p2pWaitingFirstSync')}
          <button type="button" onClick={refresh} disabled={refreshing} aria-label={t('p2pRefresh')}><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /></button>
        </span>
      </div>
      <div className="pm-overview-grid">{kpis.map((kpi, index) => <div className="pm-metric" key={kpi.label}>
        <span>{kpi.label}</span><strong className={index === 0 || index === 3 ? 'pm-positive' : ''}>{number(kpi.value)}</strong><small>{market.currency}/USDT</small>{kpi.value != null && kpi.previous != null && kpi.previous > 0 ? <small className={kpi.value > kpi.previous ? 'pm-rate-up' : 'pm-positive'}>{kpi.value > kpi.previous ? '↗ +' : '↘ '}{(((kpi.value - kpi.previous) / kpi.previous) * 100).toFixed(2)}%</small> : <small className="pm-rate-empty">—</small>}
      </div>)}</div>
    </section>
    <div className="pm-analysis">
      <section className="pm-panel pm-chart">
        <div className="pm-section-head"><h2><ChartNoAxesCombined size={14} />{t('pmTrend')} <small>({market.currency}/USDT)</small></h2>
          <div className="pm-chart-ranges">{['1d', '7d', '30d', 'all'].map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value === 'all' ? t('all') : value.toUpperCase()}</button>)}</div>
        </div>
        {points.length ? <div className="pm-chart-canvas" dir="ltr"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 7, bottom: 0, left: -16 }}>
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--pm-green)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--pm-green)" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid stroke="var(--pm-line)" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={ts => new Date(ts).toLocaleDateString(t.lang, { month: 'short', day: 'numeric' })} tick={{ fontSize: 8 }} minTickGap={35} axisLine={false} tickLine={false} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 8 }} tickFormatter={value => Number(value).toFixed(market.id === 'qatar' ? 2 : 1)} axisLine={false} tickLine={false} width={48} />
            <Tooltip labelFormatter={ts => new Date(Number(ts)).toLocaleString(t.lang)} formatter={(value: number) => [number(value), t(side === 'buy' ? 'p2pBuyAvgLabel' : 'p2pSellAvgLabel')]} contentStyle={{ borderRadius: 10, fontSize: 11, background: 'var(--pm-panel)', color: 'var(--pm-ink)', borderColor: 'var(--pm-line)' }} />
            <Area type="monotone" dataKey={side === 'buy' ? 'buyAvg' : 'sellAvg'} stroke="var(--pm-green)" fill={`url(#${gradient})`} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer></div> : <div className="pm-chart-empty">{t('p2pNoData')}</div>}
      </section>
      <section className="pm-panel pm-insights"><h2>{t('pmInsights')}</h2><div className="pm-insights-grid">
        {[
          { icon: Wallet, label: t('pmListed'), value: listed.toLocaleString('en-US', { maximumFractionDigits: 0 }), unit: 'USDT' },
          { icon: Users, label: t('pmMerchants'), value: String(merchants), unit: t('pmBothSides') },
          { icon: ChartNoAxesCombined, label: t('pmPriceRange'), value: prices.length ? `${number(Math.min(...prices))} – ${number(Math.max(...prices))}` : '—', unit: market.currency },
          { icon: Layers, label: t('pmSpread'), value: number(snapshot.spread), unit: snapshot.spreadPct == null ? market.currency : `${number(snapshot.spreadPct, 2)}%` },
        ].map(item => <div className="pm-insight" key={item.label}><span className="pm-insight-icon"><item.icon size={14} /></span><div><span>{item.label}</span><strong>{item.value}</strong><small>{item.unit}</small></div></div>)}
      </div></section>
    </div>
  </>;
}
