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
  const timeHint = [s.timingEstimated ? L('Includes estimated earlier history', 'يشمل تقديرًا للسجل السابق') : '', s.waitingApprovalMs > 0 ? L(`Awaiting approval: ${durationLabel(s.waitingApprovalMs, lang)}`, `انتظار الموافقة: ${durationLabel(s.waitingApprovalMs, lang)}`) : ''].filter(Boolean).join(' · ');
  return (
    <><div className="cs-kv">
      <Tile cls="t3" icon={Timer} label={L('Active trip time', 'وقت الرحلة الفعلي')} value={s.elapsedMs === null ? '—' : durationLabel(s.elapsedMs, lang)} hint={timeHint || undefined} />
      <Tile cls="t2" icon={MapPinned} label={L('Stops reached', 'المحطات')} value={`${s.stopsDone}/${s.stopsTotal}`} />
      <Tile cls="t4" icon={RouteIcon} label={L('Recorded GPS distance', 'المسافة المسجلة بالموقع')} value={s.distanceKm > 0 ? `${s.distanceKm} km` : '—'} hint={L(`${s.gpsSamples} GPS points · ${s.distanceIncomplete ? 'incomplete coverage' : 'sampled trail'}`, `${s.gpsSamples} نقاط · ${s.distanceIncomplete ? 'تغطية غير مكتملة' : 'مسار تقريبي'}`)} />
      <Tile cls={s.alertCount > 0 ? 'bad' : 't4'} icon={Gauge} label={L('Readings in range', 'القراءات ضمن النطاق')} value={s.inRangePct === null ? '—' : `${s.inRangePct}%`} hint={L(`${s.readingsCount-s.alertCount} of ${s.readingsCount} readings were inside the allowed range${s.alertCount ? ` · ${s.alertCount} outside` : ''}`, `${s.readingsCount-s.alertCount} من ${s.readingsCount} قراءة ضمن النطاق المسموح${s.alertCount ? ` · ${s.alertCount} خارجه` : ''}`)} />
      <Tile cls="t1" icon={Thermometer} label={L('Coldest … warmest (°C)', 'الأبرد … الأدفأ (°م)')} value={s.minC === null || s.maxC === null ? '—' : `${temp(s.minC)}…${temp(s.maxC)}`} hint={s.avgC !== null ? `${L('Average', 'المتوسط')} ${temp(s.avgC)}°C` : undefined} />
      <Tile cls="t3" icon={ScanLine} label={L('Readings', 'القراءات')} value={String(s.readingsCount)} />
    </div><p className="cs-sampling-note">{L('Based on submitted readings and sampled GPS points—not continuous temperature monitoring or an odometer.', 'الإحصاءات من القراءات المرسلة ونقاط الموقع المتاحة، وليست مراقبة مستمرة للحرارة أو عداد مسافة.')}</p></>
  );
}

