import { useId, useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowLeftRight, ArrowUp, BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Coins, CreditCard, Network, Percent, Target, TrendingUp, Trophy, type LucideIcon } from 'lucide-react';
import { useTrackerState } from '@/lib/useTrackerState';
import { fmtQRaw, fmtU, fmtP } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { buildCalendarMonth, leadPayment } from '@/features/calendar/calendar-model';
import '@/styles/trading-calendar.css';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayFilter = 'all' | 'profit' | 'loss' | 'inactive';
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmtQRaw(n)}`;
const percent = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

function IconBadge({ icon: Icon, tone = 'green' }: { icon: LucideIcon; tone?: string }) {
  return <span className={`tc-icon tc-icon-${tone}`}><Icon size={19} strokeWidth={2.1} /></span>;
}

function MiniTrend({ values, bars = false, tone = 'green' }: { values: number[]; bars?: boolean; tone?: string }) {
  const id = useId().replace(/:/g, '');
  const max = Math.max(...values.map(Math.abs), 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((n, i) => `${i * 100 / Math.max(values.length - 1, 1)},${54 - (n - min) / span * 48}`).join(' ');
  return <svg className={`tc-mini tc-mini-${tone}`} viewBox="0 0 100 60" aria-hidden="true" preserveAspectRatio="none">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".55" /><stop offset="100%" stopColor="currentColor" stopOpacity=".03" /></linearGradient></defs>
    {bars ? values.map((n, i) => <rect key={i} x={i * 100 / values.length + 3} y={58 - Math.abs(n) / max * 52} width={Math.max(3, 65 / values.length)} height={Math.max(2, Math.abs(n) / max * 52)} rx="2" fill={`url(#${id})`} />) : <><polygon points={`0,60 ${points} 100,60`} fill={`url(#${id})`} /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /></>}
  </svg>;
}

function Metric({ icon, tone, label, children, className = '' }: { icon: LucideIcon; tone?: string; label: string; children: ReactNode; className?: string }) {
  return <article className={`tc-card tc-metric ${className}`}><IconBadge icon={icon} tone={tone} /><div className="tc-metric-body"><h2>{label}</h2>{children}</div></article>;
}

