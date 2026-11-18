import { Link } from 'react-router-dom';
import { ArrowUpRight, Thermometer, X } from 'lucide-react';
import { useMarkNotificationRead } from '@/hooks/useNotifications';
import type { AppNotification } from '@/types/notifications';
import type { Lang } from '../route';

export const DRIVER_EXCURSION_DEDUPE_PREFIX = 'shipment-driver-excursion:';

/** True for an unread temperature excursion created by the reading trigger. */
export function isDriverExcursionAlert(notification: AppNotification): boolean {
  return !notification.read_at
    && notification.target.dedupeKey?.startsWith(DRIVER_EXCURSION_DEDUPE_PREFIX) === true;
}

/**
 * A live temperature excursion in the driver cockpit. It is fed by the same
 * notification row that triggers the Web Push, so the banner appears even when
 * the OS notification is suppressed because the app is in the foreground.
 */
export function DriverExcursionAlert({ alerts, lang }: { alerts: AppNotification[]; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const mark = useMarkNotificationRead();
  const latest = alerts[0];
  if (!latest) return null;

  const path = latest.target.targetPath
    ?? (latest.entity_id ? `/d/shipments/${encodeURIComponent(latest.entity_id)}` : '/d/shipments');
  const extra = alerts.length - 1;
  const title = latest.title.includes(' / ')
    ? (lang === 'ar' ? latest.title.split(' / ').slice(1).join(' / ') : latest.title.split(' / ')[0])
    : latest.title;

  return (
    <section className="dr-excursion" role="alert" aria-live="assertive">
      <span className="dr-excursion-ic"><Thermometer aria-hidden="true" /></span>
      <div className="dr-excursion-body">
        <div className="dr-excursion-kicker">
          <span className="dr-excursion-pulse" aria-hidden="true" />
          {L('Live temperature alert', 'تنبيه حرارة مباشر')}
          {extra > 0 && <b>+{extra}</b>}
        </div>
        <div className="dr-excursion-title">{title}</div>
        {latest.body && <p>{latest.body}</p>}
        <div className="dr-excursion-actions">
          <Link
            to={path}
            className="dr-excursion-open"
            onClick={() => mark.mutate(latest.id)}
          >
            {L('Open trip', 'فتح الرحلة')}<ArrowUpRight aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="dr-excursion-dismiss"
            onClick={() => mark.mutate(latest.id)}
            disabled={mark.isPending}
          >
            {L('Dismiss', 'إخفاء')}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="dr-excursion-x"
        aria-label={L('Dismiss alert', 'إخفاء التنبيه')}
        onClick={() => mark.mutate(latest.id)}
        disabled={mark.isPending}
      >
        <X aria-hidden="true" />
      </button>
    </section>
  );
}
