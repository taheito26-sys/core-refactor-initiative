import { Gauge, MapPinned, Route as RouteIcon, ScanLine, Thermometer, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { durationLabel, type Lang } from '../route';
import type { TripSummary } from '../trip-summary';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Tile({ cls, icon: Icon, label, value, hint }: { cls: string; icon: typeof Timer; label: string; value: string; hint?: string }) {
  return (
    <div className={cn('co-t', cls)}>
      <div className="co-t-top"><span className="co-t-l">{label}</span><span className="co-t-ic"><Icon /></span></div>
      <div className="co-t-v" dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {hint && <div className="co-t-c">{hint}</div>}
    </div>
  );
}

/** The measures of one trip as six tiles: time on the road, stops, distance, share in range, temperature range, readings. */
export function TripTiles({ summary: s, lang }: { summary: TripSummary; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <div className="cs-kv">
      <Tile cls="t3" icon={Timer} label={L('Time on the road', 'مدة الرحلة')} value={s.elapsedMs === null ? '—' : durationLabel(s.elapsedMs, lang)} />
      <Tile cls="t2" icon={MapPinned} label={L('Stops reached', 'المحطات')} value={`${s.stopsDone}/${s.stopsTotal}`} />
      <Tile cls="t4" icon={RouteIcon} label={L('Distance', 'المسافة')} value={s.distanceKm > 0 ? `${s.distanceKm} km` : '—'} hint={s.distanceKm > 0 ? L('Approximate', 'تقريبية') : undefined} />
      <Tile cls={s.alertCount > 0 ? 'bad' : 't4'} icon={Gauge} label={L('Kept in range', 'ضمن النطاق')} value={s.inRangePct === null ? '—' : `${s.inRangePct}%`} hint={s.alertCount > 0 ? L(`${s.alertCount} out of range`, `${s.alertCount} خارج النطاق`) : undefined} />
      <Tile cls="t1" icon={Thermometer} label={L('Lowest … highest', 'الأدنى … الأعلى')} value={s.minC === null || s.maxC === null ? '—' : `${temp(s.minC)}…${temp(s.maxC)}`} hint={s.avgC !== null ? `${L('Average', 'المتوسط')} ${temp(s.avgC)}°C` : undefined} />
      <Tile cls="t3" icon={ScanLine} label={L('Readings', 'القراءات')} value={String(s.readingsCount)} />
    </div>
  );
}

