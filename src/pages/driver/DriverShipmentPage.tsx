import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Flag, Loader2, MapPin, MapPinPlus, Package, Play, ScanLine, Scale, Timer } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReadingFreshness } from '@/features/shipments/components/ReadingFreshness';
import { DriverReadingForm } from '@/features/shipments/components/DriverReadingForm';
import { ReadingProof, ReadingRow } from '@/features/shipments/components/ReadingRow';
import { RouteSummary } from '@/features/shipments/components/RouteSummary';
import { JourneyPulse } from '@/features/shipments/components/JourneyPulse';
import { TripHistory } from '@/features/shipments/components/TripHistory';
import { ArrivalDialog } from '@/features/shipments/components/ArrivalDialog';
import { PhotoThumb } from '@/features/shipments/components/PhotoThumb';
import { RangeStrip, TempLimits, TempVerdict } from '@/features/shipments/components/ShipmentCard';
import { TripTiles } from '@/features/shipments/components/TripTiles';
import { placeText } from '@/features/shipments/geo';
import { useAddStop, useShipment, useStopShipment, useStartShipment } from '@/features/shipments/hooks';
import { agoLabel, durationLabel, latestReading, readingDue, stopName, stopProgress, STATUS_LABELS, STATUS_TAG } from '@/features/shipments/route';
import { tripSummary } from '@/features/shipments/trip-summary';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import type { DriverOutletContext } from './DriverLayout';
import '@/styles/journey-pulse.css';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One trip from the driver's side: the state of the load, start it, send temperature photos, confirm stops, add stops. */
export default function DriverShipmentPage() {
  const { id = null } = useParams();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { access, driverName } = useOutletContext<DriverOutletContext>();
  const { data: shipment, isLoading } = useShipment(id);
  const start = useStartShipment();
  const stop = useStopShipment();
  const addStop = useAddStop();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const [confirm, setConfirm] = useState<'start' | 'stop' | null>(null);
  const [showArrival, setShowArrival] = useState(false);
  const [newStop, setNewStop] = useState('');

  const onError = (e: unknown) => toast.error((e as Error).message || L('Something went wrong', 'حدث خطأ ما'));
  const back = (
    <Link to="/d/shipments" className="co-btn link" style={{ justifySelf: 'start', height: 32 }}><ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />{L('My shipments', 'شحناتي')}</Link>
  );

  if (isLoading) return <div className="dr-stack"><div className="cs-skel" /><div className="cs-skel" /></div>;
  if (!shipment) {
    return (
      <div className="dr-stack">
        {back}
        <p style={{ margin: 0, fontSize: 12, color: '#6b7a9c' }}>{L('This shipment is not available.', 'هذه الشحنة غير متاحة.')}</p>
      </div>
    );
  }

  const progress = stopProgress(shipment.stops);
  const last = latestReading(shipment.readings);
  const due = readingDue(shipment, last?.taken_at ?? null, now);
  const stats = tripSummary(shipment, now, lang);
  const where = shipment.locations[0] ?? null;
  const area = placeText(where, lang);
  const active = shipment.status === 'on_the_road';
  const onTheRoad = shipment.status === 'on_the_road';
  const alert = !!last?.is_alert;

  return (
    <div className="dr-stack">
      {back}
      {shipment.status !== 'cancelled' && <JourneyPulse shipment={shipment} lang={lang} now={now} audience="driver" onArrive={() => setShowArrival(true)} />}

      <section className="ch-card cs-box" style={alert ? { background: 'linear-gradient(90deg, #fff6f8, #fff 45%)' } : undefined}>
        <div className="co-card-top" style={{ marginBottom: 10 }}>
          <span className="co-no">{shipment.reference}</span>
          <span className="cs-cargo">{shipment.cargo}</span>
          <span className={cn('co-tag', STATUS_TAG[shipment.status])} style={{ marginInlineStart: 'auto' }}>{STATUS_LABELS[shipment.status][lang]}</span>
        </div>
        <div className="co-card-mid">
          <div className="co-amt-col">
            <div className="k">{L('Last recorded temperature', 'آخر حرارة مسجلة')}</div>
            <div className={cn('cs-big', alert && 'bad')}>{last ? `${temp(last.temperature_c)}°C` : '—'}</div>
            {last && <div className={cn('cs-state', alert ? 'bad' : 'ok')} style={{ fontSize: 11 }}>{alert ? L('Out of range', 'خارج النطاق') : L('In range', 'ضمن النطاق')} · {agoLabel(last.taken_at, now, lang)}</div>}
          </div>
          <div className="co-amt-col end">
            <TempLimits target={shipment.target_temp_c} tolerance={shipment.tolerance_c} lang={lang} />
            {shipment.weight_tons != null && <div className="cs-state mute"><Scale style={{ width: 11, height: 11, verticalAlign: '-1px' }} aria-hidden="true" /> {shipment.weight_tons} t</div>}
          </div>
        </div>
        {last && <details className="cs-latest-proof"><summary>{L('Latest photo and proof', 'آخر صورة وإثبات')}</summary><PhotoThumb path={last.photo_path} alt={L('Latest temperature photo', 'آخر صورة للحرارة')} /><ReadingProof reading={last} lang={lang} /></details>}
        <ReadingFreshness takenAt={last?.taken_at ?? null} intervalHours={shipment.reading_interval_hours} active={onTheRoad} now={now} lang={lang} />
        <RangeStrip temperature={last?.temperature_c ?? null} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} alert={alert} />
        {last && <TempVerdict temperature={last.temperature_c} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} lang={lang} />}
        {(
          <div className="cs-where">
            <MapPin aria-hidden="true" />
            <div>{L('Last known location', 'آخر موقع معروف')} <b>{area ?? (where ? L('Area name unavailable', 'اسم المنطقة غير متاح') : L('No location recorded yet', 'لم يُسجل موقع بعد'))}</b></div>
            {where && <span>{agoLabel(where.recorded_at, now, lang)}</span>}
          </div>
        )}
      </section>

      {shipment.status === 'ended_early' && <div className="cs-banner warn" role="status"><Package aria-hidden="true" /><div><b>{L('Trip ended early. Client approval is required before you can start again.', 'انتهت الرحلة مبكرًا. يلزم موافقة العميل قبل أن تتمكن من البدء مجددًا.')}</b></div></div>}
      {shipment.status === 'delivered' && <div className="cs-banner ok" role="status"><Package aria-hidden="true" /><b>{L('Delivered', 'تم التسليم')}</b></div>}
      {shipment.status === 'cancelled' && <div className="cs-banner" role="status"><div>{L('This shipment was cancelled.', 'تم إلغاء هذه الشحنة.')}</div></div>}

      {shipment.status === 'preparing' && (
        <button type="button" className="cs-cta" onClick={() => setConfirm('start')} disabled={start.isPending}>
          {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play className="rtl:-scale-x-100" aria-hidden="true" />}
          {L('Accept and start shipment', 'قبول الشحنة وبدء الرحلة')}
        </button>
      )}

      {onTheRoad && due.dueAt != null && <div className={`cs-banner ${due.state === 'overdue' || due.state === 'due_soon' ? 'warn' : ''}`} role="status"><Timer aria-hidden="true" /><div>
        <b>{L('Next reading due', 'موعد القراءة القادمة')}: {new Date(due.dueAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>
        {due.state === 'overdue' ? L(`Overdue by ${durationLabel(due.overdueMs, lang)}`, `متأخرة ${durationLabel(due.overdueMs, lang)}`) : L(`In ${durationLabel(due.dueAt - now, lang)}`, `بعد ${durationLabel(due.dueAt - now, lang)}`)}
      </div></div>}
      {active && <DriverReadingForm shipment={shipment} driverName={driverName} access={access} lang={lang} />}

      {onTheRoad && (
        <button type="button" className="co-btn bad dr-end" onClick={() => setConfirm('stop')} disabled={stop.isPending}>
          <Flag aria-hidden="true" />{L('Stop and end shipment', 'إيقاف الشحنة وإنهاء الرحلة')}
        </button>
      )}

      {onTheRoad && progress.next && (
        <section className="ch-card cs-box dr-actions">
          <div>
            <div className="dr-next">{L('Add a stop on the way', 'أضف محطة في الطريق')}</div>
            <div className="dr-nextname" style={{ fontSize: 'calc(12 * var(--q))' }}>{L('Keep the customer in the loop', 'أبقِ العميل على اطلاع')}</div>
          </div>
          <form
            className="cs-with"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newStop.trim()) return;
              addStop.mutate({ shipmentId: shipment.id, name: newStop }, { onSuccess: () => { setNewStop(''); toast.success(L('Stop added', 'تمت إضافة المحطة')); }, onError });
            }}
          >
            <div className="cs-field" style={{ flex: 1 }}>
              <input value={newStop} maxLength={80} onChange={(e) => setNewStop(e.target.value)} placeholder={L('Stop name', 'اسم المحطة')} aria-label={L('New stop name', 'اسم المحطة الجديدة')} />
            </div>
            <button type="submit" className="co-tool" disabled={addStop.isPending || newStop.trim().length < 2} aria-label={L('Add stop', 'إضافة محطة')} style={{ alignSelf: 'stretch' }}>
              {addStop.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPinPlus aria-hidden="true" />}
            </button>
          </form>
        </section>
      )}

      {shipment.status !== 'preparing' && (
        <section className="ch-card cs-box">
          <h3><Activity aria-hidden="true" />{L('This trip so far', 'رحلتك حتى الآن')}</h3>
          <TripTiles summary={stats} lang={lang} />
        </section>
      )}

      <RouteSummary stops={shipment.stops} status={shipment.status} lang={lang} />
      <TripHistory shipment={shipment} now={now} lang={lang} />
      {showArrival && progress.next && <ArrivalDialog stop={progress.next} lang={lang} onClose={() => setShowArrival(false)} />}

      {shipment.readings.length > 1 && (
        <section className="ch-card cs-box">
          <h3><ScanLine aria-hidden="true" />{L('Earlier readings', 'القراءات السابقة')}<small>{shipment.readings.length - 1}</small></h3>
          <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
            {shipment.readings.slice(1, 9).map((r) => <ReadingRow key={r.id} reading={r} lang={lang} now={now} />)}
          </ul>
        </section>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent className="ch-root co-root cs-confirm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'stop' ? L('End this shipment?', 'إنهاء هذه الشحنة؟') : confirm === 'start' ? L('Accept and start shipment?', 'قبول الشحنة وبدء الرحلة؟') : L('Confirm the stop', 'تأكيد المحطة')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'stop'
                ? L('This ends the trip now. You cannot resume until the client approves another start.', 'سيتم إنهاء الرحلة الآن. لا يمكنك استئنافها حتى يوافق العميل على البدء مجددًا.')
                : confirm === 'start'
                ? L('The customer will see the truck is on the road.', 'سيرى العميل أن الشاحنة في الطريق.')
                : L(`You are at ${progress.next ? stopName(progress.next, lang) : ''}. The customer will see it.`, `أنت الآن في ${progress.next ? stopName(progress.next, lang) : ''}. سيراها العميل.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L('Back', 'رجوع')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'stop') stop.mutate(shipment.id, { onError });
                else if (confirm === 'start') start.mutate(shipment.id, { onError });
                setConfirm(null);
              }}
            >
              {L('Confirm', 'تأكيد')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
