import { Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stopName, stopProgress, truckPositionPct, type Lang } from '../route';
import type { ShipmentStatus, ShipmentStop } from '../types';

/**
 * The route drawn as a line: a dot per stop, filled up to where the truck is, with the truck on it.
 * Direction follows the page, so in Arabic the trip runs right to left, from Egypt to Qatar.
 */
export function RouteLine({ stops, status, lang, className }: { stops: ShipmentStop[]; status: ShipmentStatus; lang: Lang; className?: string }) {
  const progress = stopProgress(stops);
  const truck = status === 'on_the_road' ? truckPositionPct(progress) : null;
  const fillPct = status === 'delivered' ? 100 : truck ?? 0;
  const n = progress.stops.length;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="relative h-9"
        role="progressbar"
        aria-label={lang === 'ar' ? 'تقدم الرحلة' : 'Trip progress'}
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={progress.reachedCount}
        aria-valuetext={`${progress.reachedCount} / ${n}`}
      >
        <span className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" aria-hidden="true" />
        <span
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          style={{ insetInlineStart: '0.5rem', width: `calc((100% - 1rem) * ${fillPct / 100})` }}
          aria-hidden="true"
        />
        {progress.stops.map((s, i) => {
          const pct = n > 1 ? (i / (n - 1)) * 100 : 0;
          const reached = !!s.reached_at;
          const here = truck !== null && i === progress.reachedCount - 1;
          return (
            <span
              key={s.id}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2"
              style={{ insetInlineStart: `calc(0.5rem + (100% - 1rem) * ${pct / 100})` }}
              title={stopName(s, lang)}
            >
              {here ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20">
                  <Truck className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                </span>
              ) : (
                <span className={cn('block h-3 w-3 rounded-full border-2', reached ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-background', s.kind === 'driver' && 'rotate-45 rounded-[2px]')} />
              )}
            </span>
          );
        })}
      </div>
      <div className="flex items-start justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{lang === 'ar' ? 'من' : 'From'}</div>
          <div className="truncate font-semibold">{progress.origin ? stopName(progress.origin, lang) : '—'}</div>
        </div>
        <div className="min-w-0 text-end">
          <div className="text-xs text-muted-foreground">{lang === 'ar' ? 'إلى' : 'To'}</div>
          <div className="truncate font-semibold">{progress.destination ? stopName(progress.destination, lang) : '—'}</div>
        </div>
      </div>
    </div>
  );
}
