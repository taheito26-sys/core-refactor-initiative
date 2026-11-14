import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Gauge, MapPinned, PackageCheck, Thermometer, Timer, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { listDriverTrips } from '@/features/shipments/api';
import { driverMonthStats, durationHoursLabel, gradeOf, lastMonths, type Grade, type MonthStats } from '@/features/shipments/driver-stats';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';

const MONTHS_SHOWN = 6;

const GRADE_TEXT: Record<Grade, { en: string; ar: string }> = {
  good: { en: 'Excellent', ar: 'ممتاز' },
  fair: { en: 'Fair', ar: 'مقبول' },
  poor: { en: 'Needs work', ar: 'يحتاج تحسين' },
};

function Tile({ cls, icon: Icon, label, value, sub, grade, lang }: { cls: string; icon: typeof Gauge; label: string; value: string; sub?: string; grade?: Grade | null; lang: 'en' | 'ar' }) {
  return (
    <div className={cn('co-t', cls)}>
      <div className="co-t-top"><span className="co-t-l">{label}</span><span className="co-t-ic"><Icon /></span></div>
      <div className="co-t-v" dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {(grade || sub) && <div className="co-t-c">{grade && <span className={cn('cs-grade', grade)}>{GRADE_TEXT[grade][lang]}</span>}{grade && sub ? ' · ' : ''}{sub}</div>}
    </div>
  );
}

