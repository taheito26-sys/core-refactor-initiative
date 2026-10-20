import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, CalendarDays, Crown, Layers, Target, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useDashboardFilters } from '../../dashboard-filters';
import {
  pctChange, scopePoints, sparkline, summarizeWithPrevious, topClients,
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
  cash: HomeCash;
  onGo: (path: string) => void;
  /** The My KPIs card. */
  children?: ReactNode;
}

const SEGMENT_TONES: Tone[] = ['good', 'brand', 't5', 'warn', 'bad'];
const MEDAL_TONES: Tone[] = ['warn', 'brand2', 'bad', 'brand', 'good'];

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <div className="dh-delta none">—</div>;
  const up = pct >= 0;
  return (
    <div className={`dh-delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUp /> : <ArrowDown />}
      <b>{up ? '+' : ''}{pct.toFixed(1)}%</b>
      <span>{label}</span>
    </div>
  );
}

function HeroArt() {
  return (
    <svg className="dh-hero-art" viewBox="0 0 230 92" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
      <defs>
        <linearGradient id="dhBars" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--good)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand)', stopOpacity: 0.55 }} />
        </linearGradient>
      </defs>
      <ellipse cx="124" cy="86" rx="100" ry="6" style={{ fill: 'var(--brand)', opacity: 0.12 }} />
      {[18, 30, 24, 40, 52, 46, 64].map((h, i) => (
        <rect key={i} x={84 + i * 17} y={86 - h} width="11" height={h} rx="2.5" fill="url(#dhBars)" />
      ))}
      <path d="M72 70 C 100 62, 118 52, 142 38 S 188 14, 214 8" fill="none" strokeWidth="3.2" strokeLinecap="round" style={{ stroke: 'var(--good)' }} />
      <path d="M200 4 L216 7.5 L207 20 Z" style={{ fill: 'var(--good)' }} />
      <circle cx="40" cy="58" r="15" style={{ fill: 'var(--good)' }} />
      <text x="40" y="64.5" textAnchor="middle" fontSize="17" fontWeight="800" style={{ fill: 'var(--card-bg)' }}>₮</text>
      <circle cx="140" cy="22" r="13" style={{ fill: 'var(--brand)' }} />
      <text x="140" y="25" textAnchor="middle" fontSize="7.5" fontWeight="800" style={{ fill: 'var(--card-bg)' }}>QAR</text>
      <circle cx="176" cy="36" r="13" style={{ fill: 'var(--warn)' }} />
      <text x="176" y="39" textAnchor="middle" fontSize="7.5" fontWeight="800" style={{ fill: 'var(--card-bg)' }}>EGP</text>
    </svg>
  );
}

/** The merchant dashboard home: every colour comes from the active theme's variables. */
export function DashboardHome({
  points, allPoints, win, rangeText, now, lang, isAdminView, money, parts, tiles, cash, onGo, children,
}: DashboardHomeProps) {
  const t = useT();
  const { scope, setScope } = useDashboardFilters();
  const [clientMetric, setClientMetric] = useState<'profit' | 'volume'>('profit');

  const { cur, prev } = useMemo(() => summarizeWithPrevious(points, win), [points, win]);
  const volSpark = useMemo(() => sparkline(points, win, p => p.vol, 6), [points, win]);
  const ownVolSpark = useMemo(() => sparkline(points, win, p => (p.own ? p.vol : 0), 6), [points, win]);
  const netSpark = useMemo(() => sparkline(points, win, p => p.net, 12), [points, win]);
  const clients = useMemo(() => topClients(points, win, clientMetric), [points, win, clientMetric]);
  const maxOrders = Math.max(1, ...clients.map(c => c.orders));

  const stats: Array<{ key: string; label: string; Icon: LucideIcon; tone: Tone; value: number; pct: number | null; spark: number[]; kind: 'bars' | 'line' }> = [
    { key: 'trading', label: t('dhTradingVolume'), Icon: BarChart3, tone: 'good', value: cur.ownVol, pct: pctChange(cur.ownVol, prev?.ownVol), spark: ownVolSpark, kind: 'bars' },
    { key: 'total', label: t('dhTotalVolume'), Icon: Layers, tone: 't5', value: cur.vol, pct: pctChange(cur.vol, prev?.vol), spark: volSpark, kind: 'bars' },
    { key: 'net', label: t('dhMyNetProfit'), Icon: Target, tone: 'good', value: cur.net, pct: pctChange(cur.net, prev?.net), spark: netSpark, kind: 'line' },
  ];

  const scopeLabel = scope === 'own' ? t('dhOwnOrders') : scope === 'partner' ? t('dhPartnerOrders') : t('dhAllOrders');
  const [dFrom, dTo] = rangeText.split(' – ');
  const totalCash = cash.accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);

  return (
    <div className="dh" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Hero */}
      <section className="dh-hero">
        <div className="dh-hero-t">
          <h1>{t('dhTitle')}</h1>
          <p>{t('dhSubtitle')}</p>
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
              <header><span className="dh-ic"><s.Icon /></span><h3>{s.label}</h3></header>
              <div className="dh-val"><b>{p.n}</b><small>{p.u}</small></div>
              <Delta pct={s.pct} label={t('dhVsPrev')} />
              <Sparkline className="dh-stat-spark" values={s.spark} color={toneVar(s.key === 'total' ? 't5' : s.key === 'net' ? 'good' : 'good')} kind={s.kind} />
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
      <div className="dh-tiles">
        {tiles.map(tile => (
          <section key={tile.key} className={`dh-card dh-tile${tile.path ? ' link' : ''}`} style={{ ['--tone' as string]: toneVar(tile.tone) }}
            onClick={tile.path && !isAdminView ? () => onGo(tile.path as string) : undefined}>
            <header>
              <span className="dh-ic"><tile.Icon /></span>
              <h3>{tile.label}</h3>
              {tile.path && !isAdminView && <span className="dh-go" aria-hidden="true"><ArrowRight /></span>}
            </header>
            <div className="dh-val" style={tile.valueTone ? { color: toneVar(tile.valueTone) } : undefined}><b>{tile.value}</b>{tile.unit && <small>{tile.unit}</small>}</div>
            {tile.sub && <div className="dh-sub">{tile.sub}</div>}
            {tile.spark && <Sparkline className="dh-tile-spark" values={tile.spark} color={toneVar(tile.tone)} />}
          </section>
        ))}
      </div>

      {/* Cash */}
      <section className="dh-card dh-cash" style={{ ['--tone' as string]: 'var(--warn)' }}>
        <div className="dh-cash-l">
          <span className="dh-ic big"><Wallet /></span>
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
              <tr><th>#</th><th>{t('dhClient')}</th><th>{t('dhOrders')}</th><th className="r">{clientMetric === 'profit' ? t('dhNetProfitTab') : t('dhVolume')}</th><th className="r">{t('dhChange')}</th></tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.name}>
                  <td><span className="dh-medal" style={{ ['--tone' as string]: toneVar(MEDAL_TONES[i]) }}>{i + 1}</span></td>
                  <td className="dh-client"><span className="dh-avatar" style={{ ['--tone' as string]: toneVar(SEGMENT_TONES[i % SEGMENT_TONES.length]) }}>{c.name.slice(0, 1).toUpperCase()}</span><span>{c.name}</span></td>
                  <td className="dh-ord"><b>{c.orders}</b><i><em style={{ width: `${(c.orders / maxOrders) * 100}%`, background: toneVar(SEGMENT_TONES[i % SEGMENT_TONES.length]) }} /></i></td>
                  <td className="r dh-good">{clientMetric === 'profit' && c.value >= 0 ? '+' : ''}{money(c.value)}</td>
                  <td className={`r ${c.change == null ? '' : c.change >= 0 ? 'dh-good' : 'dh-bad'}`}>{c.change == null ? '—' : `${c.change >= 0 ? '+' : ''}${Math.round(c.change)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <DashboardFilterSheet />
      <DashboardSearchSheet points={scopePoints(allPoints, 'all')} />
    </div>
  );
}
