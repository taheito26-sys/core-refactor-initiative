import { useState } from 'react';
import { Loader2, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssignDriver, useCancelShipment, useDrivers, useShipment } from '../hooks';
import { agoLabel, latestReading, readingDue, stopProgress, type Lang } from '../route';
import { DueBadge } from './DueBadge';
import { PhotoThumb } from './PhotoThumb';
import { RouteTimeline } from './RouteTimeline';
import { StatusChip } from './StatusChip';
import { StopSegments } from './StopSegments';
import { TemperatureChart } from './TemperatureChart';
import { TemperatureReadout } from './TemperatureReadout';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Everything about one shipment: the latest reefer photo, the temperature history, the route and the driver. */
export function ShipmentDetailSheet({ shipmentId, lang, now, onClose }: { shipmentId: string | null; lang: Lang; now: number; onClose: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipment, isLoading } = useShipment(shipmentId);
  const { data: drivers = [] } = useDrivers();
  const assign = useAssignDriver();
  const cancel = useCancelShipment();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const last = shipment ? latestReading(shipment.readings) : null;
  const progress = shipment ? stopProgress(shipment.stops) : null;
  const canChangeDriver = shipment?.status === 'preparing';
  const canCancel = shipment?.status === 'preparing' || shipment?.status === 'on_the_road';

  return (
    <Sheet open={!!shipmentId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={lang === 'ar' ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <SheetHeader className="text-start">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {shipment?.reference ?? L('Shipment', 'الشحنة')}
            {shipment && <StatusChip status={shipment.status} lang={lang} />}
          </SheetTitle>
          <SheetDescription>{shipment?.cargo ?? ''}</SheetDescription>
        </SheetHeader>

        {isLoading && <div className="mt-4 space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {!isLoading && !shipment && shipmentId && <p className="mt-4 text-sm text-muted-foreground">{L('This shipment is no longer available.', 'هذه الشحنة لم تعد متاحة.')}</p>}

        {shipment && progress && (
          <div className="mt-4 space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{L('Latest temperature', 'آخر درجة حرارة')}</h3>
              <div className="flex gap-3 rounded-xl border border-border p-3">
                {last ? <PhotoThumb path={last.photo_path} alt={L('Photo of the truck’s temperature screen', 'صورة شاشة حرارة الشاحنة')} className="h-24 w-24 shrink-0" /> : null}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <TemperatureReadout reading={last} targetC={shipment.target_temp_c} lang={lang} now={now} size="lg" />
                  {last?.note && <p className="text-xs text-muted-foreground">“{last.note}”</p>}
                  <DueBadge due={readingDue(shipment, last?.taken_at ?? null, now)} lang={lang} now={now} />
                </div>
              </div>
              <TemperatureChart readings={shipment.readings} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} lang={lang} />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{L('Route', 'المسار')}</h3>
              <StopSegments stops={progress.stops} reachedCount={progress.reachedCount} />
              <RouteTimeline stops={shipment.stops} lang={lang} />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{L('Driver', 'السائق')}</h3>
              {canChangeDriver ? (
                <select
                  className={selectClass}
                  value={shipment.driver_id ?? ''}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate({ shipmentId: shipment.id, driverId: e.target.value || null }, { onError: (err) => toast.error((err as Error).message) })}
                  aria-label={L('Assigned driver', 'السائق المعيّن')}
                >
                  <option value="">{L('No driver yet', 'بدون سائق بعد')}</option>
                  {drivers.filter((d) => d.active || d.id === shipment.driver_id).map((d) => (
                    <option key={d.id} value={d.id}>{d.display_name}{d.truck_plate ? ` · ${d.truck_plate}` : ''}</option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {shipment.driver?.display_name ?? '—'}
                  {shipment.driver?.truck_plate && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" dir="ltr"><Truck className="h-3.5 w-3.5" aria-hidden="true" />{shipment.driver.truck_plate}</span>}
                  {shipment.driver?.phone && <a className="text-xs text-primary" href={`tel:${shipment.driver.phone}`} dir="ltr">{shipment.driver.phone}</a>}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{L('Readings', 'القراءات')} ({shipment.readings.length})</h3>
              {shipment.readings.length === 0 && <p className="text-xs text-muted-foreground">{L('The driver has not sent a photo yet.', 'لم يرسل السائق صورة بعد.')}</p>}
              <ul className="space-y-2">
                {shipment.readings.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl border border-border p-2">
                    <PhotoThumb path={r.photo_path} alt={L('Temperature screen photo', 'صورة شاشة الحرارة')} className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <TemperatureReadout reading={r} targetC={shipment.target_temp_c} lang={lang} now={now} size="sm" />
                      <div className="text-[10px] text-muted-foreground">{new Date(r.taken_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')} · {agoLabel(r.taken_at, now, lang)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {canCancel && (
              <Button variant="outline" className="w-full text-destructive" onClick={() => setConfirmCancel(true)}>{L('Cancel this shipment', 'إلغاء هذه الشحنة')}</Button>
            )}
          </div>
        )}

        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <AlertDialogHeader>
              <AlertDialogTitle>{L('Cancel this shipment?', 'إلغاء هذه الشحنة؟')}</AlertDialogTitle>
              <AlertDialogDescription>{L('The driver will no longer be able to send readings for it.', 'لن يتمكن السائق من إرسال قراءات لها بعد الآن.')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancel.isPending}>{L('Back', 'رجوع')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={cancel.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (!shipment) return;
                  cancel.mutate(shipment.id, {
                    onSuccess: () => setConfirmCancel(false),
                    onError: (err) => toast.error((err as Error).message),
                  });
                }}
              >
                {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : L('Cancel shipment', 'إلغاء الشحنة')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