function Bars({ title, rows, lang, unit }: { title: string; rows: { month: string; value: number | null }[]; lang: 'en' | 'ar'; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <section className="ch-card cs-box">
      <h3>{title}</h3>
      <div className="cs-bars">
        {rows.map((r) => (
          <div key={r.month} className="cs-bar">
            <span className="m">{new Date(`${r.month}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', year: '2-digit' })}</span>
            <div className="co-track" aria-hidden="true"><i style={{ width: `${r.value ? Math.max(3, (r.value / max) * 100) : 0}%` }} /></div>
            <b>{r.value === null ? '—' : `${r.value}${unit}`}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The driver's own numbers for a month, and the last six, worked out from the trips they drove. */
export default function DriverStatsPage() {
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { userId } = useAuth();
  const now = useMemo(() => Date.now(), []);
  const months = useMemo(() => lastMonths(MONTHS_SHOWN, now), [now]);
  const [month, setMonth] = useState(months[months.length - 1]);

  const since = useMemo(() => new Date(`${months[0]}-01T00:00:00`).toISOString(), [months]);
  const { data: trips = [], isLoading, isError } = useQuery({ queryKey: ['driver-trips', userId, since], queryFn: () => listDriverTrips(since), enabled: !!userId });

  const all = useMemo(() => months.map((m) => driverMonthStats(trips, m, now)), [trips, months, now]);
  const stats: MonthStats = all[months.indexOf(month)] ?? all[all.length - 1];
  const monthLabel = (m: string) => new Date(`${m}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short' });
  const nothing = stats.tripsStarted === 0;

  return (
    <>
      <div className="co-mainwrap">
        <div className="ch-card co-main">
          <div className="co-mlabel">{L('Month', 'الشهر')}</div>
          <div className="co-months" role="group" aria-label={L('Choose month', 'اختر الشهر')}>
            {[...months].reverse().map((m) => (
              <button key={m} type="button" aria-pressed={month === m} className={cn('co-chip', month === m && 'on')} onClick={() => setMonth(m)}>{monthLabel(m)}</button>
            ))}
          </div>

          {isLoading && <div className="cs-skel" style={{ marginTop: 10, height: 120 }} />}
          {isError && <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: '#f0245b' }}>{L('Could not load your numbers. Check your signal.', 'تعذر تحميل أرقامك. تحقق من الإشارة.')}</p>}
          {!isLoading && !isError && (nothing
            ? <p style={{ margin: '12px 0 0', textAlign: 'center', fontSize: 12, color: '#6b7a9c' }}>{L('No trips started this month yet.', 'لم تبدأ أي رحلة هذا الشهر بعد.')}</p>
            : (
              <div className="cs-kv" style={{ marginTop: 10 }}>
                <Tile lang={lang} cls="t3" icon={PackageCheck} label={L('Trips delivered', 'رحلات مُسلَّمة')} value={`${stats.tripsDelivered}/${stats.tripsStarted}`} sub={L('delivered / started', 'مسلّمة / بدأت')} />
                <Tile lang={lang} cls="t2" icon={Gauge} label={L('Tons delivered', 'أطنان مُسلَّمة')} value={`${stats.tons}`} />
                <Tile lang={lang} cls="t4" icon={MapPinned} label={L('Distance driven', 'المسافة المقطوعة')} value={`≈${stats.distanceKm} km`} sub={L('from your hourly locations', 'من مواقعك كل ساعة')} />
                <Tile lang={lang} cls="t1" icon={Clock} label={L('Average trip', 'متوسط الرحلة')} value={stats.avgTripHours === null ? '—' : durationHoursLabel(stats.avgTripHours, lang)} sub={stats.avgTripHours === null ? L('no delivered trip yet', 'لا رحلة مسلّمة بعد') : undefined} />
                <Tile lang={lang} cls={gradeOf(stats.inRangePct) === 'poor' ? 'bad' : 't4'} icon={Thermometer} label={L('Temperature in range', 'الحرارة ضمن النطاق')} value={stats.inRangePct === null ? '—' : `${stats.inRangePct}%`} grade={gradeOf(stats.inRangePct)} sub={`${stats.readings} ${L('readings', 'قراءة')} · ${stats.alerts} ${L('alerts', 'تنبيه')}`} />
                <Tile lang={lang} cls={gradeOf(stats.onTimePct) === 'poor' ? 'bad' : 't3'} icon={Timer} label={L('Readings on time', 'قراءات في وقتها')} value={stats.onTimePct === null ? '—' : `${stats.onTimePct}%`} grade={gradeOf(stats.onTimePct)} sub={`${stats.missedReadings} ${L('missed', 'فائتة')}`} />
              </div>
            ))}
        </div>
      </div>

      <div className="dr-stack">
        <Bars title={L('Trips delivered, last 6 months', 'الرحلات المسلّمة، آخر 6 أشهر')} rows={all.map((s) => ({ month: s.month, value: s.tripsDelivered }))} lang={lang} unit="" />
        <Bars title={L('Temperature in range, last 6 months', 'الحرارة ضمن النطاق، آخر 6 أشهر')} rows={all.map((s) => ({ month: s.month, value: s.inRangePct }))} lang={lang} unit="%" />

        <details className="ch-card cs-box">
          <summary style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: 'var(--th-ink, #0f1f5e)' }}><TriangleAlert style={{ width: 15, height: 15, color: 'var(--th-a, #2f73f4)' }} aria-hidden="true" />{L('How these are measured', 'كيف تُحسب هذه الأرقام')}</summary>
          <ul style={{ margin: '10px 0 0', paddingInlineStart: 18, display: 'grid', gap: 6, fontSize: 11, color: '#6b7a9c', lineHeight: 1.6 }}>
            <li>{L('A trip counts in the month it started.', 'تُحسب الرحلة في الشهر الذي بدأت فيه.')}</li>
            <li>{L('In range: readings inside the allowed temperature range, out of all readings sent.', 'ضمن النطاق: القراءات داخل النطاق المسموح من كل القراءات المرسلة.')}</li>
            <li>{L('On time: a reading sent within the photo interval plus 30 minutes of the one before. A long silence counts the readings that should have come as missed.', 'في وقتها: قراءة أُرسلت خلال فترة الصورة + 30 دقيقة من السابقة. والصمت الطويل يحسب القراءات التي كان يجب أن تصل كفائتة.')}</li>
            <li>{L('Distance is an estimate from the hourly locations, so it is slightly under the true road distance.', 'المسافة تقدير من المواقع كل ساعة، لذا تقل قليلًا عن مسافة الطريق الفعلية.')}</li>
          </ul>
        </details>
      </div>
    </>
  );
}
