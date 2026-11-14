import { AlertTriangle, ArrowUpRight, MapPin, Scale, Tag, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  agoLabel, attentionState, latestReading, liveness, readingDue, stopName, stopProgress, type Lang,
} from '../route';
import type { ShipmentWithDetails } from '../types';
import { LiveStamp } from './LiveStamp';
import { PhotoThumb } from './PhotoThumb';
import { RouteLine } from './RouteLine';
import { StatusChip } from './StatusChip';
import { TemperatureRange } from './TemperatureRange';

const temp = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}°C`;

/**
 * One shipment, top to bottom: who and what, where the truck is on the route, and the evidence — the
 * latest reefer photo next to its temperature against the allowed range.
 */
export function ShipmentCard({ shipment, lang, now, onOpen }: { shipment: ShipmentWithDetails; lang: Lang; now: number; onOpen: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const progress = stopProgress(shipment.stops);
  const last = latestReading(shipment.readings);
  const due = readingDue(shipment, last?.taken_at ?? null, now);
  const attention = attentionState(shipment, last, now);
  const onRoad = shipment.status === 'on_the_road';
  const where = onRoad && progress.current
    ? progress.next ? `${stopName(progress.current, lang)}  →  ${stopName(progress.next, lang)}` : stopName(progress.current, lang)
    : null;

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm',
        attention ? 'border-destructive/50' : 'border-border',
        shipment.status === 'cancelled' && 'opacity-60',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-extrabold leading-tight">{shipment.reference}</div>
          <div className="mt-0.5 flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
            <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">{shipment.cargo}</span>
          </div>
        </div>
        <StatusChip status={shipment.status} lang={lang} />
      </header>

      <RouteLine stops={shipment.stops} status={shipment.status} lang={lang} />
      {where && <div className="-mt-2 truncate text-sm font-medium" dir="auto">{where}</div>}
      {shipment.locations[0] && (
        <div className="-mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {L('Last seen', 'آخر ظهور')} {agoLabel(shipment.locations[0].recorded_at, now, lang)}
        </div>
      )}

      <section
        className={cn('rounded-xl p-3.5', attention === 'alert' ? 'bg-destructive/10' : 'bg-muted/50')}
        aria-label={L('Latest temperature', 'آخر درجة حرارة')}
      >
        {last ? (
          <div className="flex gap-3.5">
            <PhotoThumb path={last.photo_path} alt={L('Photo of the truck’s temperature screen', 'صورة شاشة حرارة الشاحنة')} className="h-[72px] w-[72px] shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className={cn('text-3xl font-extrabold leading-none tabular-nums', last.is_alert && 'text-destructive')} dir="ltr">{temp(last.temperature_c)}</span>
                {last.is_alert ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{L('Out of range', 'خارج النطاق')}</span>
                ) : (
                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{L('In range', 'ضمن النطاق')}</span>
                )}
              </div>
              <TemperatureRange temperature={last.temperature_c} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} alert={last.is_alert} lang={lang} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {L('No temperature reading yet.', 'لا توجد قراءة حرارة بعد.')}{' '}
            <span dir="ltr" className="font-semibold text-foreground">{temp(shipment.target_temp_c)} ±{shipment.tolerance_c}</span>
          </div>
        )}
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <LiveStamp liveness={liveness(due)} due={due} lastAt={last?.taken_at ?? null} lang={lang} now={now} />
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {shipment.driver && <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" aria-hidden="true" />{shipment.driver.display_name}</span>}
          {shipment.weight_tons != null && <span className="inline-flex items-center gap-1.5"><Scale className="h-4 w-4" aria-hidden="true" /><span dir="ltr">{shipment.weight_tons} t</span></span>}
          {!shipment.driver && <span>{L('No driver assigned', 'لم يُعيَّن سائق')}</span>}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {L('Follow the shipment', 'تابع الشحنة')}
          <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
