import { useState } from 'react';
import { Activity, Check, ExternalLink, Gauge, Loader2, MapPin, MapPinned, Phone, Route as RouteIcon, ScanLine, Thermometer, Timer, Truck, TriangleAlert, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAssignDriver, useCancelShipment, useDrivers, useShipment } from '../hooks';
import { ENTRY_MODE_LABELS, LOCATION_SOURCE_LABELS, formatCoords, formatStampTime, mapEmbedUrl, mapsLink, placeText } from '../geo';
import { agoLabel, durationLabel, latestReading, readingDue, sortStops, stopName, stopProgress, STATUS_LABELS, STATUS_TAG, type Lang } from '../route';
import { tripSummary } from '../trip-summary';
import type { ShipmentReading } from '../types';
import { PhotoThumb } from './PhotoThumb';
import { RangeStrip } from './ShipmentCard';
import { TrendChart } from './TrendChart';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Tile({ cls, icon: Icon, label, value, hint }: { cls: string; icon: typeof Timer; label: string; value: string; hint?: string }) {
  return (
    <div className={cn('co-t', cls)}>
      <div className="co-t-top"><span className="co-t-l">{label}</span><span className="co-t-ic"><Icon /></span></div>
      <div className="co-t-v" dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {hint && <div className="co-t-c">{hint}</div>}
    </div>
  );
}

/** The proof on one reading: the area, when the phone took it, where, and how the number was entered. */
function ReadingProof({ reading, lang }: { reading: ShipmentReading; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const area = placeText(reading, lang);
  const mode = ENTRY_MODE_LABELS[reading.entry_mode];
  return (
    <div className="cs-meta">
      {area && <div><MapPin aria-hidden="true" /><b>{area}</b></div>}
      {reading.device_taken_at && <div><Timer aria-hidden="true" /><span className="dir">{formatStampTime(new Date(reading.device_taken_at).getTime())}</span></div>}
      {reading.latitude != null && reading.longitude != null && (
        <div>
          <MapPinned aria-hidden="true" />
          <a className="cs-link dir" href={mapsLink(reading.latitude, reading.longitude)} target="_blank" rel="noreferrer">
            {formatCoords(reading.latitude, reading.longitude)}{reading.accuracy_m != null ? ` ±${Math.round(reading.accuracy_m)} m` : ''}<ExternalLink aria-hidden="true" />
          </a>
        </div>
      )}
      <div><ScanLine aria-hidden="true" />{lang === 'ar' ? mode.ar : mode.en}</div>
      {reading.time_mismatch && <div className="warn"><TriangleAlert aria-hidden="true" />{L('Phone clock differs from the server', 'ساعة الهاتف تختلف عن الخادم')}</div>}
    </div>
  );
}

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
                <div className="cs-kv">
                  <Tile cls="t3" icon={Timer} label={L('Time on the road', 'مدة الرحلة')} value={stats.elapsedMs === null ? '—' : durationLabel(stats.elapsedMs, lang)} />
                  <Tile cls="t2" icon={MapPinned} label={L('Stops reached', 'المحطات')} value={`${stats.stopsDone}/${stats.stopsTotal}`} />
                  <Tile cls="t4" icon={RouteIcon} label={L('Distance', 'المسافة')} value={stats.distanceKm > 0 ? `${stats.distanceKm} km` : '—'} hint={stats.distanceKm > 0 ? L('Approximate', 'تقريبية') : undefined} />
                  <Tile cls={stats.alertCount > 0 ? 'bad' : 't4'} icon={Gauge} label={L('Kept in range', 'ضمن النطاق')} value={stats.inRangePct === null ? '—' : `${stats.inRangePct}%`} hint={stats.alertCount > 0 ? L(`${stats.alertCount} out of range`, `${stats.alertCount} خارج النطاق`) : undefined} />
                  <Tile cls="t1" icon={Thermometer} label={L('Lowest … highest', 'الأدنى … الأعلى')} value={stats.minC === null || stats.maxC === null ? '—' : `${temp(stats.minC)}…${temp(stats.maxC)}`} hint={stats.avgC !== null ? `${L('Average', 'المتوسط')} ${temp(stats.avgC)}°C` : undefined} />
                  <Tile cls="t3" icon={ScanLine} label={L('Readings', 'القراءات')} value={String(stats.readingsCount)} />
                </div>
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
                <ul className="cs-route" style={{ margin: 0, padding: 0 }}>
                  {sortStops(shipment.stops).map((s) => {
                    const reached = !!s.reached_at;
                    const next = !reached && progress.next?.id === s.id && shipment.status === 'on_the_road';
                    return (
                      <li key={s.id} className={cn(reached && 'reached', next && 'next')}>
                        <span className="pt">{reached && <Check aria-hidden="true" />}</span>
                        <div>
                          <div className="nm">{stopName(s, lang)}{s.kind === 'driver' && <span className="tag">{L('added by driver', 'أضافها السائق')}</span>}</div>
                          <div className="tm">{reached && s.reached_at ? dateFmt(s.reached_at) : next ? L('Next stop', 'المحطة التالية') : L('Not reached yet', 'لم يصل بعد')}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
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
                  {shipment.readings.map((r) => (
                    <li key={r.id} style={{ alignItems: 'flex-start' }}>
                      <div className="cs-rd" style={{ width: '100%' }}>
                        <div className="cs-photo"><PhotoThumb path={r.photo_path} alt={L('Temperature screen photo', 'صورة شاشة الحرارة')} className="h-full w-full rounded-none" /></div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className={cn('cs-rd-t', r.is_alert && 'bad')}>{temp(r.temperature_c)}°C{r.is_alert && <span style={{ fontSize: 10, marginInlineStart: 6 }}>{L('Out of range', 'خارج النطاق')}</span>}</div>
                          <div className="cs-rd-s">{agoLabel(r.taken_at, now, lang)}</div>
                          <ReadingProof reading={r} lang={lang} />
                        </div>
                      </div>
                    </li>
                  ))}
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
