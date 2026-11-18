import { ReadingFreshness } from './ReadingFreshness';
import { useState } from 'react';
import { Activity, Ban, ExternalLink, Loader2, MapPin, MapPinned, Phone, ScanLine, Thermometer, Timer, Trash2, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useApproveShipmentRestart, useAssignDriver, useCancelShipment, useDrivers, useShipment } from '../hooks';
import { LOCATION_SOURCE_LABELS, mapEmbedUrl, mapsLink } from '../geo';
import { AreaText, useAreaText } from './AreaText';
import { agoLabel, durationLabel, latestReading, readingDue, stopProgress, STATUS_LABELS, STATUS_TAG, type Lang } from '../route';
import { tripSummary } from '../trip-summary';
import { shipmentEndMs } from '../timing';
import { PhotoThumb } from './PhotoThumb';
import { ReadingProof, ReadingRow } from './ReadingRow';
import { RouteSummary } from './RouteSummary';
import { JourneyPulse } from './JourneyPulse';
import { TripHistory } from './TripHistory';
import { TripTiles } from './TripTiles';
import { RangeStrip, TempVerdict } from './ShipmentCard';
import { TrendChart } from './TrendChart';
import { ColdChainPanel } from './ColdChainPanel';
import type { ShipmentWithDetails } from '../types';
import '@/styles/journey-pulse.css';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Everything about one shipment, in the portal's own language: the temperature now, the trip in numbers, where the truck is, the route, the driver and every reading. */
export function ShipmentDetailSheet({ shipmentId, lang, now, onClose, onRequestDelete }: { shipmentId: string | null; lang: Lang; now: number; onClose: () => void; onRequestDelete?: (shipment: ShipmentWithDetails) => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipment, isLoading } = useShipment(shipmentId);
  const { data: drivers = [] } = useDrivers();
  const assign = useAssignDriver();
  const cancel = useCancelShipment();
  const restart = useApproveShipmentRestart();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const last = shipment ? latestReading(shipment.readings) : null;
  const due = shipment ? readingDue(shipment, last?.taken_at ?? null, now) : null;
  const where = shipment?.locations[0] ?? null;
  const area = useAreaText(where, lang);
  const stats = shipment ? tripSummary(shipment, now, lang) : null;
  const monitoringEnd = shipment ? shipmentEndMs(shipment) : null;
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
            <div className={cn('cs-dbody', shipment.status === 'cancelled' && 'cancelled')}>
              {shipment.status === 'cancelled' && (
                <section className="ch-card cs-box cs-cancelled-box">
                  <div className="cs-cancel-hero">
                    <span className="cs-cancel-ic"><Ban aria-hidden="true" /></span>
                    <div>
                      <h3>{L('Cancelled trip', 'رحلة ملغاة')}</h3>
                      <p>{L('This trip was cancelled. Its readings and route are kept for the record; no new updates will arrive.', 'أُلغيت هذه الرحلة. تُحفظ قراءاتها ومسارها للسجل، ولن تصل تحديثات جديدة.')}</p>
                    </div>
                  </div>
                  {onRequestDelete && (
                    <button type="button" className="co-btn bad cs-danger" onClick={() => onRequestDelete(shipment)}>
                      <Trash2 aria-hidden="true" />{L('Delete shipment', 'حذف الشحنة')}
                    </button>
                  )}
                </section>
              )}
              {shipment.status !== 'cancelled' && <JourneyPulse shipment={shipment} lang={lang} now={now} audience="customer" />}

              <section className="ch-card cs-box">
                <h3><Thermometer aria-hidden="true" />{L('Last recorded temperature', 'آخر حرارة مسجلة')}{last && <small>{agoLabel(last.taken_at, now, lang)}</small>}</h3>
                <ReadingFreshness takenAt={last?.taken_at ?? null} intervalHours={shipment.reading_interval_hours} active={shipment.status === 'on_the_road'} now={now} lang={lang} />
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
                    <TempVerdict temperature={last.temperature_c} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} lang={lang} />
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

              {shipment.status !== 'cancelled' && (
                <ColdChainPanel readings={shipment.readings} targetC={shipment.target_temp_c} toleranceC={shipment.tolerance_c} now={now} endAt={monitoringEnd} lang={lang} />
              )}

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
                        <a className="cs-link" href={mapsLink(where.latitude, where.longitude)} target="_blank" rel="noreferrer">{L('Open in maps', 'فتح في الخرائط')}<ExternalLink aria-hidden="true" /></a>
                      </div>
                    </div>
                    {shipment.locations.length > 1 && (
                      <>
                        <div style={{ height: 8 }} />
                        <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
                          {shipment.locations.slice(1, 8).map((p) => (
                            <li key={p.recorded_at}><b><AreaText point={p} lang={lang} fallback="—" /></b><small>{agoLabel(p.recorded_at, now, lang)}</small></li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 11.5, color: '#6b7a9c' }}>{L('The driver has not shared a location yet.', 'لم يشارك السائق موقعه بعد.')}</p>
                )}
              </section>

              <RouteSummary stops={shipment.stops} status={shipment.status} lang={lang} />
              <TripHistory shipment={shipment} now={now} lang={lang} />

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
                <h3><ScanLine aria-hidden="true" />{L('Earlier readings', 'القراءات السابقة')}<small>{Math.max(0, shipment.readings.length - 1)}</small></h3>
                {shipment.readings.length < 2 && <p style={{ margin: 0, fontSize: 11.5, color: '#6b7a9c' }}>{L('No earlier readings.', 'لا توجد قراءات سابقة.')}</p>}
                <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
                  {shipment.readings.slice(1).map((r) => <ReadingRow key={r.id} reading={r} lang={lang} now={now} />)}
                </ul>
              </section>

              {shipment.status === 'ended_early' && (
                <section className="ch-card cs-box dr-actions">
                  <h3>{L('Trip ended early', 'انتهت الرحلة مبكرًا')}</h3>
                  <p>{L('The driver cannot resume until you approve. Approval lets the driver accept and start again.', 'لا يمكن للسائق الاستئناف حتى توافق. تتيح الموافقة للسائق قبول الرحلة وبدءها مجددًا.')}</p>
                  <button type="button" className="cs-cta" disabled={restart.isPending} onClick={() => setConfirmRestart(true)}>{L('Approve restart', 'الموافقة على البدء مجددًا')}</button>
                </section>
              )}
              {canCancel && (
                <button type="button" className="co-btn bad cs-danger" onClick={() => setConfirmCancel(true)}>{L('Cancel this shipment', 'إلغاء هذه الشحنة')}</button>
              )}
            </div>
          )}
        </div>

        <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
          <AlertDialogContent className="ch-root co-root cs-confirm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <AlertDialogHeader>
              <AlertDialogTitle>{L('Approve another start?', 'الموافقة على البدء مجددًا؟')}</AlertDialogTitle>
              <AlertDialogDescription>{L('The shipment will wait for the assigned driver to accept and start again.', 'ستنتظر الشحنة قبول السائق المعيّن وبدء الرحلة مجددًا.')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={restart.isPending}>{L('Back', 'رجوع')}</AlertDialogCancel>
              <AlertDialogAction disabled={restart.isPending} onClick={(e) => {
                e.preventDefault();
                if (shipment) restart.mutate(shipment.id, { onSuccess: () => setConfirmRestart(false), onError: (err) => toast.error((err as Error).message) });
              }}>{L('Approve restart', 'الموافقة على البدء مجددًا')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent className="ch-root co-root cs-confirm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
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
