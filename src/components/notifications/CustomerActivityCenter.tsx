/**
 * CustomerActivityCenter — the customer portal's notification bell.
 *
 * A large bell with a clear unread count (amber and pulsing when an order is
 * waiting for the customer's decision) opens a panel that:
 *  • leads with a "needs your decision" banner when something is pending
 *  • filters by All / Needs action / Orders / Messages / Other, with counts
 *  • lets the customer approve or reject an order straight from the card
 *  • sends every other notification to the matching /c/* page
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
  useMarkAllRead,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useNotifications,
} from '@/hooks/useNotifications';
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

export default function CustomerActivityCenter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CustomerNotifTab>('all');
  const navigate = useNavigate();
  const t = useT();
  const lang: 'en' | 'ar' = t.lang === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  const { data: notifications = [], unreadCount, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markManyRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllRead();

  const actionCount = useMemo(() => notifications.filter(needsCustomerAction).length, [notifications]);

  const tabCount = (id: CustomerNotifTab) => {
    if (id === 'all') return unreadCount;
    if (id === 'action') return actionCount;
    return notifications.filter((n) => !n.read_at && matchesCustomerTab(n, id)).length;
  };

  const grouped = useMemo(
    () => smartGroupNotifications(notifications.filter((n) => matchesCustomerTab(n, tab))),
    [notifications, tab],
  );

  const markIdsRead = (ids: string[]) => {
    if (ids.length > 1) markManyRead.mutate(ids);
    else if (ids.length === 1) markRead.mutate(ids[0]);
  };

  const onOpenNotification = (n: SmartNotification) => {
    markIdsRead(n.groupIds?.length ? n.groupIds.filter((id) => notifications.find((x) => x.id === id && !x.read_at)) : (!n.read_at ? [n.id] : []));
    setOpen(false);
    const target = customerNotificationTarget(n);
    navigate({ pathname: target.pathname, search: target.search });
  };

  const urgent = actionCount > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) setTab(actionCount > 0 ? 'action' : 'all');
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={L('Notifications', 'التنبيهات')}
          className={cn(
            'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors',
            urgent
              ? 'border-amber-500/60 bg-amber-500/15 text-amber-500'
              : unreadCount > 0
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-muted/60 text-muted-foreground hover:text-foreground',
          )}
        >
          <Bell className={cn('h-5 w-5', urgent && 'animate-pulse')} />
          {unreadCount > 0 && (
            <span className="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-black leading-none text-white ring-2 ring-background">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="w-[min(420px,calc(100vw-16px))] overflow-hidden p-0 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black">{L('Notifications', 'التنبيهات')}</h2>
            {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <button
            onClick={() => markAllRead.mutate()}
            disabled={unreadCount === 0 || markAllRead.isPending}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            <CheckCheck className="h-4 w-4" />
            {L('Mark all read', 'تحديد الكل كمقروء')}
          </button>
        </div>

        {/* What needs me? */}
        {urgent && tab !== 'action' && (
          <button
            onClick={() => setTab('action')}
            className="flex w-full items-center justify-between gap-2 bg-amber-500 px-4 py-2.5 text-start text-sm font-bold text-black"
          >
            <span>
              {actionCount === 1
                ? L('1 order is waiting for your decision', 'طلب واحد ينتظر قرارك')
                : L(`${actionCount} orders are waiting for your decision`, `${actionCount} طلبات تنتظر قرارك`)}
            </span>
            <span className="rounded-full bg-black/15 px-2 py-0.5 text-xs">{L('Review', 'مراجعة')}</span>
          </button>
        )}

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CUSTOMER_NOTIF_TABS.map((id) => {
            const count = tabCount(id);
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
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

        {/* List */}
        <ScrollArea className="max-h-[min(60vh,480px)]">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />{L('Loading…', 'جارٍ التحميل…')}
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <div className="rounded-full bg-muted p-4"><BellOff className="h-6 w-6 text-muted-foreground" /></div>
              <p className="text-sm font-semibold">
                {tab === 'action' ? L('Nothing needs your decision', 'لا يوجد ما يحتاج قرارك') : L('You are all caught up', 'لا توجد تنبيهات جديدة')}
              </p>
            </div>
          ) : (
            grouped.map((n) => (
              <CustomerNotificationCard
                key={n.id}
                n={n}
                lang={lang}
                onOpen={onOpenNotification}
                onDecided={markIdsRead}
              />
            ))
          )}
        </ScrollArea>

        {/* Footer */}
        <button
          onClick={() => { setOpen(false); navigate('/c/notifications'); }}
          className="w-full border-t py-3 text-center text-sm font-bold text-primary hover:bg-muted/50"
        >
          {L('See all notifications', 'عرض كل التنبيهات')}
        </button>
      </PopoverContent>
    </Popover>
  );
}
