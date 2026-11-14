import { Gauge, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { latestReading, readingDue, stopName, stopProgress, type Lang } from '../route';
import type { ShipmentWithDetails } from '../types';
import { DueBadge } from './DueBadge';
import { StopSegments } from './StopSegments';
import { TemperatureReadout } from './TemperatureReadout';

/** The trucks on the road right now, each with where it is and its latest temperature. */
export function FleetPulse({ shipments, lang, now, onOpen }: { shipments: ShipmentWithDetails[]; lang: Lang; now: number; onOpen: (id: string) => void }) {
  const active = shipments.filter((s) => s.status === 'on_the_road');
  return (
    <section className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm" aria-label={lang === 'ar' ? 'حالة الأسطول' : 'Fleet pulse'}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            {lang === 'ar' ? 'نبض الأسطول' : 'Fleet pulse'}
          </div>
          <h2 className="text-lg font-bold">{lang === 'ar' ? 'حالة الأسطول' : 'Fleet status'}</h2>
        </div>
        <div className="text-sm font-extrabold text-primary">
          {active.length} {lang === 'ar' ? 'في الطريق' : 'on the road'}
        </div>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {lang === 'ar' ? 'لا توجد شاحنات في الطريق حالياً.' : 'No trucks are on the road right now.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {active.map((s) => {
            const progress = stopProgress(s.stops);
            const last = latestReading(s.readings);
            const alert = !!last?.is_alert;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpen(s.id)}
                className={cn(
                  'flex flex-col gap-2 rounded-xl border p-3 text-start transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  alert ? 'border-destructive/60 bg-destructive/5' : 'border-border bg-background',
                )}
              >
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate text-sm font-bold">{s.reference}</span>
                  {s.driver?.truck_plate && <span className="ms-auto shrink-0 text-[10px] text-muted-foreground" dir="ltr">{s.driver.truck_plate}</span>}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {s.driver?.display_name ?? (lang === 'ar' ? 'بدون سائق' : 'No driver')}
                  {progress.next ? ` · → ${stopName(progress.next, lang)}` : ''}
                </div>
                <StopSegments stops={progress.stops} reachedCount={progress.reachedCount} />
                <TemperatureReadout reading={last} targetC={s.target_temp_c} lang={lang} now={now} size="sm" />
                <DueBadge due={readingDue(s, last?.taken_at ?? null, now)} lang={lang} now={now} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
