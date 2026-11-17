import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Crown, Layers, LayoutDashboard, ListChecks, Target, Wallet, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { MerchantHero, ThMain, ThRoot, ThTiles, type ThTile } from '@/features/taheito/kit';
import { calendarMonthComparison, pctChange, scopePoints, summarize, summarizeWithPrevious, topClients } from '../../dashboard-model';
import { DashboardHome, type HomeTile } from './DashboardHome';
import { DashboardFilterSheet, DashboardSearchSheet } from './DashboardSheets';
import { ProfitTrendCard } from './ProfitTrendCard';

type Props = Omit<ComponentProps<typeof DashboardHome>, 'bare'>;

const CLASSES = ['t1', 't2', 't3', 't4'];
const SEGMENTS = ['var(--th-a)', 'var(--th-ad)', 'var(--th-c2a)', 'var(--th-a2)', 'var(--th-edge)'];
const MEDALS = ['#e0a516', '#9aa7b8', '#c7803a', 'var(--th-ad)', 'var(--th-ad)'];

/** One white card of the dashboard: an icon, a title, an optional action, then the content. */
function Card({ icon: Icon, title, action, className, children }: { icon: LucideIcon; title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`ch-card th-dc ${className ?? ''}`}>
      <header className="th-dc-h"><span className="th-dc-ic"><Icon aria-hidden="true" /></span><h3>{title}</h3>{action && <span className="th-dc-act">{action}</span>}</header>
      {children}
    </section>
  );
}

