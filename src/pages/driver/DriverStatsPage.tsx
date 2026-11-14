import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, Gauge, MapPinned, PackageCheck, Thermometer, Timer, TriangleAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-context';
import { listDriverTrips } from '@/features/shipments/api';
import { driverMonthStats, durationHoursLabel, gradeOf, lastMonths, type Grade, type MonthStats } from '@/features/shipments/driver-stats';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme-context';

const MONTHS_SHOWN = 6;

const GRADE_TEXT: Record<Grade, { en: string; ar: string; className: string }> = {
  good: { en: 'Excellent', ar: 'ممتاز', className: 'text-emerald-700 dark:text-emerald-400' },
  fair: { en: 'Fair', ar: 'مقبول', className: 'text-amber-700 dark:text-amber-400' },
  poor: { en: 'Needs work', ar: 'يحتاج تحسين', className: 'text-destructive' },
};

function Tile({ icon: Icon, label, value, sub, grade, lang }: { icon: typeof Gauge; label: string; value: string; sub?: string; grade?: Grade | null; lang: 'en' | 'ar' }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="text-3xl font-extrabold leading-none tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      {grade && <div className={cn('text-sm font-bold', GRADE_TEXT[grade].className)}>{GRADE_TEXT[grade][lang]}</div>}
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MiniBars({ title, rows, lang, unit }: { title: string; rows: { month: string; value: number | null }[]; lang: 'en' | 'ar'; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.month} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-xs text-muted-foreground" dir="ltr">{new Date(`${r.month}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', year: '2-digit' })}</span>
            <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${r.value ? Math.max(3, (r.value / max) * 100) : 0}%` }} />
            </span>
            <span className="w-14 shrink-0 text-end font-bold tabular-nums" dir="ltr">{r.value === null ? '—' : `${r.value}${unit}`}</span>
          </li>
        ))}
      </ul>
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
  const idx = months.indexOf(month);
  const label = new Date(`${month}-15`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric' });

  if (isLoading) return <div className="grid grid-cols-2 gap-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  if (isError) return <p className="text-sm text-destructive" role="alert">{L('Could not load your numbers. Check your signal.', 'تعذر تحميل أرقامك. تحقق من الإشارة.')}</p>;

  const nothing = stats.tripsStarted === 0;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{L('My month', 'شهري')}</h1>
        <div className="flex items-center gap-1" role="group" aria-label={L('Choose month', 'اختر الشهر')}>
          <button type="button" disabled={idx <= 0} onClick={() => setMonth(months[idx - 1])} className="flex h-11 w-11 items-center justify-center rounded-full border border-border disabled:opacity-30" aria-label={L('Previous month', 'الشهر السابق')}>
            <ChevronLeft className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <span className="min-w-28 text-center text-sm font-bold">{label}</span>
          <button type="button" disabled={idx >= months.length - 1} onClick={() => setMonth(months[idx + 1])} className="flex h-11 w-11 items-center justify-center rounded-full border border-border disabled:opacity-30" aria-label={L('Next month', 'الشهر التالي')}>
            <ChevronRight className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>

      {nothing ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{L('No trips started this month yet.', 'لم تبدأ أي رحلة هذا الشهر بعد.')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Tile lang={lang} icon={PackageCheck} label={L('Trips delivered', 'رحلات مُسلَّمة')} value={`${stats.tripsDelivered}/${stats.tripsStarted}`} sub={L('delivered / started', 'مسلّمة / بدأت')} />
          <Tile lang={lang} icon={Gauge} label={L('Tons delivered', 'أطنان مُسلَّمة')} value={`${stats.tons}`} />
          <Tile lang={lang} icon={MapPinned} label={L('Distance driven', 'المسافة المقطوعة')} value={`≈${stats.distanceKm}`} sub={L('km, from your hourly locations', 'كم، من مواقعك كل ساعة')} />
          <Tile lang={lang} icon={Clock} label={L('Average trip', 'متوسط الرحلة')} value={stats.avgTripHours === null ? '—' : durationHoursLabel(stats.avgTripHours, lang)} sub={stats.avgTripHours === null ? L('no delivered trip yet', 'لا رحلة مسلّمة بعد') : undefined} />
          <Tile lang={lang} icon={Thermometer} label={L('Temperature in range', 'الحرارة ضمن النطاق')} value={stats.inRangePct === null ? '—' : `${stats.inRangePct}%`} grade={gradeOf(stats.inRangePct)} sub={`${stats.readings} ${L('readings', 'قراءة')} · ${stats.alerts} ${L('alerts', 'تنبيه')}`} />
          <Tile lang={lang} icon={Timer} label={L('Readings on time', 'قراءات في وقتها')} value={stats.onTimePct === null ? '—' : `${stats.onTimePct}%`} grade={gradeOf(stats.onTimePct)} sub={`${stats.missedReadings} ${L('missed', 'فائتة')}`} />
        </div>
      )}

      <MiniBars title={L('Trips delivered, last 6 months', 'الرحلات المسلّمة، آخر 6 أشهر')} rows={all.map((s) => ({ month: s.month, value: s.tripsDelivered }))} lang={lang} unit="" />
      <MiniBars title={L('Temperature in range, last 6 months', 'الحرارة ضمن النطاق، آخر 6 أشهر')} rows={all.map((s) => ({ month: s.month, value: s.inRangePct }))} lang={lang} unit="%" />

      <details className="rounded-2xl border border-border bg-card p-4 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-bold"><TriangleAlert className="h-4 w-4" aria-hidden="true" />{L('How these are measured', 'كيف تُحسب هذه الأرقام')}</summary>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-muted-foreground">
          <li>{L('A trip counts in the month it started.', 'تُحسب الرحلة في الشهر الذي بدأت فيه.')}</li>
          <li>{L('In range: readings inside the allowed temperature range, out of all readings sent.', 'ضمن النطاق: القراءات داخل النطاق المسموح من كل القراءات المرسلة.')}</li>
          <li>{L('On time: a reading sent within the photo interval plus 30 minutes of the one before. A long silence counts the readings that should have come as missed.', 'في وقتها: قراءة أُرسلت خلال فترة الصورة + 30 دقيقة من السابقة. والصمت الطويل يحسب القراءات التي كان يجب أن تصل كفائتة.')}</li>
          <li>{L('Distance is an estimate from the hourly locations, so it is slightly under the true road distance.', 'المسافة تقدير من المواقع كل ساعة، لذا تقل قليلًا عن مسافة الطريق الفعلية.')}</li>
        </ul>
      </details>
    </div>
  );
}
