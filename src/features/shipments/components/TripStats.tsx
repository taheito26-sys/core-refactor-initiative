import { Activity, ArrowDown, ArrowUp, Gauge, MapPinned, Route as RouteIcon, ScanLine, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { durationLabel, type Lang } from '../route';
import type { TripSummary } from '../trip-summary';

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Tile({ icon: Icon, label, value, hint, tone }: { icon: typeof Timer; label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</div>
      <div className={cn('mt-1.5 text-2xl font-extrabold leading-none tabular-nums', tone === 'bad' && 'text-destructive', tone === 'good' && 'text-emerald-600 dark:text-emerald-400')} dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** The measures of one trip as a grid of tiles: time on the road, stops, distance, temperature record. */
export function TripStats({ summary, lang }: { summary: TripSummary; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const s = summary;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile icon={Timer} label={L('Time on the road', 'مدة الرحلة')} value={s.elapsedMs === null ? '—' : durationLabel(s.elapsedMs, lang)} />
      <Tile icon={MapPinned} label={L('Stops reached', 'المحطات')} value={`${s.stopsDone} / ${s.stopsTotal}`} />
      <Tile icon={RouteIcon} label={L('Distance driven', 'المسافة المقطوعة')} value={s.distanceKm > 0 ? `${s.distanceKm} km` : '—'} hint={s.distanceKm > 0 ? L('Approximate', 'تقريبية') : L('Needs location points', 'تحتاج نقاط موقع')} />
      <Tile
        icon={Gauge}
        label={L('Kept in range', 'ضمن النطاق')}
        value={s.inRangePct === null ? '—' : `${s.inRangePct}%`}
        tone={s.inRangePct === null ? undefined : s.alertCount === 0 ? 'good' : 'bad'}
        hint={s.alertCount > 0 ? L(`${s.alertCount} out of range`, `${s.alertCount} خارج النطاق`) : undefined}
      />
      <Tile icon={ArrowDown} label={L('Lowest', 'الأدنى')} value={s.minC === null ? '—' : `${num(s.minC)}°C`} />
      <Tile icon={ArrowUp} label={L('Highest', 'الأعلى')} value={s.maxC === null ? '—' : `${num(s.maxC)}°C`} />
      <Tile icon={Activity} label={L('Average', 'المتوسط')} value={s.avgC === null ? '—' : `${num(s.avgC)}°C`} />
      <Tile icon={ScanLine} label={L('Readings', 'القراءات')} value={String(s.readingsCount)} />
    </div>
  );
}
