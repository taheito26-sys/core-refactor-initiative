import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, CalendarDays, Crown, Layers, Target, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ZoomControls } from '@/components/shared/ZoomControls';
import { useDashboardFilters } from '../../dashboard-filters';
import {
  deltaWindow, pctChange, scopePoints, sparkline, summarize, summarizeWithPrevious, topClients,
  type DashPoint, type RangeWindow,
} from '../../dashboard-model';
import { Sparkline } from './Sparkline';
import { DhSelect } from './DhSelect';
import { ProfitTrendCard } from './ProfitTrendCard';
import { DashboardFilterSheet, DashboardSearchSheet } from './DashboardSheets';

/** A theme colour a card is tinted with. Every one resolves through the active theme's variables. */
export type Tone = 'good' | 'bad' | 'warn' | 'brand' | 'brand2' | 't5';
const toneVar = (tone: Tone) => `var(--${tone === 't5' ? 't5' : tone})`;

export interface HomeTile {
  key: string;
  label: string;
  Icon: LucideIcon | (() => ReactNode);
  tone: Tone;
  value: string;
  unit?: string;
  /** Colour of the value itself: a status, or the card's own tone. */
  valueTone?: Tone;
  /** Colour of the unit next to the value; the brand colour when not given. */
  unitTone?: Tone;
  /** The icon sits in a circle by default, or a rounded square. */
  square?: boolean;
  /** Scale the trend line to its own range (prices) instead of from zero. */
  fit?: boolean;
  sub?: ReactNode;
  spark?: number[];
  path?: string;
}

export interface HomeCash {
  total: string;
  unit: string;
  counted: number;
  active: number;
  accounts: Array<{ name: string; balance: number; shown: string }>;
}

interface DashboardHomeProps {
  points: DashPoint[];
  allPoints: DashPoint[];
  win: RangeWindow;
  rangeText: string;
  now: number;
  lang: 'en' | 'ar';
  isAdminView?: boolean;
  money: (qar: number) => string;
  parts: (qar: number) => { n: string; u: string };
  tiles: HomeTile[];
  /** Extra figures shown under the main ones. */
  moreTiles: HomeTile[];
  /** Trading fees paid inside the selected period. */
  fees: number;
  cash: HomeCash;
  onGo: (path: string) => void;
  /** The My KPIs card. */
  children?: ReactNode;
}

const SEGMENT_TONES: Tone[] = ['good', 'brand', 't5', 'warn', 'bad'];
/** Gold, silver, bronze, then two soft reds, each mixed from the theme's own colours. */
const MEDALS = [
  'var(--warn)',
  'color-mix(in srgb, var(--muted) 65%, var(--card-bg))',
  'color-mix(in srgb, var(--warn) 55%, var(--bad))',
  'color-mix(in srgb, var(--bad) 70%, var(--card-bg))',
  'color-mix(in srgb, var(--bad) 55%, var(--card-bg))',
];
const BARS = [
  'var(--good)',
  'var(--brand)',
  'var(--t5)',
  'color-mix(in srgb, var(--t5) 55%, var(--card-bg))',
  'color-mix(in srgb, var(--bad) 55%, var(--card-bg))',
];

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <div className="dh-delta none">—</div>;
  const up = pct >= 0;
  return (
    <div className={`dh-delta ${up ? 'up' : 'down'}`}>
      <p>{up ? <ArrowUp /> : <ArrowDown />}<b>{up ? '+' : ''}{pct.toFixed(1)}%</b></p>
      <span>{label}</span>
    </div>
  );
}

/** Real flag artwork for the two currencies of the corridor; these are country flags, not theme colours. */
function QatarFlag({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const id = useId();
  const zig = Array.from({ length: 9 }, (_, i) => `${cx - r * 0.35 + (i % 2 ? 0 : r * 0.28)},${cy - r + (i * 2 * r) / 8}`).join(' ');
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 2} style={{ fill: 'var(--card-bg)', filter: 'drop-shadow(0 1px 2px color-mix(in srgb, var(--text) 25%, transparent))' }} />
      <clipPath id={id}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <g clipPath={`url(#${id})`}>
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill="#fff" />
        <polygon points={`${zig} ${cx + r},${cy + r} ${cx + r},${cy - r}`} fill="#8a1538" />
      </g>
    </g>
  );
}

function EgyptFlag({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const id = useId();
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 2.4} style={{ fill: 'var(--warn)' }} />
      <circle cx={cx} cy={cy} r={r + 0.6} style={{ fill: 'var(--card-bg)' }} />
      <clipPath id={id}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <g clipPath={`url(#${id})`}>
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 0.67} fill="#ce1126" />
        <rect x={cx - r} y={cy - r * 0.33} width={r * 2} height={r * 0.67} fill="#fff" />
        <rect x={cx - r} y={cy + r * 0.33} width={r * 2} height={r * 0.67} fill="#000" />
        <circle cx={cx} cy={cy} r={r * 0.2} fill="#c09300" />
      </g>
    </g>
  );
}

