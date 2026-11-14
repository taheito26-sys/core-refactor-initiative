import { AlertTriangle, CheckCircle2, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agoLabel, type Lang } from '../route';
import type { ShipmentReading } from '../types';

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}°C`;

/**
 * The newest temperature with its state. An out-of-range reading says so in words and with an icon,
 * so it does not depend on colour.
 */
export function TemperatureReadout({
  reading,
  targetC,
  lang,
  now,
  size = 'md',
}: {
  reading: ShipmentReading | null;
  targetC: number;
  lang: Lang;
  now: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!reading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Thermometer className="h-3.5 w-3.5" aria-hidden="true" />
        {lang === 'ar' ? 'لا توجد قراءة بعد' : 'No reading yet'}
      </div>
    );
  }
  const alert = reading.is_alert;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span
        className={cn(
          'font-extrabold tabular-nums',
          size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-xl' : 'text-sm',
          alert ? 'text-destructive' : 'text-foreground',
        )}
        dir="ltr"
      >
        {fmt(reading.temperature_c)}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
          alert ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        )}
      >
        {alert ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
        {alert ? (lang === 'ar' ? 'خارج النطاق' : 'Out of range') : lang === 'ar' ? 'ضمن النطاق' : 'In range'}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {lang === 'ar' ? 'المطلوب' : 'Target'} <span dir="ltr">{fmt(targetC)}</span>
        {reading.set_point_c != null && reading.set_point_c !== targetC && (
          <> · {lang === 'ar' ? 'ضبط الجهاز' : 'Unit set'} <span dir="ltr">{fmt(reading.set_point_c)}</span></>
        )}
        {' · '}
        {agoLabel(reading.taken_at, now, lang)}
      </span>
    </div>
  );
}
