import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Gauge, MapPin, MapPinned, Package, Phone, Power, Route as RouteIcon, ScanLine, Search, Timer, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { driverSummaries, teamTotals, type DriverSummary, type RosterPeriod } from '../driver-roster';
import { durationHoursLabel, gradeOf, lastMonths, type Grade } from '../driver-stats';
import { useDrivers, useSetDriverActive, useTripData } from '../hooks';
import { agoLabel, STATUS_LABELS, STATUS_TAG, type Lang } from '../route';
import type { TripData } from '../api';

const GRADE_WORDS: Record<Grade, { en: string; ar: string }> = {
  good: { en: 'Excellent', ar: 'ممتاز' },
  fair: { en: 'Fair', ar: 'مقبول' },
  poor: { en: 'Needs work', ar: 'يحتاج تحسين' },
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const pctText = (p: number | null) => (p === null ? '—' : `${p}%`);

function Stat({ cls, icon: Icon, label, value, hint, grade, lang }: { cls: string; icon: typeof Timer; label: string; value: string; hint?: string; grade?: Grade | null; lang: Lang }) {
  return (
    <div className={cn('co-t', cls)}>
      <div className="co-t-top"><span className="co-t-l">{label}</span><span className="co-t-ic"><Icon /></span></div>
      <div className="co-t-v" dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {(grade || hint) && <div className="co-t-c">{grade && <span className={cn('cs-grade', grade)}>{GRADE_WORDS[grade][lang]}</span>}{grade && hint ? ' · ' : ''}{hint}</div>}
    </div>
  );
}

const tripInRange = (t: TripData) => (t.readings.length ? Math.round(((t.readings.length - t.readings.filter((r) => r.is_alert).length) / t.readings.length) * 100) : null);

function DriverCard({ s, lang, now, expanded, onToggle, onSwitch, switching }: {
  s: DriverSummary; lang: Lang; now: number; expanded: boolean; onToggle: () => void; onSwitch: () => void; switching: boolean;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { driver, stats } = s;
  const tag = s.status === 'on_the_road' ? 'blue' : s.status === 'available' ? 'ok' : 'grey';
  const tagText = s.status === 'on_the_road' ? L('On the road', 'في الطريق') : s.status === 'available' ? L('Available', 'متاح') : L('Switched off', 'متوقف');
  const kind = s.status === 'on_the_road' ? 'road' : s.status === 'available' ? 'free' : 'void';
  const month = (m: string) => new Date(`${m}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', year: '2-digit' });

  return (
    <article className={cn('co-card cs-card static', kind)} aria-label={driver.display_name}>
      <div className="cs-who">
        <span className="cs-av" aria-hidden="true">{initials(driver.display_name)}</span>
        <div>
          <b>{driver.display_name}</b>
          <span>{driver.username}{driver.truck_plate ? ` · ${driver.truck_plate}` : ''}</span>
        </div>
        <span className={cn('co-tag', tag)} style={{ marginInlineStart: 0 }}>{tagText}</span>
      </div>

      {s.current && (
        <div className="cs-where">
          <MapPin aria-hidden="true" />
          <div><b>{s.current.reference}</b> · {s.currentPlace ?? L('no position yet', 'لا موقع بعد')}</div>
          {s.lastSeenAt && <span>{agoLabel(s.lastSeenAt, now, lang)}</span>}
        </div>
      )}

      <div className="cs-stats">
        <Stat lang={lang} cls="t3" icon={Package} label={L('Trips', 'الرحلات')} value={`${stats.tripsDelivered}/${stats.tripsStarted}`} hint={L('delivered / started', 'مسلّمة / بدأت')} />
        <Stat lang={lang} cls="t4" icon={RouteIcon} label={L('Distance', 'المسافة')} value={stats.distanceKm > 0 ? `${stats.distanceKm} km` : '—'} hint={stats.tons > 0 ? `${stats.tons} t` : undefined} />
        <Stat lang={lang} cls="t2" icon={Timer} label={L('Average trip', 'متوسط الرحلة')} value={stats.avgTripHours === null ? '—' : durationHoursLabel(stats.avgTripHours, lang)} />
        <Stat lang={lang} cls={gradeOf(stats.inRangePct) === 'poor' ? 'bad' : 't4'} icon={Gauge} label={L('Kept in range', 'ضمن النطاق')} value={pctText(stats.inRangePct)} grade={gradeOf(stats.inRangePct)} />
        <Stat lang={lang} cls={gradeOf(stats.onTimePct) === 'poor' ? 'bad' : 't1'} icon={Timer} label={L('Readings on time', 'قراءات في وقتها')} value={pctText(stats.onTimePct)} grade={gradeOf(stats.onTimePct)} hint={stats.missedReadings > 0 ? L(`${stats.missedReadings} missed`, `${stats.missedReadings} فائتة`) : undefined} />
        <Stat lang={lang} cls={stats.alerts > 0 ? 'bad' : 't3'} icon={TriangleAlert} label={L('Alerts', 'التنبيهات')} value={String(stats.alerts)} hint={L(`of ${stats.readings} readings`, `من ${stats.readings} قراءة`)} />
      </div>

      <div className="cs-acts">
        <div className="grow">
          {driver.phone && <a href={`tel:${driver.phone}`}><Phone style={{ width: 11, height: 11, verticalAlign: '-1px' }} aria-hidden="true" /> {driver.phone}</a>}
        </div>
        <button type="button" className={cn('co-btn', driver.active ? 'bad' : 'ok')} disabled={switching} onClick={onSwitch}>
          <Power aria-hidden="true" />{driver.active ? L('Switch off', 'إيقاف') : L('Switch on', 'تشغيل')}
        </button>
        <button type="button" className="co-btn link" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? L('Hide details', 'إخفاء التفاصيل') : L('Details', 'التفاصيل')}
          <ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>

      {expanded && (
        <div className="cs-more">
          <div>
            <h4>{L('Last six months', 'آخر ستة أشهر')}</h4>
            <table className="cs-tbl">
              <thead><tr><th>{L('Month', 'الشهر')}</th><th className="num">{L('Trips', 'رحلات')}</th><th className="num">km</th><th className="num">{L('In range', 'ضمن النطاق')}</th><th className="num">{L('On time', 'في وقتها')}</th></tr></thead>
              <tbody>
                {[...s.months].reverse().map((m) => (
                  <tr key={m.month}><td dir="ltr" style={{ textAlign: 'start' }}>{month(m.month)}</td><td className="num">{m.tripsStarted}</td><td className="num">{m.distanceKm || '—'}</td><td className="num">{pctText(m.inRangePct)}</td><td className="num">{pctText(m.onTimePct)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4>{L('Trips in this period', 'رحلات هذه الفترة')} ({s.trips.length})</h4>
            {s.trips.length === 0 ? <p style={{ margin: 0, fontSize: 11, color: '#6b7a9c' }}>{L('No trips in this period.', 'لا رحلات في هذه الفترة.')}</p> : (
              <ul className="cs-trips">
                {s.trips.slice(0, 10).map((t) => {
                  const r = tripInRange(t);
                  return (
                    <li key={t.id}>
                      <b>{t.reference}</b>
                      <span className={cn('co-tag', STATUS_TAG[t.status])} style={{ marginInlineStart: 0 }}>{STATUS_LABELS[t.status][lang]}</span>
                      <span className="sp">{new Date(t.started_at ?? t.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}{r !== null ? ` · ${r}%` : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * The customer's Drivers tab: the team in numbers, then every driver with their state, where they are now
 * and their statistics for the chosen period, with a six month history and trip list on demand.
 */
export function DriversPanel({ lang, now, tabs, onAdd }: { lang: Lang; now: number; tabs: ReactNode; onAdd: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: drivers = [], isLoading: loadingDrivers } = useDrivers();
  const { data: trips = [], isLoading: loadingTrips } = useTripData();
  const setActive = useSetDriverActive();
  const [which, setWhich] = useState<'this' | 'last' | 'all'>('this');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const months = useMemo(() => lastMonths(2, now), [now]);
  const period = useMemo<RosterPeriod>(() => (which === 'all' ? { kind: 'all' } : { kind: 'month', month: which === 'this' ? months[1] : months[0] }), [which, months]);
  const summaries = useMemo(() => driverSummaries(drivers, trips, period, now, lang), [drivers, trips, period, now, lang]);
  const team = useMemo(() => teamTotals(drivers, summaries, trips, period, now), [drivers, summaries, trips, period, now]);
  const q = query.trim().toLowerCase();
  const visible = summaries.filter((s) => !q || s.driver.display_name.toLowerCase().includes(q) || (s.driver.truck_plate ?? '').toLowerCase().includes(q) || s.driver.username.toLowerCase().includes(q));
  const loading = loadingDrivers || loadingTrips;
  const label = (m: string) => new Date(`${m}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long' });
  const periods: { key: typeof which; text: string }[] = [
    { key: 'this', text: label(months[1]) },
    { key: 'last', text: label(months[0]) },
    { key: 'all', text: L('All time', 'كل الفترات') },
  ];

  return (
    <>
      <div className="co-mainwrap">
        <div className="ch-card co-main">
          <div className="co-mtop">
            <div className="co-mlabel">{L('Your drivers', 'سائقوك')}</div>
            <button type="button" className="co-new" onClick={onAdd}><UserPlus strokeWidth={2.2} />{L('Add driver', 'إضافة سائق')}</button>
          </div>
          {tabs}
          {drivers.length > 0 && (
            <>
              <div className="co-months">
                {periods.map((p) => (
                  <button key={p.key} type="button" aria-pressed={which === p.key} className={cn('co-chip', which === p.key && 'on')} onClick={() => setWhich(p.key)}>{p.text}</button>
                ))}
              </div>
              <div className="co-tools">
                <label className="cs-search">
                  <Search aria-hidden="true" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('Search name, plate or username', 'ابحث بالاسم أو اللوحة أو اسم المستخدم')} aria-label={L('Search drivers', 'بحث في السائقين')} />
                </label>
              </div>
              <div className="co-tiles">
                <div className="co-t t3"><div className="co-t-top"><span className="co-t-l">{L('Drivers', 'السائقون')}</span><span className="co-t-ic"><Users /></span></div><div className="co-t-v">{team.drivers}</div><div className="co-t-c">{L(`${team.onTheRoad} on the road`, `${team.onTheRoad} في الطريق`)}</div></div>
                <div className="co-t t2"><div className="co-t-top"><span className="co-t-l">{L('Trips', 'الرحلات')}</span><span className="co-t-ic"><Package /></span></div><div className="co-t-v">{team.stats.tripsStarted}</div><div className="co-t-c">{L(`${team.stats.tripsDelivered} delivered`, `${team.stats.tripsDelivered} مسلّمة`)}</div></div>
                <div className="co-t t4"><div className="co-t-top"><span className="co-t-l">{L('Distance', 'المسافة')}</span><span className="co-t-ic"><MapPinned /></span></div><div className="co-t-v" dir="ltr" style={{ textAlign: 'start' }}>{team.stats.distanceKm > 0 ? `${team.stats.distanceKm} km` : '—'}</div></div>
                <div className={cn('co-t', gradeOf(team.stats.inRangePct) === 'poor' ? 'bad' : 't1')}><div className="co-t-top"><span className="co-t-l">{L('Kept in range', 'ضمن النطاق')}</span><span className="co-t-ic"><ScanLine /></span></div><div className="co-t-v">{pctText(team.stats.inRangePct)}</div><div className="co-t-c">{L(`${team.stats.alerts} alerts`, `${team.stats.alerts} تنبيه`)}</div></div>
              </div>
            </>
          )}
        </div>
      </div>

      {loading && <div className="cs-list" aria-busy="true"><div className="cs-skel" /><div className="cs-skel" /></div>}

      {!loading && drivers.length === 0 && (
        <section className="ch-card cs-empty">
          <span className="ic"><Users aria-hidden="true" /></span>
          <h2>{L('No drivers yet', 'لا يوجد سائقون بعد')}</h2>
          <p>{L('Add a driver to give them a login. They photograph the cooling screen on the road, and their trips and temperature record appear here.', 'أضف سائقًا ليحصل على حساب دخول. يصوّر شاشة التبريد في الطريق وتظهر هنا رحلاته وسجل الحرارة.')}</p>
          <div className="row"><button type="button" className="co-new" onClick={onAdd}><UserPlus strokeWidth={2.2} />{L('Add driver', 'إضافة سائق')}</button></div>
        </section>
      )}

      {!loading && drivers.length > 0 && (
        <>
          <div className="cs-head"><span>{L('All drivers', 'كل السائقين')} <small>({visible.length})</small></span></div>
          {visible.length === 0
            ? <p className="co-banner" style={{ marginTop: 12, fontSize: 12, color: '#6b7a9c', textAlign: 'center' }}>{L('No drivers match.', 'لا يوجد سائقون مطابقون.')}</p>
            : (
              <div className="cs-list">
                {visible.map((s) => (
                  <DriverCard
                    key={s.driver.id}
                    s={s}
                    lang={lang}
                    now={now}
                    expanded={open === s.driver.id}
                    onToggle={() => setOpen(open === s.driver.id ? null : s.driver.id)}
                    switching={setActive.isPending}
                    onSwitch={() => setActive.mutate({ driverId: s.driver.id, active: !s.driver.active }, { onError: (e) => toast.error((e as Error).message) })}
                  />
                ))}
              </div>
            )}
        </>
      )}
    </>
  );
}
