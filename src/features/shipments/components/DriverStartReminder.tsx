import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlarmClock, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useShipments, useStartShipment } from '../hooks';
import type { Lang } from '../route';

/**
 * The most urgent job for a driver, shown on every driver page until it is done: a shipment is waiting to be
 * accepted and started. The customer cannot follow the truck, and no readings are expected, until the driver does.
 * It stays pinned to the top of the screen and starts the trip right from here after one confirmation.
 */
export function DriverStartReminder({ lang }: { lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipments = [] } = useShipments();
  const start = useStartShipment();
  const location = useLocation();
  const [confirm, setConfirm] = useState(false);
  const waiting = shipments.filter((s) => s.status === 'preparing');
  const first = waiting[0];
  // On that shipment's own page the same action is already the first thing on the page.
  if (!first || location.pathname === `/d/shipments/${first.id}`) return null;
  const more = waiting.length - 1;

  return (
    <>
      <div className="dr-reminder" role="alert">
        <span className="ic"><AlarmClock aria-hidden="true" /></span>
        <div className="tx">
          <b>{L('Urgent: accept and start the shipment', 'عاجل: اقبل الشحنة وابدأ الرحلة')}</b>
          <span dir="auto">{first.reference} · {first.cargo}{more > 0 ? ` ${L(`+${more} more waiting`, `+${more} أخرى بالانتظار`)}` : ''}</span>
        </div>
        <button type="button" className="go" onClick={() => setConfirm(true)} disabled={start.isPending}>
          {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play className="rtl:-scale-x-100" aria-hidden="true" />}
          {L('Accept and start shipment', 'قبول الشحنة وبدء الرحلة')}
        </button>
        <Link to={`/d/shipments/${first.id}`} className="open">{L('Open', 'فتح')}</Link>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="ch-root co-root cs-confirm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{L('Accept and start shipment?', 'قبول الشحنة وبدء الرحلة؟')}</AlertDialogTitle>
            <AlertDialogDescription>{first.reference} · {L('The customer will see the truck is on the road.', 'سيرى العميل أن الشاحنة في الطريق.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L('Back', 'رجوع')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => start.mutate(first.id, { onError: (e) => toast.error((e as Error).message || L('Something went wrong', 'حدث خطأ ما')) })}>{L('Confirm', 'تأكيد')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
