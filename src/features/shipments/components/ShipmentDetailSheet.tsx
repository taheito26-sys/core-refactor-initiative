import { useState } from 'react';
import { Activity, ExternalLink, Loader2, MapPin, MapPinned, Phone, Route as RouteIcon, ScanLine, Thermometer, Timer, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAssignDriver, useCancelShipment, useDrivers, useShipment } from '../hooks';
import { LOCATION_SOURCE_LABELS, formatCoords, mapEmbedUrl, mapsLink, placeText } from '../geo';
import { agoLabel, durationLabel, latestReading, readingDue, stopProgress, STATUS_LABELS, STATUS_TAG, type Lang } from '../route';
import { tripSummary } from '../trip-summary';
import { PhotoThumb } from './PhotoThumb';
import { ReadingProof, ReadingRow } from './ReadingRow';
import { RouteList } from './RouteList';
import { TripTiles } from './TripTiles';
import { RangeStrip } from './ShipmentCard';
import { TrendChart } from './TrendChart';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Everything about one shipment, in the portal's own language: the temperature now, the trip in numbers, where the truck is, the route, the driver and every reading. */
export function ShipmentDetailSheet({ shipmentId, lang, now, onClose }: { shipmentId: string | null; lang: Lang; now: number; onClose: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipment, isLoading } = useShipment(shipmentId);
  const { data: drivers = [] } = useDrivers();
  const assign = useAssignDriver();
  const cancel = useCancelShipment();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const last = shipment ? latestReading(shipment.readings) : null;
  const due = shipment ? readingDue(shipment, last?.taken_at ?? null, now) : null;
  const where = shipment?.locations[0] ?? null;
  const area = placeText(where, lang);
  const stats = shipment ? tripSummary(shipment, now, lang) : null;
  const progress = shipment ? stopProgress(shipment.stops) : null;
  const canChangeDriver = shipment?.status === 'preparing';
  const canCancel = shipment?.status === 'preparing' || shipment?.status === 'on_the_road';
  const alert = !!last?.is_alert;
  const dateFmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Sheet open={!!shipmentId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={lang === 'ar' ? 'left' : 'right'} className="w-full overflow-y-auto border-0 p-0 sm:max-w-xl [&>button]:z-10 [&>button]:text-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <SheetHeader className="sr-only">
          <SheetTitle>{shipment?.reference ?? L('Shipment', 'الشحنة')}</SheetTitle>
          <SheetDescription>{shipment?.cargo ?? ''}</SheetDescription>
        </SheetHeader>

        <div className="ch-root co-root cs-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <div className="cs-dh">
            <div className="cs-dh-top">
              <h2>{shipment?.reference ?? L('Shipment', 'الشحنة')}</h2>
              {shipment && <span className={cn('co-tag', STATUS_TAG[shipment.status])} style={{ marginInlineStart: 0 }}>{STATUS_LABELS[shipment.status][lang]}</span>}
            </div>
            {shipment && (
              <p>
                {shipment.cargo}{shipment.weight_tons != null ? ` · ${shipment.weight_tons} t` : ''}
                {' · '}{L('Keep at', 'الحرارة المطلوبة')} <span dir="ltr">{temp(shipment.target_temp_c)}°C (±{shipment.tolerance_c})</span>
              </p>
            )}
          </div>

          {isLoading && <div className="cs-dbody"><div className="cs-skel" /><div className="cs-skel" /></div>}
          {!isLoading && !shipment && shipmentId && <p style={{ padding: 16, fontSize: 12, color: '#6b7a9c' }}>{L('This shipment is no longer available.', 'هذه الشحنة لم تعد متاحة.')}</p>}

          {shipment && stats && progress && due && (
            <div className="cs-dbody">
              <section className="ch-card cs-box">
                <h3><Thermometer aria-hidden="true" />{L('Temperature now', 'الحرارة الآن')}{last && <small>{agoLabel(last.taken_at, now, lang)}</small>}</h3>
                {last ? (
                  <>
                    <div className="cs-now">
                      <div className="cs-photo"><PhotoThumb path={last.photo_path} alt={L('Photo of the truck’s temperature screen', 'صورة شاشة حرارة الشاحنة')} className="h-full w-full rounded-none" /></div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={cn('cs-big', alert && 'bad')}>{temp(last.temperature_c)}°C</div>
                        <div className={cn('cs-state', alert ? 'bad' : 'ok')} style={{ fontSize: 11 }}>{alert ? L('Out of range', 'خارج النطاق') : L('In range', 'ضمن النطاق')}</div>
                        {last.set_point_c != null && last.set_point_c !== shipment.target_temp_c && (
                          <div className="cs-state mute">{L('Unit set point', 'ضبط الجهاز')} <span dir="ltr">{temp(last.set_point_c)}°C</span></div>
                        )}
                        {last.note && <div className="cs-state mute">“{last.note}”</div>}
                      </div>
                    </div>
                    <RangeStrip temperature={last.temperature_c} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} alert={alert} />
                    <ReadingProof reading={last} lang={lang} />
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 11.5, color: '#6b7a9c' }}>{L('The driver has not sent a photo yet.', 'لم يرسل السائق صورة بعد.')}</p>
                )}
                {shipment.status === 'on_the_road' && due.dueAt != null && (
                  <div className={cn('cs-meta')} style={{ marginTop: 10 }}>
                    <div className={due.state === 'overdue' ? 'warn' : undefined}>
                      <Timer aria-hidden="true" />
                      {due.state === 'overdue'
                        ? L(`Reading overdue by ${durationLabel(due.overdueMs, lang)}`, `القراءة متأخرة ${durationLabel(due.overdueMs, lang)}`)
                        : L(`Next reading in ${durationLabel(due.dueAt - now, lang)}`, `القراءة القادمة بعد ${durationLabel(due.dueAt - now, lang)}`)}
                    </div>
                  </div>
                )}
              </section>

              <section className="ch-card cs-box">
                <h3><Activity aria-hidden="true" />{L('The trip in numbers', 'الرحلة بالأرقام')}</h3>
                <TripTiles summary={stats} lang={lang} />
                <div style={{ height: 12 }} />
                <TrendChart readings={shipment.readings} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} lang={lang} />
              </section>

              <section className="ch-card cs-box">
                <h3><MapPin aria-hidden="true" />{L('Where is the truck', 'أين الشاحنة')}</h3>
                {where ? (
                  <>
                    {area && <div className="cs-place">{area}</div>}
                    <iframe title={L('Map of the truck’s last known position', 'خريطة آخر موقع معروف للشاحنة')} src={mapEmbedUrl(where.latitude, where.longitude)} className="cs-map" loading="lazy" referrerPolicy="no-referrer" />
                    <div className="cs-meta">
                      <div>
                        <Timer aria-hidden="true" />
                        <span><b>{L('Last seen', 'آخر ظهور')} {agoLabel(where.recorded_at, now, lang)}</b> · {lang === 'ar' ? LOCATION_SOURCE_LABELS[where.source].ar : LOCATION_SOURCE_LABELS[where.source].en}{where.accuracy_m != null ? ` · ±${Math.round(where.accuracy_m)} m` : ''}</span>
                      </div>
                      <div>
                        <MapPinned aria-hidden="true" />
                        <a className="cs-link dir" href={mapsLink(where.latitude, where.longitude)} target="_blank" rel="noreferrer">{formatCoords(where.latitude, where.longitude)}<ExternalLink aria-hidden="true" /></a>
                      </div>
                    </div>
                    {shipment.locations.length > 1 && (
                      <>
                        <div style={{ height: 8 }} />
                        <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
                          {shipment.locations.slice(1, 8).map((p) => (
                            <li key={p.recorded_at}><b>{placeText(p, lang) ?? <span dir="ltr">{formatCoords(p.latitude, p.longitude)}</span>}</b><small>{agoLabel(p.recorded_at, now, lang)}</small></li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 11.5, color: '#6b7a9c' }}>{L('The driver has not shared a location yet.', 'لم يشارك السائق موقعه بعد.')}</p>
                )}
              </section>

              <section className="ch-card cs-box">
                <h3><RouteIcon aria-hidden="true" />{L('Route', 'المسار')}<small>{progress.reachedCount}/{progress.total}</small></h3>
                <RouteList stops={shipment.stops} status={shipment.status} lang={lang} />
              </section>

              <section className="ch-card cs-box">
                <h3><User aria-hidden="true" />{L('Driver', 'السائق')}</h3>
                {canChangeDriver ? (
                  <select
                    className="cs-select"
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
                  <div className="cs-drv">
                    <span><User aria-hidden="true" />{shipment.driver?.display_name ?? '—'}</span>
                    {shipment.driver?.truck_plate && <span dir="ltr"><Truck aria-hidden="true" />{shipment.driver.truck_plate}</span>}
                    {shipment.driver?.phone && <a href={`tel:${shipment.driver.phone}`} dir="ltr"><Phone aria-hidden="true" />{shipment.driver.phone}</a>}
                  </div>
                )}
              </section>

              <section className="ch-card cs-box">
                <h3><ScanLine aria-hidden="true" />{L('Readings', 'القراءات')}<small>{shipment.readings.length}</small></h3>
                {shipment.readings.length === 0 && <p style={{ margin: 0, fontSize: 11.5, color: '#6b7a9c' }}>{L('Nothing yet.', 'لا شيء بعد.')}</p>}
                <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
                  {shipment.readings.map((r) => <ReadingRow key={r.id} reading={r} lang={lang} now={now} />)}
                </ul>
              </section>

              {canCancel && (
                <button type="button" className="co-btn bad cs-danger" onClick={() => setConfirmCancel(true)}>{L('Cancel this shipment', 'إلغاء هذه الشحنة')}</button>
              )}
            </div>
          )}
        </div>

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