function HeroArt() {
  return (
    <svg className="dh-hero-art" viewBox="0 0 165 75" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
      <defs>
        <linearGradient id="dhBars" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--good)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand)' }} />
        </linearGradient>
      </defs>
      <path d="M0 75 C14 52 30 60 48 48 C70 34 84 44 104 30 C122 18 140 26 165 6 L165 75 Z" style={{ fill: 'var(--card-bg)', opacity: 0.4 }} />
      {[22, 30, 26, 36, 40, 50].map((h, i) => (
        <rect key={i} x={90 + i * 12} y={74 - h} width="8.5" height={h} rx="2.2" fill="url(#dhBars)" />
      ))}
      <path d="M55 74 C75 62 92 52 108 38 S130 14 142 7" fill="none" strokeWidth="2.8" strokeLinecap="round" style={{ stroke: 'var(--good)' }} />
      <path d="M133 3.5 L148 4 L142.5 17.5 Z" style={{ fill: 'var(--good)' }} />
      <circle cx="25" cy="58" r="13" style={{ fill: 'var(--good)', stroke: 'var(--card-bg)', strokeWidth: 2 }} />
      <text x="25" y="64" textAnchor="middle" fontSize="16" fontWeight="800" style={{ fill: 'var(--card-bg)' }}>₮</text>
      <QatarFlag cx={86} cy={36} r={11.5} />
      <EgyptFlag cx={146} cy={46} r={12.5} />
    </svg>
  );
}

