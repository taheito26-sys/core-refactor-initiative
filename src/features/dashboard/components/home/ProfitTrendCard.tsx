import { useId, useMemo, useState } from 'react';
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { DhSelect } from './DhSelect';
import { trendBuckets, type DashPoint, type Granularity } from '../../dashboard-model';

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};

interface TrendRow { key: number; label: string; full: string; net: number; vol: number }

interface ProfitTrendCardProps {
  points: DashPoint[];
  now: number;
  lang: 'en' | 'ar';
  /** Formats a QAR amount in the currency the dashboard is showing. */
  money: (qar: number) => string;
  labels: { title: string; profit: string; volume: string; monthly: string; weekly: string; daily: string };
}

/** Profit as bars and volume as a line, by month, week or day, each in the theme's colours. */
export function ProfitTrendCard({ points, now, lang, money, labels }: ProfitTrendCardProps) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';

  const rows = useMemo<TrendRow[]>(() => trendBuckets(points, granularity, now).map(b => {
    const d = new Date(b.start);
    return {
      key: b.start,
      label: granularity === 'month'
        ? d.toLocaleDateString(locale, { month: 'short' })
        : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      full: granularity === 'month'
        ? d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
        : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
      net: Math.round(b.net),
      vol: Math.round(b.vol),
    };
  }), [points, granularity, now, locale]);

  const tick = { fontSize: 8, fill: 'var(--muted)' };
  const gradId = useId();

  return (
    <section className="dh-card dh-trend">
      <header className="dh-trend-head">
        <h2><TrendingUp />{labels.title}</h2>
        <span className="dh-legend"><i style={{ background: 'var(--good)' }} />{labels.profit}</span>
        <span className="dh-legend"><i style={{ background: 'var(--brand)' }} />{labels.volume}</span>
        <DhSelect<Granularity>
          className="dh-trend-sel"
          value={granularity}
          onChange={setGranularity}
          ariaLabel={labels.title}
          options={[{ value: 'month', label: labels.monthly }, { value: 'week', label: labels.weekly }, { value: 'day', label: labels.daily }]}
        />
      </header>
      <div className="dh-trend-chart" dir="ltr">
        <div className="dh-trend-frame" aria-hidden="true" />
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: 'var(--good)', stopOpacity: 0.95 }} />
                <stop offset="1" style={{ stopColor: 'var(--good)', stopOpacity: 0.45 }} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={0} height={16} />
            <YAxis yAxisId="net" tick={tick} tickLine={false} axisLine={false} width={30} tickCount={4} domain={[0, 'auto']} tickFormatter={compact} />
            <YAxis yAxisId="vol" orientation="right" tick={tick} tickLine={false} axisLine={false} width={28} tickCount={4} domain={[0, 'auto']} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: 'color-mix(in srgb, var(--brand) 8%, transparent)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as TrendRow;
                return (
                  <div className="dh-tip">
                    <div className="dh-tip-t">{row.full}</div>
                    <div><i style={{ background: 'var(--good)' }} />{row.net >= 0 ? '+' : ''}{money(row.net)}</div>
                    <div><i style={{ background: 'var(--brand)' }} />{money(row.vol)}</div>
                  </div>
                );
              }}
            />
            <Bar yAxisId="net" dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={15} fill={`url(#${gradId})`} />
            <Line yAxisId="vol" type="monotone" dataKey="vol" stroke="var(--brand)" strokeWidth={1.5} dot={{ r: 2.2, fill: 'var(--brand)', stroke: 'var(--card-bg)', strokeWidth: 0.8 }} activeDot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