export default function CalendarPage() {
  const { settings } = useTheme();
  const t = useT();
  const { state, derived } = useTrackerState({ lowStockThreshold: settings.lowStockThreshold, priceAlertThreshold: settings.priceAlertThreshold, range: settings.range, currency: settings.currency });
  const [today] = useState(() => new Date());
  const [cal, setCal] = useState(() => ({ year: today.getFullYear(), month: today.getMonth(), day: today.getDate() }));
  const [filter, setFilter] = useState<DayFilter>('all');
  const [showVolume, setShowVolume] = useState(true);
  const [showTrades, setShowTrades] = useState(true);
  const [cumulative, setCumulative] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { year, month, day } = cal;
  const data = useMemo(() => buildCalendarMonth(state, derived, year, month, t.lang), [state, derived, year, month, t.lang]);
  const previousDate = new Date(year, month - 1, 1);
  const previous = useMemo(() => buildCalendarMonth(state, derived, year, month - 1, t.lang), [state, derived, year, month, t.lang]);
  const { mData, totalP, totalT, totalV, monthPayLead, totalPayCount, wins, tradeDays, bestDay, worstDay, avgMargin, winRate } = data;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthLabel = `${t(MONTHS[month])} ${year}`;
  const dateLabel = (d: number) => new Date(year, month, d).toLocaleDateString(t.lang === 'ar' ? 'ar-QA' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const selected = mData[day];
  const chartData = Object.entries(mData).map(([d, value]) => ({ day: Number(d), profit: value.profit, cumulative: 0 }));
  let running = 0;
  chartData.forEach(d => { running += d.profit; d.cumulative = running; });
  const profitTrend = chartData.map(d => d.cumulative);
  const tradeTrend = Object.values(mData).filter(d => d.trades > 0).map(d => d.trades);
  const volumeTrend = Object.values(mData).filter(d => d.volumeQAR > 0).map(d => d.volumeQAR);
  const monthUSDT = Object.values(mData).flatMap(d => d.tradeList).reduce((sum, tr) => sum + tr.amountUSDT, 0);
  const profitChange = previous.totalP !== 0 ? (totalP - previous.totalP) / Math.abs(previous.totalP) * 100 : null;
  const changeLabel = profitChange === null ? t('tcNoPrevious') : `${percent(profitChange)} ${t('tcVs')} ${t(MONTHS[previousDate.getMonth()])} ${previousDate.getFullYear()}`;
  const moveMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setCal({ year: next.getFullYear(), month: next.getMonth(), day: 1 });
    setShowAll(false);
  };
  const moveDay = (delta: number) => {
    const next = new Date(year, month, day + delta);
    setCal({ year: next.getFullYear(), month: next.getMonth(), day: next.getDate() });
    setShowAll(false);
  };
  const active = selected.trades > 0 || selected.paymentCount > 0;
  const visibleTrades = showAll ? selected.tradeList : selected.tradeList.slice(0, 4);
  const detailMargin = selected.trades ? selected.marginSum / selected.trades : 0;
  const detailRate = selected.trades ? selected.wins / selected.trades * 100 : 0;
  const previousDay = mData[day - 1];
  const dailyChange = previousDay?.profit ? (selected.profit - previousDay.profit) / Math.abs(previousDay.profit) * 100 : null;
  const filters = [{ id: 'all', label: t('all') }, { id: 'profit', label: t('tcProfitDays') }, { id: 'loss', label: t('tcLossDays') }, { id: 'inactive', label: t('tcNoActivity') }] as const;

  return <main className="trading-calendar" dir={t.isRTL ? 'rtl' : 'ltr'}>
    <header className="tc-heading"><div><h1>{t('tcTitle')}</h1><p>{t('tcSubtitle')}</p></div><div className="tc-heading-tools">
      <label className="tc-month-picker"><CalendarDays size={19} /><span>{monthLabel}</span><ChevronDown size={14} /><input type="month" aria-label={t('tcChooseMonth')} value={`${year}-${String(month + 1).padStart(2, '0')}`} onChange={e => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) { setCal({ year: y, month: m - 1, day: 1 }); setShowAll(false); } }} /></label>
      <span className="tc-monthly"><TrendingUp size={19} />{t('tcMonthly')}</span>
    </div></header>

    <div className="tc-metrics">
    <section className="tc-metrics-top" aria-label={t('tcSummary')}>
      <Metric icon={BarChart3} label={t('monthlyProfit')} className="tc-profit-card"><strong className={`tc-value tc-value-xl ${totalP < 0 ? 'tc-negative' : 'tc-positive'}`}>{signed(totalP)} <small>QAR</small></strong><p className={profitChange !== null && profitChange < 0 ? 'tc-negative' : 'tc-positive'}>{profitChange !== null && (profitChange < 0 ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}{changeLabel}</p><MiniTrend values={profitTrend} /></Metric>
      <Metric icon={Network} tone="blue" label={t('totalTrades')}><strong className="tc-value tc-value-xl">{totalT}</strong><p>{signed(totalT - previous.totalT)} {t('tcLastMonth')}</p><MiniTrend values={tradeTrend.length ? tradeTrend : [0]} bars tone="blue" /></Metric>
      <Metric icon={CalendarDays} tone="orange" label={t('tradingDays')} className="tc-trading-days"><strong className="tc-value">{tradeDays} <small className="tc-muted">/ {daysInMonth}</small></strong><div className="tc-extremes"><div><span>{t('tcBestDay')}</span><b className="tc-positive">{bestDay ? signed(bestDay[1].profit) : '—'}</b><small>{bestDay ? `${t(MONTHS[month]).slice(0, 3)} ${bestDay[0]}` : '—'}</small></div><div><span>{t('tcWorstDay')}</span><b className="tc-negative">{worstDay ? signed(worstDay[1].profit) : '—'}</b><small>{worstDay ? `${t(MONTHS[month]).slice(0, 3)} ${worstDay[0]}` : '—'}</small></div></div></Metric>
    </section>
    <section className="tc-metrics-bottom" aria-label={t('monthlyVolume')}>
      <Metric icon={Coins} tone="purple" label={t('monthlyVolume')}><strong className="tc-value">{fmtQRaw(totalV)} <small>QAR</small></strong><p>{fmtU(monthUSDT)} USDT</p><MiniTrend values={volumeTrend.length ? volumeTrend : [0]} bars tone="purple" /></Metric>
      <Metric icon={Target} label={t('winRate')} className="tc-win-card"><div className="tc-ring" style={{ background: `conic-gradient(var(--tc-green) ${winRate * 360}deg, var(--tc-panel3) 0deg)` }}><strong>{(winRate * 100).toFixed(0)}%</strong></div><p>{wins} / {totalT} {t('trades')}</p></Metric>
      <Metric icon={Percent} label={t('avgMargin')}><strong className="tc-value">{percent(avgMargin)}</strong><p className="tc-positive">{t('tcLastMonth')} {percent(avgMargin - previous.avgMargin)}</p><MiniTrend values={Object.values(mData).map(d => d.trades ? d.marginSum / d.trades : 0)} /></Metric>
      <Metric icon={CreditCard} tone="purple" label={t('calPayments')}><strong className="tc-value">{fmtQRaw(monthPayLead?.amount ?? 0)} <small>{monthPayLead?.currency ?? 'QAR'}</small></strong><p>{totalPayCount} {t('calPaymentsReceived')}</p>{monthPayLead?.others.map(p => <p key={p.currency}>{fmtQRaw(p.amount)} {p.currency}</p>)}</Metric>
    </section>

    </div>

    <div className="tc-workspace">
      <section className="tc-card tc-calendar-panel" aria-label={monthLabel}>
        <div className="tc-section-heading"><h2>{monthLabel}</h2><div className="tc-navigation"><button type="button" onClick={() => moveMonth(-1)} aria-label={t('prev')}><ChevronLeft size={16} /></button><button type="button" onClick={() => { setCal({ year: today.getFullYear(), month: today.getMonth(), day: today.getDate() }); setShowAll(false); }}>{t('today')}</button><button type="button" onClick={() => moveMonth(1)} aria-label={t('next')}><ChevronRight size={16} /></button></div></div>
        <div className="tc-toolbar"><div className="tc-filters" aria-label={t('tcFilters')}>{filters.map(f => <button key={f.id} type="button" className={`${filter === f.id ? 'is-active' : ''} ${f.id === 'loss' ? 'tc-loss-filter' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div><div className="tc-display-options"><button type="button" aria-pressed={showVolume} onClick={() => setShowVolume(v => !v)}>{t('tcShowVolume')}</button><button type="button" aria-pressed={showTrades} onClick={() => setShowTrades(v => !v)}>{t('tcShowTrades')}</button></div></div>
        <div className="tc-weekdays">{DAYS.map(d => <span key={d}>{t(d)}</span>)}</div>
        <div className="tc-days">
          {Array.from({ length: firstDay }, (_, i) => <div key={`empty-${i}`} className="tc-day tc-day-empty" aria-hidden="true" />)}
          {Object.entries(mData).map(([key, d]) => {
            const n = Number(key);
            const hasActivity = d.trades > 0 || d.paymentCount > 0;
            const matches = filter === 'all' || (filter === 'profit' && d.profit > 0) || (filter === 'loss' && d.profit < 0) || (filter === 'inactive' && !hasActivity);
            const isToday = n === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const payment = leadPayment(d.paymentTotals);
            return <button key={n} type="button" aria-label={`${dateLabel(n)} · ${t('tcDailyProfit')} ${signed(d.profit)} QAR · ${d.trades} ${t('trades')} · ${d.paymentCount} ${t('calPayments')}`} aria-pressed={day === n} aria-current={isToday ? 'date' : undefined} onClick={() => { setCal(c => ({ ...c, day: n })); setShowAll(false); }} className={`tc-day ${d.profit > 0 ? 'tc-day-profit' : d.profit < 0 ? 'tc-day-loss' : d.paymentCount > 0 ? 'tc-day-payment' : ''} ${day === n ? 'is-selected' : ''} ${isToday ? 'is-today' : ''} ${!matches ? 'is-filtered' : ''}`}>
              <span className="tc-day-number">{n}</span>{d.trades > 0 && <strong className={d.profit < 0 ? 'tc-negative' : 'tc-positive'}>{signed(d.profit)}</strong>}
              {showVolume && d.trades > 0 && <span className="tc-day-volume">{fmtQRaw(d.volumeQAR)}</span>}
              {d.paymentCount > 0 && d.trades === 0 && <span className="tc-day-volume tc-positive">{fmtQRaw(payment?.amount ?? 0)} <small>{payment?.currency}</small></span>}
              {showTrades && hasActivity && <span className="tc-day-count">{d.trades > 0 && `${d.trades}${t('tcTradeShort')}`}{d.trades > 0 && d.paymentCount > 0 && ' · '}{d.paymentCount > 0 && `${d.paymentCount}${t('tcPaymentShort')}`}</span>}
            </button>;
          })}
          {Array.from({ length: (7 - (firstDay + daysInMonth) % 7) % 7 }, (_, i) => <div key={`end-${i}`} className="tc-day tc-day-empty" aria-hidden="true" />)}
        </div>
      </section>

      <aside className="tc-card tc-day-panel" aria-label={dateLabel(day)}>
        <div className="tc-section-heading"><h2>{dateLabel(day)}</h2><div className="tc-navigation"><button type="button" aria-label={t('tcPreviousDay')} onClick={() => moveDay(-1)}><ChevronLeft size={15} /></button><button type="button" aria-label={t('tcNextDay')} onClick={() => moveDay(1)}><ChevronRight size={15} /></button></div></div>
        <div className={`tc-daily-profit ${selected.profit < 0 ? 'is-loss' : ''}`}><IconBadge icon={TrendingUp} /><div><span>{t('tcDailyProfit')}</span><strong className={selected.profit < 0 ? 'tc-negative' : 'tc-positive'}>{signed(selected.profit)} <small>QAR</small></strong>{dailyChange !== null && <p>{percent(dailyChange)} {t('tcVs')} {new Date(year, month, day - 1).toLocaleDateString(t.lang === 'ar' ? 'ar-QA' : 'en-US', { month: 'short', day: 'numeric' })}</p>}</div>{bestDay && Number(bestDay[0]) === day && <Trophy className="tc-trophy" size={17} aria-label={t('tcBestDay')} />}<MiniTrend values={selected.tradeList.length ? selected.tradeList.map(tr => tr.net) : [0]} bars /></div>
        <div className="tc-day-metrics">
          <div><IconBadge icon={Coins} tone="purple" /><div><span>{t('volume')}</span><strong>{fmtQRaw(selected.volumeQAR)} <small>QAR</small></strong><small>{fmtU(selected.tradeList.reduce((s, tr) => s + tr.amountUSDT, 0))} USDT</small></div></div>
          <div><IconBadge icon={ArrowLeftRight} tone="blue" /><div><span>{t('trades')}</span><strong>{selected.trades}</strong></div></div>
          <div><IconBadge icon={Percent} tone="slate" /><div><span>{t('avgMargin')}</span><strong>{percent(detailMargin)}</strong></div></div>
          <div><IconBadge icon={Target} tone="slate" /><div><span>{t('winRate')}</span><strong>{detailRate.toFixed(0)}%</strong><small>{selected.wins} / {selected.trades} {t('trades')}</small></div></div>
        </div>
        <div className="tc-trades-heading"><h3>{t('tcTradesOnDay')} ({selected.trades})</h3>{selected.trades > 4 && <button type="button" onClick={() => setShowAll(v => !v)}>{showAll ? t('tcShowLess') : t('tcViewAll')} <span aria-hidden="true">→</span></button>}</div>
        {!selected.trades && <p className="tc-empty-state">{t('tcNoTrades')}</p>}
        <div className="tc-trade-list">{visibleTrades.map(tr => <details key={tr.id} className="tc-trade"><summary><IconBadge icon={ArrowDown} tone="red" /><span className="tc-trade-name"><b>{t('sell')} USDT</b><small>{fmtU(tr.amountUSDT)} USDT</small></span><span className="tc-trade-price"><b>{fmtP(tr.sellPriceQAR)}</b><small>{fmtQRaw(tr.rev)} QAR</small></span></summary><div className="tc-trade-expanded"><span>{t('time')}<b>{new Date(tr.ts).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' })}</b></span><span>{t('avgBuy')}<b>{fmtP(tr.avgBuy)}</b></span><span>{t('net')}<b className={tr.net < 0 ? 'tc-negative' : 'tc-positive'}>{signed(tr.net)} QAR</b></span><span>{t('margin')}<b>{percent(tr.margin)}</b></span></div></details>)}</div>
        {!showAll && selected.trades > 4 && <button type="button" className="tc-more-trades" onClick={() => setShowAll(true)}>+{selected.trades - 4} {t('tcMoreTrades')}<ChevronRight size={15} /></button>}
        {selected.paymentCount > 0 && <section className="tc-payments"><h3>{t('calPayments')} ({selected.paymentCount})</h3>{[...selected.paymentList].sort((a, b) => a.ts - b.ts).map(p => <div className="tc-payment" key={p.id}><IconBadge icon={CreditCard} tone="purple" /><span><b>{p.customer}</b><small>{p.note || t('tcReceived')}</small></span><strong>{fmtQRaw(p.amount)} {p.currency}</strong></div>)}</section>}
        {!active && <div className="tc-no-activity"><CalendarDays size={30} /><span>{t('tcNoActivity')}</span></div>}
      </aside>
    </div>

    <section className="tc-card tc-summary"><div className="tc-section-heading"><h2>{t('tcSummary')} <span>— {monthLabel}</span></h2><div className="tc-chart-tabs"><button type="button" aria-pressed={!cumulative} onClick={() => setCumulative(false)}>{t('tcDailyChart')}</button><button type="button" aria-pressed={cumulative} onClick={() => setCumulative(true)}>{t('tcCumulative')}</button></div></div><div className="tc-summary-body"><div className="tc-chart" role="img" aria-label={`${cumulative ? t('tcCumulative') : t('tcDailyChart')} · ${monthLabel} · ${signed(totalP)} QAR`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {cumulative ? <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--tc-line)" /><XAxis dataKey="day" axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 10, fill: 'var(--tc-muted)' }} /><YAxis axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v) >= 1000 ? `${v / 1000}K` : String(v)} tick={{ fontSize: 10, fill: 'var(--tc-muted)' }} /><Tooltip contentStyle={{ background: 'var(--tc-card)', color: 'var(--tc-text)', border: '1px solid var(--tc-line)', borderRadius: 7 }} labelStyle={{ color: 'var(--tc-text)' }} itemStyle={{ color: 'var(--tc-text)' }} formatter={(v: number) => [`${signed(v)} QAR`, t('tcCumulative')]} labelFormatter={d => dateLabel(Number(d))} /><ReferenceLine y={0} stroke="var(--tc-line)" /><Area dataKey="cumulative" stroke="var(--tc-green)" fill="var(--tc-accent-bg)" strokeWidth={2} isAnimationActive={false} /></AreaChart> : <BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--tc-line)" /><XAxis dataKey="day" axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 10, fill: 'var(--tc-muted)' }} /><YAxis axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v) >= 1000 ? `${v / 1000}K` : String(v)} tick={{ fontSize: 10, fill: 'var(--tc-muted)' }} /><Tooltip contentStyle={{ background: 'var(--tc-card)', color: 'var(--tc-text)', border: '1px solid var(--tc-line)', borderRadius: 7 }} labelStyle={{ color: 'var(--tc-text)' }} itemStyle={{ color: 'var(--tc-text)' }} formatter={(v: number) => [`${signed(v)} QAR`, t('tcDailyProfit')]} labelFormatter={d => dateLabel(Number(d))} cursor={{ fill: 'var(--tc-panel)' }} /><ReferenceLine y={0} stroke="var(--tc-line)" /><Bar dataKey="profit" maxBarSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false}>{chartData.map(d => <Cell key={d.day} fill={d.profit < 0 ? 'var(--tc-red)' : 'var(--tc-positive)'} />)}</Bar></BarChart>}
      </ResponsiveContainer>{!totalT && <span className="tc-chart-empty">{t('tcNoMonth')}</span>}
    </div><div className="tc-summary-totals"><div><span>{t('tcTotalProfit')}</span><strong className={totalP < 0 ? 'tc-negative' : 'tc-positive'}>{signed(totalP)} QAR</strong></div><div><span>{t('tcTotalVolume')}</span><strong>{fmtQRaw(totalV)} QAR</strong></div><div><span>{t('totalTrades')}</span><strong>{totalT}</strong></div><div><span>{t('tradingDays')}</span><strong>{tradeDays} / {daysInMonth}</strong></div></div></div></section>
  </main>;
}
