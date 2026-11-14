import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Flag, Loader2, MapPinPlus, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/lib/theme-context';
import { DriverReadingForm } from '@/features/shipments/components/DriverReadingForm';
import { DueBadge } from '@/features/shipments/components/DueBadge';
import { PhotoThumb } from '@/features/shipments/components/PhotoThumb';
import { RouteTimeline } from '@/features/shipments/components/RouteTimeline';
import { StatusChip } from '@/features/shipments/components/StatusChip';
import { TemperatureReadout } from '@/features/shipments/components/TemperatureReadout';
import { useAddStop, useReachStop, useShipment, useStartShipment } from '@/features/shipments/hooks';
import { latestReading, readingDue, stopName, stopProgress } from '@/features/shipments/route';

/** One trip from the driver's side: start it, send temperature photos, confirm stops, add stops. */
export default function DriverShipmentPage() {
  const { id = null } = useParams();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipment, isLoading } = useShipment(id);
  const start = useStartShipment();
  const reach = useReachStop();
  const addStop = useAddStop();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const [confirm, setConfirm] = useState<'start' | 'reach' | null>(null);
  const [newStop, setNewStop] = useState('');

  const onError = (e: unknown) => toast.error((e as Error).message || L('Something went wrong', 'حدث خطأ ما'));

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>;
  if (!shipment) {
    return (
      <div className="space-y-3">
        <Link to="/d/shipments" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{L('My shipments', 'شحناتي')}</Link>
        <p className="text-sm text-muted-foreground">{L('This shipment is not available.', 'هذه الشحنة غير متاحة.')}</p>
      </div>
    );
  }

  const progress = stopProgress(shipment.stops);
  const last = latestReading(shipment.readings);
  const due = readingDue(shipment, last?.taken_at ?? null, now);
  const active = shipment.status === 'preparing' || shipment.status === 'on_the_road';
  const onTheRoad = shipment.status === 'on_the_road';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to="/d/shipments" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{L('My shipments', 'شحناتي')}</Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-extrabold">{shipment.reference}</h1>
          <StatusChip status={shipment.status} lang={lang} />
        </div>
        <p className="text-sm text-muted-foreground">{shipment.cargo}</p>
        <p className="text-xs text-muted-foreground">
          {L('Keep at', 'الحرارة المطلوبة')} <b dir="ltr">{shipment.target_temp_c}°C</b> (±{shipment.tolerance_c}) · {L('photo every', 'صورة كل')} {shipment.reading_interval_hours} {L('h', 'ساعة')}
        </p>
      </div>

      {shipment.status === 'delivered' && <p className="rounded-xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400" role="status">{L('Delivered. Thank you.', 'تم التسليم. شكرًا لك.')}</p>}
      {shipment.status === 'cancelled' && <p className="rounded-xl bg-muted p-3 text-sm" role="status">{L('This shipment was cancelled.', 'تم إلغاء هذه الشحنة.')}</p>}

      {shipment.status === 'preparing' && (
        <Button className="h-14 w-full text-base" onClick={() => setConfirm('start')} disabled={start.isPending}>
          {start.isPending ? <Loader2 className="me-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <Play className="me-2 h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />}
          {L('Start the trip', 'ابدأ الرحلة')}
        </Button>
      )}

      {onTheRoad && due.state !== 'ok' && due.state !== 'idle' && <div><DueBadge due={due} lang={lang} now={now} /></div>}

      {active && <DriverReadingForm shipment={shipment} lang={lang} />}

      {onTheRoad && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          {progress.next ? (
            <>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Next stop', 'المحطة التالية')}</div>
                <div className="text-lg font-bold">{stopName(progress.next, lang)}</div>
              </div>
              <Button variant="secondary" className="h-12 w-full text-base" onClick={() => setConfirm('reach')} disabled={reach.isPending}>
                {reach.isPending ? <Loader2 className="me-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <Flag className="me-2 h-5 w-5" aria-hidden="true" />}
                {L('I reached this stop', 'وصلت إلى هذه المحطة')}
              </Button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newStop.trim()) return;
                  addStop.mutate({ shipmentId: shipment.id, name: newStop }, { onSuccess: () => { setNewStop(''); toast.success(L('Stop added', 'تمت إضافة المحطة')); }, onError });
                }}
              >
                <Input value={newStop} maxLength={80} onChange={(e) => setNewStop(e.target.value)} placeholder={L('Add a stop on the way', 'أضف محطة في الطريق')} aria-label={L('New stop name', 'اسم المحطة الجديدة')} />
                <Button type="submit" variant="outline" disabled={addStop.isPending || newStop.trim().length < 2} aria-label={L('Add stop', 'إضافة محطة')}>
                  {addStop.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MapPinPlus className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </form>
            </>
          ) : null}
        </section>
      )}

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-bold">{L('Route', 'المسار')}</h2>
        <RouteTimeline stops={shipment.stops} lang={lang} />
      </section>

      {shipment.readings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">{L('Sent readings', 'القراءات المرسلة')}</h2>
          <ul className="space-y-2">
            {shipment.readings.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2">
                <PhotoThumb path={r.photo_path} alt={L('Temperature screen photo', 'صورة شاشة الحرارة')} className="h-12 w-12 shrink-0" />
                <TemperatureReadout reading={r} targetC={shipment.target_temp_c} lang={lang} now={now} size="sm" />
              </li>
            ))}
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
                else if (progress.next) reach.mutate(progress.next.id, { onError });
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