/** The merchant dashboard home: every colour comes from the active theme's variables. */
export function DashboardHome({
  points, allPoints, win, rangeText, now, lang, isAdminView, money, parts, tiles, moreTiles, fees, cash, onGo, children,
}: DashboardHomeProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const { scope, setScope } = useDashboardFilters();

  // Everything on this page is sized in units that follow the screen's real width, so it fills a
  // small phone and a large one alike; the app zoom is divided back out so zoom still enlarges it.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const fit = () => {
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) || 1;
      const width = el.clientWidth * zoom;
      el.style.setProperty('--s', Math.max(0.85, Math.min(1.45, width / 430)).toFixed(3));
      if (width < 430) el.setAttribute('data-narrow', ''); else el.removeAttribute('data-narrow');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [clientMetric, setClientMetric] = useState<'profit' | 'volume'>('profit');

  const { cur } = useMemo(() => summarizeWithPrevious(points, win), [points, win]);
  const dwin = useMemo(() => deltaWindow(win, now), [win, now]);
  const { cur: dCur, prev: dPrev } = useMemo(() => summarizeWithPrevious(points, dwin), [points, dwin]);
  const changeByClient = useMemo(
    () => (win.prevFrom == null ? new Map(topClients(points, dwin, clientMetric, 500).map(c => [c.name, c.change])) : null),
    [points, win, dwin, clientMetric],
  );
  const volSpark = useMemo(() => sparkline(points, win, p => p.vol, 6), [points, win]);
  const ownVolSpark = useMemo(() => sparkline(points, win, p => (p.own ? p.vol : 0), 6), [points, win]);
  const netSpark = useMemo(() => sparkline(points, win, p => p.net, 12), [points, win]);
  const clients = useMemo(() => topClients(points, win, clientMetric), [points, win, clientMetric]);
  const maxOrders = Math.max(1, ...clients.map(c => c.orders));

  const stats: Array<{ key: string; label: string; Icon: LucideIcon; tone: Tone; unit: string; value: number; pct: number | null; spark: number[]; kind: 'bars' | 'line' }> = [
    { key: 'trading', label: t('dhTradingVolume'), Icon: BarChart3, tone: 'good', unit: 'var(--brand)', value: cur.ownVol, pct: pctChange(dCur.ownVol, dPrev?.ownVol), spark: ownVolSpark, kind: 'bars' },
    { key: 'total', label: t('dhTotalVolume'), Icon: Layers, tone: 't5', unit: 'var(--t5)', value: cur.vol, pct: pctChange(dCur.vol, dPrev?.vol), spark: volSpark, kind: 'bars' },
    { key: 'net', label: t('dhMyNetProfit'), Icon: Target, tone: 'good', unit: 'var(--text)', value: cur.net, pct: pctChange(dCur.net, dPrev?.net), spark: netSpark, kind: 'line' },
  ];

  const scopeLabel = scope === 'own' ? t('dhOwnOrders') : scope === 'partner' ? t('dhPartnerOrders') : t('dhAllOrders');
  const [dFrom, dTo] = rangeText.split(' – ');
  const monthStats = useMemo(() => {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const own = allPoints.filter(p => p.own);
    const label = (ts: number) => new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { month: 'long' });
    return [
      { label: label(start), all: summarize(allPoints, start, now), own: summarize(own, start, now) },
      { label: label(prevStart), all: summarize(allPoints, prevStart, start - 1), own: summarize(own, prevStart, start - 1) },
    ];
  }, [allPoints, now, lang]);
  const margin = cur.vol > 0 ? (cur.net / cur.vol) * 100 : 0;
  const totalCash = cash.accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);

  const renderTile = (tile: HomeTile) => (
    <section key={tile.key} className={`dh-card dh-tile${tile.path ? ' link' : ''}`} style={{ ['--tone' as string]: toneVar(tile.tone) }}
      onClick={tile.path && !isAdminView ? () => onGo(tile.path as string) : undefined}>
      <header>
        <span className={`dh-ic solid${tile.square ? ' sq' : ''}`}><tile.Icon /></span>
        <h3>{tile.label}</h3>
        {tile.path && !isAdminView && <span className="dh-go" aria-hidden="true"><ArrowRight /></span>}
      </header>
      <div className="dh-val" style={tile.valueTone ? { color: toneVar(tile.valueTone) } : undefined}><b>{tile.value}</b>{tile.unit && <small style={{ color: tile.unitTone ? toneVar(tile.unitTone) : undefined }}>{tile.unit}</small>}</div>
      {tile.sub && <div className="dh-sub">{tile.sub}</div>}
      {tile.spark && <Sparkline className="dh-tile-spark" values={tile.spark} color={toneVar(tile.tone)} fit={tile.fit} />}
    </section>
  );

  return (
    <div className="dh" ref={rootRef} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Hero */}
      <section className="dh-hero">
        <div className="dh-hero-t">
          <h1>{t('dhTitle')}</h1>
          <p>{t('dhSubtitle')}</p>
          <ZoomControls className="dh-zoom" showPercent="always" />
        </div>
        <HeroArt />
        <DhSelect
          className="dh-hero-scope"
          value={scope}
          onChange={setScope}
          ariaLabel={scopeLabel}
          options={[{ value: 'all', label: t('dhAllOrders') }, { value: 'own', label: t('dhOwnOrders') }, { value: 'partner', label: t('dhPartnerOrders') }]}
        />
        <div className="dh-hero-range">
          <CalendarDays />
          <span>{dFrom}<br />{dTo ? `– ${dTo}` : ''}</span>
        </div>
      </section>

      {/* Three headline figures */}
      <div className="dh-stats">
        {stats.map(s => {
          const p = parts(s.value);
          return (
            <section key={s.key} className="dh-card dh-stat" style={{ ['--tone' as string]: toneVar(s.tone) }}>
              <header><span className="dh-ic solid"><s.Icon /></span><h3>{s.label}</h3></header>
              <div className="dh-val"><b>{p.n}</b><small style={{ color: s.unit }}>{p.u}</small></div>
              <Delta pct={s.pct} label={t('dhVsPrev')} />
              <Sparkline className={`dh-stat-spark ${s.kind}`} values={s.spark} color={toneVar(s.tone)} kind={s.kind} />
            </section>
          );
        })}
      </div>

      <ProfitTrendCard
        points={allPoints}
        now={now}
        lang={lang}
        money={money}
        labels={{ title: t('dhProfitTrend'), profit: t('dhProfit'), volume: t('dhVolume'), monthly: t('dhMonthly'), weekly: t('dhWeekly'), daily: t('dhDaily') }}
      />

      {/* Six figures */}
      <div className="dh-tiles">{tiles.map(renderTile)}</div>

      {/* Cash */}
      <section className="dh-card dh-cash" style={{ ['--tone' as string]: 'var(--warn)' }}>
        <div className="dh-cash-l">
          <span className="dh-ic big solid"><Wallet /></span>
          <div>
            <h3>{t('dhCash')}</h3>
            <div className="dh-val"><b>{cash.total}</b><small>{cash.unit}</small></div>
            <div className="dh-sub">{cash.counted} {t('kpiOf')} {cash.active} {cash.counted === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}</div>
          </div>
        </div>
        {totalCash > 0 && (
          <div className="dh-cash-bar">
            {cash.accounts.filter(a => a.balance > 0).map((a, i) => (
              <i key={a.name + i} style={{ flexGrow: a.balance, background: toneVar(SEGMENT_TONES[i % SEGMENT_TONES.length]) }} title={a.name} />
            ))}
          </div>
        )}
        <ul className="dh-cash-legend">
          {cash.accounts.map((a, i) => (
            <li key={a.name + i}><i style={{ background: toneVar(SEGMENT_TONES[i % SEGMENT_TONES.length]) }} />{a.name}<b>{a.shown}</b></li>
          ))}
        </ul>
        {!isAdminView && (
          <button type="button" className="dh-btn out" onClick={() => onGo('/trading/cash')}>{t('dhOpenCash')}<ArrowRight /></button>
        )}
      </section>

      {children}

      {/* Top clients */}
      <section className="dh-card dh-top">
        <header className="dh-top-head">
          <h2><Crown />{t('top5Clients')}</h2>
          <div className="dh-seg sm">
            <button type="button" className={clientMetric === 'profit' ? 'on' : ''} onClick={() => setClientMetric('profit')}>{t('dhNetProfitTab')}</button>
            <button type="button" className={clientMetric === 'volume' ? 'on' : ''} onClick={() => setClientMetric('volume')}>{t('dhVolume')}</button>
          </div>
        </header>
        {clients.length === 0 ? (
          <div className="dh-empty">{t('noDataAvailable')}</div>
        ) : (
          <table className="dh-table">
            <thead>
              <tr><th>#</th><th>{t('dhClient')}</th><th colSpan={2}>{t('dhOrders')}</th><th className="r">{clientMetric === 'profit' ? t('dhNetProfitTab') : t('dhVolume')}</th><th className="r">{t('dhChange')}</th></tr>
            </thead>
            <tbody>
              {clients.map((c, i) => {
                const change = changeByClient ? changeByClient.get(c.name) ?? null : c.change;
                return (
                  <tr key={c.name}>
                    <td><span className="dh-medal" style={{ background: MEDALS[i] }}>{i + 1}</span></td>
                    <td className="dh-client"><span className="dh-avatar" style={{ ['--tone' as string]: toneVar(SEGMENT_TONES[i % SEGMENT_TONES.length]) }}>{c.name.slice(0, 1).toUpperCase()}</span><span>{c.name}</span></td>
                    <td className="dh-ord-n">{c.orders}</td>
                    <td className="dh-ord-bar"><i><em style={{ width: `${(c.orders / maxOrders) * 100}%`, background: BARS[i] }} /></i></td>
                    <td className="r dh-good">{clientMetric === 'profit' && c.value >= 0 ? '+' : ''}{money(c.value)}</td>
                    <td className={`r ${change == null ? '' : change >= 0 ? 'dh-good' : 'dh-bad'}`}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${Math.round(change)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* More metrics */}
      <section className="dh-more">
        <h2 className="dh-sec-t">{t('dhMoreMetrics')}</h2>
        <div className="dh-tiles">{moreTiles.map(renderTile)}</div>
      </section>

      <div className="dh-pair">
        <section className="dh-card dh-stats-list">
          <h2 className="dh-sec-t">{t('dhPeriodStats')}<span>{rangeText}</span></h2>
          {[
            { k: t('dhVolume'), v: money(cur.vol) },
            { k: t('dhCost'), v: money(cur.vol - cur.net - fees) },
            ...(fees > 0 ? [{ k: t('dhFees'), v: money(fees) }] : []),
            { k: t('dhNetProfitTab'), v: money(cur.net), tone: cur.net >= 0 ? 'good' : 'bad' },
            { k: t('dhAvgMargin'), v: `${margin.toFixed(2)}%` },
            { k: t('dhTrades'), v: String(cur.orders) },
          ].map(r => (
            <div key={r.k} className="dh-row"><span>{r.k}</span><b className={r.tone ? `dh-${r.tone}` : ''}>{r.v}</b></div>
          ))}
        </section>
        <section className="dh-card dh-stats-list">
          <h2 className="dh-sec-t">{t('dhThisVsLast')}</h2>
          <div className="dh-months">
            {monthStats.map(m => (
              <div key={m.label}>
                <div className="dh-month-t">{m.label}</div>
                <div className="dh-row"><span>{t('dhOwnLabel')}</span><b>{money(m.own.vol)}</b></div>
                <div className="dh-row"><span>{t('dhTotalLabel')} {t('dhVolume')}</span><b>{money(m.all.vol)}</b></div>
                <div className="dh-row"><span>{t('dhMyNetProfit')}</span><b className={m.all.net >= 0 ? 'dh-good' : 'dh-bad'}>{m.all.net >= 0 ? '+' : ''}{money(m.all.net)}</b></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <DashboardFilterSheet />
      <DashboardSearchSheet points={scopePoints(allPoints, 'all')} />
    </div>
  );
}
