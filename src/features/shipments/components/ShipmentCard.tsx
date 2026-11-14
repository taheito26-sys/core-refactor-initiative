import { ArrowUpRight, Scale, Tag, Truck, User } from 'lucide-react';
import { agoLabel, latestReading, readingDue, stopName, stopProgress, type Lang } from '../route';
import type { ShipmentWithDetails } from '../types';
import { DueBadge } from './DueBadge';
import { StatusChip } from './StatusChip';
import { StopSegments } from './StopSegments';
import { TemperatureReadout } from './TemperatureReadout';

/** One shipment in the list: reference, status, route progress, from → to, cargo and the latest temperature. */
export function ShipmentCard({ shipment, lang, now, onOpen }: { shipment: ShipmentWithDetails; lang: Lang; now: number; onOpen: () => void }) {
  const progress = stopProgress(shipment.stops);
  const last = latestReading(shipment.readings);
  const due = readingDue(shipment, last?.taken_at ?? null, now);
  const stamp = last?.taken_at ?? shipment.started_at ?? shipment.created_at;
  const where = progress.next && progress.current
    ? `${stopName(progress.current, lang)} → ${stopName(progress.next, lang)}`
    : progress.current
      ? stopName(progress.current, lang)
      : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-start text-card-foreground shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{shipment.reference}</div>
            <div className="text-[11px] text-muted-foreground">{agoLabel(stamp, now, lang)}</div>
          </div>
        </div>
        <StatusChip status={shipment.status} lang={lang} />
      </div>

      <StopSegments stops={progress.stops} reachedCount={progress.reachedCount} />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{lang === 'ar' ? 'من' : 'From'}</div>
          <div className="truncate font-semibold">{progress.origin ? stopName(progress.origin, lang) : '—'}</div>
        </div>
        <div className="min-w-0 text-end">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{lang === 'ar' ? 'إلى' : 'To'}</div>
          <div className="truncate font-semibold">{progress.destination ? stopName(progress.destination, lang) : '—'}</div>
        </div>
      </div>

      {where && shipment.status === 'on_the_road' && <div className="truncate text-[11px] text-muted-foreground">{where}</div>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1"><Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{shipment.cargo}</span></span>
        {shipment.weight_tons != null && (
          <span className="inline-flex items-center gap-1"><Scale className="h-3.5 w-3.5" aria-hidden="true" /><span dir="ltr">{shipment.weight_tons} t</span></span>
        )}
        {shipment.driver && (
          <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" aria-hidden="true" />{shipment.driver.display_name}</span>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border pt-2.5">
        <TemperatureReadout reading={last} targetC={shipment.target_temp_c} lang={lang} now={now} size="md" />
        <DueBadge due={due} lang={lang} now={now} />
      </div>

      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
        {lang === 'ar' ? 'تابع الشحنة' : 'Follow the shipment'}
        <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
      </span>
    </button>
  );
}
