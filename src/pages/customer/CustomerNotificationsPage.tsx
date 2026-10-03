import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { isToday, isYesterday } from 'date-fns';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { useMarkAllRead, useMarkNotificationRead, useMarkNotificationsRead, useNotifications } from '@/hooks/useNotifications';
import { smartGroupNotifications, type SmartNotification } from '@/lib/notification-grouping';
import {
  CUSTOMER_NOTIF_TABS,
  CustomerNotificationCard,
  customerNotificationTarget,
  customerTabLabel,
  matchesCustomerTab,
  needsCustomerAction,
  type CustomerNotifTab,
} from '@/features/customer/notifications/customer-notification-ui';

export default function CustomerNotificationsPage() {
  const { settings } = useTheme();
  const lang: 'en' | 'ar' = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const navigate = useNavigate();
  const [tab, setTab] = useState<CustomerNotifTab>('all');

  const { data: notifications = [], isLoading, unreadCount } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markManyRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllRead();

  const actionCount = useMemo(() => notifications.filter(needsCustomerAction).length, [notifications]);

  const countFor = (id: CustomerNotifTab) => {
    if (id === 'all') return unreadCount;
    if (id === 'action') return actionCount;
    return notifications.filter((n) => !n.read_at && matchesCustomerTab(n, id)).length;
  };

  // Newest first, bucketed so a long history stays scannable.
  const sections = useMemo(() => {
    const grouped = smartGroupNotifications(notifications.filter((n) => matchesCustomerTab(n, tab)));
    const buckets: Array<{ key: string; label: [string, string]; items: SmartNotification[] }> = [
      { key: 'today', label: ['Today', 'اليوم'], items: [] },
      { key: 'yesterday', label: ['Yesterday', 'أمس'], items: [] },
      { key: 'earlier', label: ['Earlier', 'سابقًا'], items: [] },
    ];
    for (const n of grouped) {
      const d = new Date(n.created_at);
      buckets[isToday(d) ? 0 : isYesterday(d) ? 1 : 2].items.push(n);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [notifications, tab]);

  const markIdsRead = (ids: string[]) => {
    if (ids.length > 1) markManyRead.mutate(ids);
    else if (ids.length === 1) markRead.mutate(ids[0]);
  };

  const open = (n: SmartNotification) => {
    const ids = (n.groupIds?.length ? n.groupIds : [n.id]).filter((id) => notifications.find((x) => x.id === id && !x.read_at));
    markIdsRead(ids);
    const target = customerNotificationTarget(n);
    navigate({ pathname: target.pathname, search: target.search });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">{L('Notifications', 'التنبيهات')}</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? L(`${unreadCount} unread`, `${unreadCount} غير مقروء`) : L('You are all caught up', 'لا توجد تنبيهات جديدة')}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10"
          >
            <CheckCheck className="h-4 w-4" />{L('Mark all read', 'تحديد الكل كمقروء')}
          </button>
        )}
      </div>

      {actionCount > 0 && tab !== 'action' && (
        <button
          onClick={() => setTab('action')}
          className="flex w-full items-center justify-between gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-start text-sm font-bold text-black"
        >
          <span>
            {actionCount === 1
              ? L('1 order is waiting for your decision', 'طلب واحد ينتظر قرارك')
              : L(`${actionCount} orders are waiting for your decision`, `${actionCount} طلبات تنتظر قرارك`)}
          </span>
          <span className="rounded-full bg-black/15 px-2.5 py-0.5 text-xs">{L('Review', 'مراجعة')}</span>
        </button>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CUSTOMER_NOTIF_TABS.map((id) => {
          const count = countFor(id);
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {customerTabLabel(id, lang)}
              {count > 0 && (
                <span className={cn(
                  'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black',
                  active ? 'bg-primary-foreground/25 text-primary-foreground' : id === 'action' ? 'bg-amber-500 text-black' : 'bg-destructive text-white',
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{L('Loading…', 'جارٍ التحميل…')}</div>
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-muted p-5"><BellOff className="h-8 w-8 text-muted-foreground" /></div>
          <p className="text-base font-semibold">
            {tab === 'action' ? L('Nothing needs your decision', 'لا يوجد ما يحتاج قرارك') : L('No notifications here', 'لا توجد تنبيهات هنا')}
          </p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="space-y-2">
            <h2 className="px-1 text-xs font-black uppercase tracking-wider text-muted-foreground">{L(section.label[0], section.label[1])}</h2>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
              {section.items.map((n) => (
                <CustomerNotificationCard key={n.id} n={n} lang={lang} onOpen={open} onDecided={markIdsRead} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
