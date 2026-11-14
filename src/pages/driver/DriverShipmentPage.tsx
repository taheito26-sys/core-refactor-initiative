import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Flag, Loader2, MapPin, MapPinPlus, Package, Play, Route as RouteIcon, ScanLine, Scale, Thermometer, Timer } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DriverReadingForm } from '@/features/shipments/components/DriverReadingForm';
import { ReadingProof, ReadingRow } from '@/features/shipments/components/ReadingRow';
import { RouteList } from '@/features/shipments/components/RouteList';
import { RangeStrip } from '@/features/shipments/components/ShipmentCard';
import { TripTiles } from '@/features/shipments/components/TripTiles';
import { placeText } from '@/features/shipments/geo';
import { useAddStop, useReachStop, useShipment, useStartShipment } from '@/features/shipments/hooks';
import { reportStopLocation } from '@/features/shipments/reporting';
import { agoLabel, durationLabel, latestReading, readingDue, stopName, stopProgress, STATUS_LABELS, STATUS_TAG } from '@/features/shipments/route';
import { tripSummary } from '@/features/shipments/trip-summary';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import type { DriverOutletContext } from './DriverLayout';

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
  const reach = useReachStop();
  const addStop = useAddStop();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const [confirm, setConfirm] = useState<'start' | 'reach' | null>(null);
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
  const active = shipment.status === 'preparing' || shipment.status === 'on_the_road';
  const onTheRoad = shipment.status === 'on_the_road';
  const alert = !!last?.is_alert;

  return (
    <div className="dr-stack">
      {back}

      <section className="ch-card cs-box" style={alert ? { background: 'linear-gradient(90deg, #fff6f8, #fff 45%)' } : undefined}>
        <div className="co-card-top" style={{ marginBottom: 10 }}>
          <span className="co-no">{shipment.reference}</span>
          <span className="cs-cargo">{shipment.cargo}</span>
          <span className={cn('co-tag', STATUS_TAG[shipment.status])} style={{ marginInlineStart: 'auto' }}>{STATUS_LABELS[shipment.status][lang]}</span>
        </div>
        <div className="co-card-mid">
          <div className="co-amt-col">
            <div className="k">{L('Temperature now', 'الحرارة الآن')}</div>
            <div className={cn('cs-big', alert && 'bad')}>{last ? `${temp(last.temperature_c)}°C` : '—'}</div>
            {last && <div className={cn('cs-state', alert ? 'bad' : 'ok')} style={{ fontSize: 11 }}>{alert ? L('Out of range', 'خارج النطاق') : L('In range', 'ضمن النطاق')} · {agoLabel(last.taken_at, now, lang)}</div>}
          </div>
          <div className="co-amt-col end">
            <div className="k">{L('Keep at', 'المطلوب')}</div>
            <div className="co-amt cs-temp"><small>±{shipment.tolerance_c}</small><b>{temp(shipment.target_temp_c)}</b></div>
            {shipment.weight_tons != null && <div className="cs-state mute"><Scale style={{ width: 11, height: 11, verticalAlign: '-1px' }} aria-hidden="true" /> {shipment.weight_tons} t</div>}
          </div>
        </div>
        <RangeStrip temperature={last?.temperature_c ?? null} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} alert={alert} />
        {(area || where) && (
          <div className="cs-where">
            <MapPin aria-hidden="true" />
            <div>{L('You are in', 'أنت في')} <b>{area ?? L('—', '—')}</b></div>
            {where && <span>{agoLabel(where.recorded_at, now, lang)}</span>}
          </div>
        )}
        {onTheRoad && due.dueAt != null && (
          <div className="cs-meta" style={{ marginTop: 8 }}>
            <div className={due.state === 'overdue' ? 'warn' : undefined}>
              <Timer aria-hidden="true" />
              {due.state === 'overdue'
                ? L(`Reading overdue by ${durationLabel(due.overdueMs, lang)}`, `القراءة متأخرة ${durationLabel(due.overdueMs, lang)}`)
                : L(`Next reading in ${durationLabel(due.dueAt - now, lang)} (every ${shipment.reading_interval_hours} h)`, `القراءة القادمة بعد ${durationLabel(due.dueAt - now, lang)} (كل ${shipment.reading_interval_hours} ساعات)`)}
            </div>
          </div>
        )}
      </section>

      {shipment.status === 'delivered' && <div className="cs-banner ok" role="status"><Package aria-hidden="true" /><div><b>{L('Delivered. Thank you.', 'تم التسليم. شكرًا لك.')}</b></div></div>}
      {shipment.status === 'cancelled' && <div className="cs-banner" role="status"><div>{L('This shipment was cancelled.', 'تم إلغاء هذه الشحنة.')}</div></div>}

      {shipment.status === 'preparing' && (
        <button type="button" className="cs-cta" onClick={() => setConfirm('start')} disabled={start.isPending}>
          {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play className="rtl:-scale-x-100" aria-hidden="true" />}
          {L('Start the trip', 'ابدأ الرحلة')}
        </button>
      )}

      {active && <DriverReadingForm shipment={shipment} driverName={driverName} access={access} lang={lang} />}

      {onTheRoad && progress.next && (
        <section className="ch-card cs-box dr-actions">
          <div>
            <div className="dr-next">{L('Next stop', 'المحطة التالية')}</div>
            <div className="dr-nextname">{stopName(progress.next, lang)}</div>
          </div>
          <button type="button" className="cs-cta soft" onClick={() => setConfirm('reach')} disabled={reach.isPending}>
            {reach.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Flag aria-hidden="true" />}
            {L('I reached this stop', 'وصلت إلى هذه المحطة')}
          </button>
          <form
            className="cs-with"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newStop.trim()) return;
              addStop.mutate({ shipmentId: shipment.id, name: newStop }, { onSuccess: () => { setNewStop(''); toast.success(L('Stop added', 'تمت إضافة المحطة')); }, onError });
            }}
          >
            <div className="cs-field" style={{ flex: 1 }}>
              <input value={newStop} maxLength={80} onChange={(e) => setNewStop(e.target.value)} placeholder={L('Add a stop on the way', 'أضف محطة في الطريق')} aria-label={L('New stop name', 'اسم المحطة الجديدة')} />
            </div>
            <button type="submit" className="co-tool" disabled={addStop.isPending || newStop.trim().length < 2} aria-label={L('Add stop', 'إضافة محطة')} style={{ alignSelf: 'stretch' }}>
              {addStop.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPinPlus aria-hidden="true" />}
            </button>
          </form>
        </section>
      )}

      {last && (
        <section className="ch-card cs-box">
          <h3><Thermometer aria-hidden="true" />{L('Last proof sent', 'آخر إثبات أُرسل')}</h3>
          <ReadingProof reading={last} lang={lang} />
        </section>
      )}

      {shipment.status !== 'preparing' && (
        <section className="ch-card cs-box">
          <h3><Activity aria-hidden="true" />{L('This trip so far', 'رحلتك حتى الآن')}</h3>
          <TripTiles summary={stats} lang={lang} />
        </section>
      )}

      <section className="ch-card cs-box">
        <h3><RouteIcon aria-hidden="true" />{L('Route', 'المسار')}<small>{progress.reachedCount}/{progress.total}</small></h3>
        <RouteList stops={shipment.stops} status={shipment.status} lang={lang} />
      </section>

      {shipment.readings.length > 0 && (
        <section className="ch-card cs-box">
          <h3><ScanLine aria-hidden="true" />{L('Sent readings', 'القراءات المرسلة')}<small>{shipment.readings.length}</small></h3>
          <ul className="cs-rows" style={{ margin: 0, padding: 0 }}>
            {shipment.readings.slice(0, 8).map((r) => <ReadingRow key={r.id} reading={r} lang={lang} now={now} />)}
          </ul>
        </section>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'start' ? L('Start the trip?', 'بدء الرحلة؟') : L('Confirm the stop', 'تأكيد المحطة')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'start'
                ? L('The customer will see the truck is on the road.', 'سيرى العميل أن الشاحنة في الطريق.')
                : L(`You are at ${progress.next ? stopName(progress.next, lang) : ''}. The customer will see it.`, `أنت الآن في ${progress.next ? stopName(progress.next, lang) : ''}. سيراها العميل.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L('Back', 'رجوع')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === 'start') start.mutate(shipment.id, { onError });
                else if (progress.next) reach.mutate(progress.next.id, { onError, onSuccess: () => { void reportStopLocation(shipment.id); } });
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
