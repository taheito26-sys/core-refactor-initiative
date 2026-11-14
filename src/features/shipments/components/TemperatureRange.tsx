import { cn } from '@/lib/utils';
import { rangeScale, type Lang } from '../route';

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}°`;

/**
 * Where the reading sits against the allowed range. The band is named in text and the reading's marker
 * changes shape when it is outside (a triangle, not just a red dot), so it reads without colour.
 * Numbers run left to right in both languages.
 */
export function TemperatureRange({
  temperature, targetC, toleranceC, alert, lang, className,
}: { temperature: number | null; targetC: number; toleranceC: number; alert: boolean; lang: Lang; className?: string }) {
  const scale = rangeScale(targetC, toleranceC, temperature);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="space-y-1" dir="ltr">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-emerald-500/35 ring-1 ring-inset ring-emerald-500/60"
          style={{ left: `${scale.bandStartPct}%`, width: `${scale.bandEndPct - scale.bandStartPct}%` }}
        />
        {scale.markerPct !== null && (
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${Math.min(100, Math.max(0, scale.markerPct))}%` }} role="img" aria-label={alert ? 'Out of range' : 'In range'}>
            {alert ? (
              <svg width="16" height="16" viewBox="0 0 16 16" className="fill-destructive drop-shadow"><path d="M8 1.5 15 14H1z" /></svg>
            ) : (
              <span className="block h-4 w-4 rounded-full border-2 border-background bg-foreground shadow" />
            )}
          </div>
        )}
      </div>
      <div className="relative h-4 text-xs tabular-nums text-muted-foreground">
        <span className="absolute -translate-x-1/2" style={{ left: `${scale.bandStartPct}%` }}>{fmt(scale.bandLow)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${scale.bandEndPct}%` }}>{fmt(scale.bandHigh)}</span>
      </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {lang === 'ar' ? 'المطلوب' : 'Target'}{' '}
        <span className="font-semibold text-foreground" dir="ltr">{fmt(targetC)}C ±{toleranceC}</span>
        {' · '}
        {lang === 'ar' ? 'النطاق المسموح' : 'allowed'}
      </div>
    </div>
  );
}
