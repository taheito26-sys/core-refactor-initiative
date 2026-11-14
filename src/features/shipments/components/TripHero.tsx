import { AlertTriangle, MapPin, Package, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { placeText } from '../geo';
import { agoLabel, latestReading, stopName, stopProgress, type Lang } from '../route';
import type { ShipmentWithDetails } from '../types';
import { RouteLine } from './RouteLine';
import { StatusChip } from './StatusChip';

const temp = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}°C`;

/**
 * The top of a shipment page: what it is, the temperature now against the allowed range, which area the truck
 * is in and since when, and where it is heading next. The same on the customer's and the driver's side.
 */
export function TripHero({ shipment, lang, now }: { shipment: ShipmentWithDetails; lang: Lang; now: number }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const last = latestReading(shipment.readings);
  const where = shipment.locations[0] ?? null;
  const area = placeText(where, lang);
  const progress = stopProgress(shipment.stops);
  const alert = !!last?.is_alert;

  return (
    <section className={cn('space-y-4 rounded-3xl border p-5', alert ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-gradient-to-b from-primary/10 to-card')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-extrabold tracking-tight">{shipment.reference}</h2>
        <StatusChip status={shipment.status} lang={lang} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4" aria-hidden="true" />{shipment.cargo}</span>
        {shipment.weight_tons != null && <span className="inline-flex items-center gap-1.5"><Scale className="h-4 w-4" aria-hidden="true" /><span dir="ltr">{shipment.weight_tons} t</span></span>}
        <span>{L('Keep at', 'الحرارة المطلوبة')} <b className="text-foreground" dir="ltr">{temp(shipment.target_temp_c)}</b> <span dir="ltr">(±{shipment.tolerance_c})</span></span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{L('Temperature now', 'الحرارة الآن')}</div>
          <div className={cn('text-5xl font-extrabold leading-none tabular-nums', alert && 'text-destructive')} dir="ltr" style={{ textAlign: 'start' }}>{last ? temp(last.temperature_c) : '—'}</div>
        </div>
        {last && (
          <div className="pb-1 text-end text-sm">
            {alert
              ? <div className="inline-flex items-center gap-1.5 font-bold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{L('Out of range', 'خارج النطاق')}</div>
              : <div className="font-semibold text-emerald-700 dark:text-emerald-400">{L('In range', 'ضمن النطاق')}</div>}
            <div className="text-xs text-muted-foreground">{agoLabel(last.taken_at, now, lang)}</div>
          </div>
        )}
      </div>

      {(area || where) && (
        <div className="flex items-start gap-2 rounded-2xl bg-background/70 p-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground">{L('Truck is in', 'الشاحنة الآن في')}</div>
            <div className="text-base font-bold leading-snug">{area ?? L('Position received', 'تم استلام الموقع')}</div>
            {where && <div className="text-xs text-muted-foreground">{L('Last seen', 'آخر ظهور')} {agoLabel(where.recorded_at, now, lang)}</div>}
          </div>
        </div>
      )}

      <RouteLine stops={shipment.stops} status={shipment.status} lang={lang} />
      {shipment.status === 'on_the_road' && progress.next && (
        <div className="text-sm text-muted-foreground">{L('Next stop', 'المحطة التالية')}: <b className="text-foreground">{stopName(progress.next, lang)}</b></div>
      )}
    </section>
  );
}
