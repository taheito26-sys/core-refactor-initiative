import { useState } from 'react';
import { AlertTriangle, Loader2, Phone, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAssignDriver, useCancelShipment, useDrivers, useShipment } from '../hooks';
import { agoLabel, latestReading, liveness, readingDue, type Lang } from '../route';
import { LiveStamp } from './LiveStamp';
import { PhotoThumb } from './PhotoThumb';
import { RouteLine } from './RouteLine';
import { RouteTimeline } from './RouteTimeline';
import { StatusChip } from './StatusChip';
import { TemperatureChart } from './TemperatureChart';
import { TemperatureRange } from './TemperatureRange';

const temp = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}°C`;
const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Everything about one shipment: the latest reefer photo against its allowed range, the history, the route and the driver. */
export function ShipmentDetailSheet({ shipmentId, lang, now, onClose }: { shipmentId: string | null; lang: Lang; now: number; onClose: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipment, isLoading } = useShipment(shipmentId);
  const { data: drivers = [] } = useDrivers();
  const assign = useAssignDriver();
  const cancel = useCancelShipment();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const last = shipment ? latestReading(shipment.readings) : null;
  const due = shipment ? readingDue(shipment, last?.taken_at ?? null, now) : null;
  const canChangeDriver = shipment?.status === 'preparing';
  const canCancel = shipment?.status === 'preparing' || shipment?.status === 'on_the_road';

  return (
    <Sheet open={!!shipmentId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={lang === 'ar' ? 'left' : 'right'} className="w-full overflow-y-auto p-0 sm:max-w-2xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <SheetHeader className="space-y-1 border-b border-border p-6 text-start">
          <div className="flex flex-wrap items-center gap-3 pe-8">
            <SheetTitle className="text-2xl font-extrabold">{shipment?.reference ?? L('Shipment', 'الشحنة')}</SheetTitle>
            {shipment && <StatusChip status={shipment.status} lang={lang} />}
          </div>
          <SheetDescription className="text-sm">{shipment?.cargo ?? ''}</SheetDescription>
        </SheetHeader>

        {isLoading && <div className="space-y-4 p-6"><Skeleton className="h-48 w-full rounded-2xl" /><Skeleton className="h-32 w-full rounded-2xl" /></div>}
        {!isLoading && !shipment && shipmentId && <p className="p-6 text-sm text-muted-foreground">{L('This shipment is no longer available.', 'هذه الشحنة لم تعد متاحة.')}</p>}

        {shipment && due && (
          <div className="space-y-8 p-6">
            <Section title={L('Latest temperature', 'آخر درجة حرارة')}>
              <div className={cn('space-y-4 rounded-2xl p-4', last?.is_alert ? 'bg-destructive/10' : 'bg-muted/50')}>
                {last ? (
                  <>
                    <div className="flex gap-4">
                      <PhotoThumb path={last.photo_path} alt={L('Photo of the truck’s temperature screen', 'صورة شاشة حرارة الشاحنة')} className="h-28 w-28 shrink-0 sm:h-32 sm:w-32" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className={cn('text-5xl font-extrabold leading-none tabular-nums', last.is_alert && 'text-destructive')} dir="ltr">{temp(last.temperature_c)}</div>
                        {last.is_alert ? (
                          <div className="inline-flex items-center gap-1.5 text-sm font-bold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{L('Out of range', 'خارج النطاق')}</div>
                        ) : (
                          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{L('In range', 'ضمن النطاق')}</div>
                        )}
                        {last.set_point_c != null && last.set_point_c !== shipment.target_temp_c && (
                          <div className="text-xs text-muted-foreground">{L('Unit set point', 'ضبط الجهاز')} <span dir="ltr">{temp(last.set_point_c)}</span></div>
                        )}
                        {last.note && <p className="text-sm text-muted-foreground">“{last.note}”</p>}
                      </div>
                    </div>
                    <TemperatureRange temperature={last.temperature_c} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} alert={last.is_alert} lang={lang} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{L('The driver has not sent a photo yet.', 'لم يرسل السائق صورة بعد.')}</p>
                )}
                <div className="border-t border-border/60 pt-3">
                  <LiveStamp liveness={liveness(due)} due={due} lastAt={last?.taken_at ?? null} lang={lang} now={now} />
                </div>
              </div>
              <TemperatureChart readings={shipment.readings} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} lang={lang} />
            </Section>

            <Section title={L('Route', 'المسار')}>
              <RouteLine stops={shipment.stops} status={shipment.status} lang={lang} />
              <div className="pt-2"><RouteTimeline stops={shipment.stops} lang={lang} /></div>
            </Section>

            <Section title={L('Driver', 'السائق')}>
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
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-muted/50 p-4 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{shipment.driver?.display_name ?? '—'}</span>
                  {shipment.driver?.truck_plate && <span className="inline-flex items-center gap-2 text-muted-foreground" dir="ltr"><Truck className="h-4 w-4" aria-hidden="true" />{shipment.driver.truck_plate}</span>}
                  {shipment.driver?.phone && <a className="inline-flex items-center gap-2 font-semibold text-primary" href={`tel:${shipment.driver.phone}`} dir="ltr"><Phone className="h-4 w-4" aria-hidden="true" />{shipment.driver.phone}</a>}
                </div>
              )}
            </Section>

            <Section title={`${L('Readings', 'القراءات')} (${shipment.readings.length})`}>
              {shipment.readings.length === 0 && <p className="text-sm text-muted-foreground">{L('Nothing yet.', 'لا شيء بعد.')}</p>}
              <ul className="space-y-2">
                {shipment.readings.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                    <PhotoThumb path={r.photo_path} alt={L('Temperature screen photo', 'صورة شاشة الحرارة')} className="h-14 w-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('text-xl font-extrabold tabular-nums', r.is_alert && 'text-destructive')} dir="ltr">{temp(r.temperature_c)}</span>
                        {r.is_alert && <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{L('Out of range', 'خارج النطاق')}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(r.taken_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')} · {agoLabel(r.taken_at, now, lang)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            {canCancel && (
              <Button variant="outline" className="h-11 w-full text-destructive" onClick={() => setConfirmCancel(true)}>{L('Cancel this shipment', 'إلغاء هذه الشحنة')}</Button>
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
                  cancel.mutate(shipment.id, { onSuccess: () => setConfirmCancel(false), onError: (err) => toast.error((err as Error).message) });
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