const Row = ({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) => (
  <div className="th-dc-row"><span>{k}</span><b className={tone ? `th-${tone}` : undefined}>{v}</b></div>
);

/**
 * The merchant dashboard in the Taheito look: all the figures edge to edge in one card, then white cards laid out
 * in a grid whose rows stretch to the same height, so nothing is left empty.
 */
export function TaheitoDashboard(props: Props) {
  const t = useT();
  const { lang, points, allPoints, win, rangeText, now, tiles, moreTiles, parts, money, fees, cash, onGo, isAdminView, children } = props;
  const [metric, setMetric] = useState<'profit' | 'volume'>('profit');

  const monthly = useMemo(() => calendarMonthComparison(points, now), [points, now]);
  const { cur } = useMemo(() => summarizeWithPrevious(points, win), [points, win]);
  const clients = useMemo(() => topClients(points, monthly.window, metric), [points, monthly.window, metric]);
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  const monthName = (ts: number) => new Date(ts).toLocaleDateString(locale, { month: 'long' });
  const months = useMemo(() => {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const own = allPoints.filter(p => p.own);
    return [
      { label: monthName(start), all: summarize(allPoints, start, now), own: summarize(own, start, now) },
      { label: monthName(prevStart), all: summarize(allPoints, prevStart, start - 1), own: summarize(own, prevStart, start - 1) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPoints, now, lang]);

  const net = monthly.cur.net;
  const netPct = pctChange(net, monthly.prev?.net);
  const margin = cur.vol > 0 ? (cur.net / cur.vol) * 100 : 0;
  const maxCash = Math.max(1, ...cash.accounts.map(a => Math.max(0, a.balance)));
  const maxOrders = Math.max(1, ...clients.map(c => c.orders));
  const go = (path: string) => (!isAdminView ? () => onGo(path) : undefined);

  const toTile = (tile: HomeTile, i: number): ThTile => ({
    key: tile.key, cls: CLASSES[i % CLASSES.length], icon: tile.Icon as LucideIcon, label: tile.label, value: tile.value, unit: tile.unit,
    tone: tile.valueTone === 'bad' ? 'bad' : tile.valueTone === 'good' ? 'good' : undefined,
    onClick: tile.path ? go(tile.path) : undefined,
  });
  const headline: ThTile[] = [
    { key: 'month-volume', cls: 't3', icon: Layers, label: t('dhTotalVolume'), value: parts(monthly.cur.vol).n, unit: parts(monthly.cur.vol).u },
    { key: 'month-net', cls: 't4', icon: Target, label: t('dhMyNetProfit'), value: parts(net).n, unit: parts(net).u, tone: net < 0 ? 'bad' : 'good' },
    ...tiles.map((x, i) => toTile(x, i)),
  ];
  const cashOpen = go('/trading/cash');

  return (
    <ThRoot lang={lang} className="th-dash">
      <MerchantHero
        lang={lang} icon={<LayoutDashboard className="co-ttl-ic" strokeWidth={1.7} />} title={t('dashboard')} subtitle={t('thDashSub')}
        trendDown={net < 0} trendTitle={`${parts(net).n} ${parts(net).u}`}
        trendText={netPct == null ? t('dhMyNetProfit') : `${netPct >= 0 ? '+' : ''}${netPct.toFixed(1)}% · ${t('dhMyNetProfit')}`}
      />
      <ThMain label={t('dashboard')}>
        <ThTiles tiles={headline} />
        <ThTiles tiles={moreTiles.map((x, i) => toTile(x, i + 2))} />
      </ThMain>

      <div className="th-dg">
        <div className="dh th-dh th-g-trend">
          <ProfitTrendCard
            points={allPoints} now={now} lang={lang} money={money}
            labels={{ title: t('dhProfitTrend'), profit: t('dhProfit'), volume: t('dhVolume'), monthly: t('dhMonthly'), weekly: t('dhWeekly'), daily: t('dhDaily') }}
          />
        </div>

        <Card icon={Wallet} title={t('dhCash')} className="th-g-cash" action={cashOpen && <button type="button" className="th-dc-link" onClick={cashOpen}>{t('dhOpenCash')}<ArrowRight aria-hidden="true" /></button>}>
          <div className="th-dc-big"><b>{cash.total}</b><small>{cash.unit}</small></div>
          <div className="th-dc-sub">{cash.counted} {t('kpiOf')} {cash.active} {cash.counted === 1 ? t('kpiAccountUnit') : t('kpiAccountsUnit')}</div>
          <ul className="th-dc-accts">
            {cash.accounts.map((a, i) => (
              <li key={a.name + i}>
                <span className="n"><i style={{ background: SEGMENTS[i % SEGMENTS.length] }} />{a.name}</span>
                <b className={a.balance < 0 ? 'th-bad' : undefined}>{a.shown}</b>
                <em><u style={{ width: `${Math.max(0, a.balance) / maxCash * 100}%`, background: SEGMENTS[i % SEGMENTS.length] }} /></em>
              </li>
            ))}
          </ul>
        </Card>

        <Card icon={Crown} title={`${t('top5Clients')} · ${monthName(monthly.window.from)}`} className="th-g-clients" action={
          <span className="th-dc-seg">
            <button type="button" className={metric === 'profit' ? 'on' : ''} onClick={() => setMetric('profit')}>{t('dhNetProfitTab')}</button>
            <button type="button" className={metric === 'volume' ? 'on' : ''} onClick={() => setMetric('volume')}>{t('dhVolume')}</button>
          </span>
        }>
          {clients.length === 0 ? <div className="th-dc-empty">{t('noDataAvailable')}</div> : (
            <ol className="th-dc-clients">
              {clients.map((c, i) => (
                <li key={c.name}>
                  <span className="medal" style={{ background: MEDALS[i] }}>{i + 1}</span>
                  <span className="who"><b title={c.name}>{c.name}</b><em><u style={{ width: `${c.orders / maxOrders * 100}%` }} /></em></span>
                  <span className="ord">{c.orders}</span>
                  <span className="val"><b className={metric === 'profit' && c.value < 0 ? 'th-bad' : 'th-good'}>{metric === 'profit' && c.value >= 0 ? '+' : ''}{money(c.value)}</b>
                    <small className={c.change == null ? '' : c.change >= 0 ? 'th-good' : 'th-bad'}>{c.change == null ? '—' : `${c.change >= 0 ? '+' : ''}${c.change.toFixed(1)}%`}</small></span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card icon={ListChecks} title={t('dhPeriodStats')} className="th-g-period" action={<small className="th-dc-range">{rangeText}</small>}>
          <Row k={t('dhVolume')} v={money(cur.vol)} />
          <Row k={t('dhCost')} v={money(cur.vol - cur.net - fees)} />
          {fees > 0 && <Row k={t('dhFees')} v={money(fees)} />}
          <Row k={t('dhNetProfitTab')} v={money(cur.net)} tone={cur.net >= 0 ? 'good' : 'bad'} />
          <Row k={t('dhAvgMargin')} v={`${margin.toFixed(2)}%`} />
          <Row k={t('dhTrades')} v={String(cur.orders)} />
        </Card>

        <Card icon={CalendarDays} title={t('dhThisVsLast')} className="th-g-months">
          <div className="th-dc-months">
            {months.map(m => (
              <div key={m.label}>
                <div className="th-dc-mt">{m.label}</div>
                <Row k={t('dhOwnLabel')} v={money(m.own.vol)} />
                <Row k={`${t('dhTotalLabel')} ${t('dhVolume')}`} v={money(m.all.vol)} />
                <Row k={t('dhMyNetProfit')} v={`${m.all.net >= 0 ? '+' : ''}${money(m.all.net)}`} tone={m.all.net >= 0 ? 'good' : 'bad'} />
              </div>
            ))}
          </div>
        </Card>

        <div className="dh th-dh th-g-kpis">{children}</div>
      </div>
      <div className="dh th-dh"><DashboardFilterSheet /><DashboardSearchSheet points={scopePoints(allPoints, 'all')} /></div>
    </ThRoot>
  );
}
