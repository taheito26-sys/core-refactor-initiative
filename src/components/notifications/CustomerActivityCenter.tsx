/**
 * CustomerActivityCenter — customer-side notification dropdown
 *
 * Features:
 *  • Real-time badge via Supabase channel (live green dot)
 *  • Category filter tabs with per-category unread counts
 *  • Smart grouping (dedup + 30-min collapse)
 *  • Per-notification icon based on kind
 *  • Inline action buttons for order approvals/rejections
 *  • Empty state per category
 *  • Click-row navigates with deep-link + marks read
 *  • RTL-aware layout
 *  • Customer-specific notification categories:
 *      - Orders: Merchant placed an order, order approved/rejected, etc.
 *      - Approvals: Awaiting customer approval on orders
 *      - Messages: Direct messages from merchants
 *      - System: System notifications
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Check, X, MessageSquare, ShoppingBag,
  Shield, Settings2, RefreshCw, ChevronRight, Wifi, WifiOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
  useMarkAllRead, useMarkCategoryRead,
  useMarkNotificationRead, useMarkNotificationsRead,
  useNotifications,
} from '@/hooks/useNotifications';
import { smartGroupNotifications, type SmartNotification } from '@/lib/notification-grouping';
import { handleNotificationClick } from '@/lib/notification-router';
import { normalizeNotificationCategory, type NotificationCategoryGroup } from '@/types/notifications';
import { respondSharedOrder, type WorkflowOrder } from '@/features/orders/shared-order-workflow';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// ─── Notification localization helpers ──────────────────────────────────────

function localizeNotifTitle(title: string | null | undefined, lang: string): string {
  if (!title) return '';
  if (lang !== 'ar') return title;
  const t = title.trim();
  if (/order confirmed/i.test(t)) return 'تم تأكيد الطلب';
  if (/order completed/i.test(t)) return 'تم إكمال الطلب';
  if (/order cancelled/i.test(t)) return 'تم إلغاء الطلب';
  if (/order rejected/i.test(t)) return 'تم رفض الطلب';
  if (/order approved/i.test(t)) return 'تمت الموافقة على الطلب';
  if (/new customer order/i.test(t)) return 'طلب عميل جديد';
  if (/placed an order for you/i.test(t)) {
    const name = t.replace(/placed an order for you/i, '').trim();
    return name ? `${name} قدّم لك طلبًا` : 'تم تقديم طلب لك';
  }
  if (/placed an order/i.test(t)) {
    const name = t.replace(/placed an order/i, '').trim();
    return name ? `${name} قدّم طلبًا` : 'تم تقديم طلب';
  }
  if (/requested an order/i.test(t)) {
    const name = t.replace(/requested an order/i, '').trim();
    return name ? `${name} طلب طلبًا` : 'تم طلب طلب';
  }
  if (/new order/i.test(t)) return 'طلب جديد';
  if (/payment received/i.test(t)) return 'تم استلام الدفع';
  if (/payment confirmed/i.test(t)) return 'تم تأكيد الدفع';
  return title;
}

function localizeNotifBody(body: string | null | undefined, lang: string): string {
  if (!body) return '';
  if (lang !== 'ar') return body;
  const b = body.trim();
  const updatedMatch = b.match(/^(.+?)\s+updated your\s+(\w+)\s+order to:\s+(.+)$/i);
  if (updatedMatch) {
    const [, name, type, status] = updatedMatch;
    const typeAr = type === 'buy' ? 'شراء' : type === 'sell' ? 'بيع' : type;
    const statusMap: Record<string, string> = {
      confirmed: 'مؤكد', completed: 'مكتمل', cancelled: 'ملغي',
      approved: 'موافق عليه', rejected: 'مرفوض', pending: 'معلق',
    };
    return `${name} حدّث طلب ${typeAr}ك إلى: ${statusMap[status.toLowerCase()] ?? status}`;
  }
  const placedMatch = b.match(/^(.+?)\s+placed a\s+(\w+)\s+order for\s+(.+)$/i);
  if (placedMatch) {
    const [, name, type, amount] = placedMatch;
    const typeAr = type === 'buy' ? 'شراء' : type === 'sell' ? 'بيع' : type;
    return `${name} قدّم طلب ${typeAr} بـ ${amount}`;
  }
  return body;
}

// ─── Category config ────────────────────────────────────────────────────────

interface CatConfig {
  id: NotificationCategoryGroup;
  labelKey: string;
  Icon: React.ElementType;
  color: string;
}

const CUSTOMER_CATEGORIES: CatConfig[] = [
  { id: 'all',      labelKey: 'notifCatAll',       Icon: Bell,         color: 'text-muted-foreground' },
  { id: 'approval', labelKey: 'notifCatApproval',  Icon: Shield,       color: 'text-amber-500'        },
  { id: 'order',    labelKey: 'notifCatOrder',     Icon: ShoppingBag,  color: 'text-emerald-500'      },
  { id: 'message',  labelKey: 'notifCatMessage',   Icon: MessageSquare,color: 'text-sky-500'          },
  { id: 'system',   labelKey: 'notifCatSystem',    Icon: Settings2,    color: 'text-muted-foreground' },
];

function iconForCategory(cat: string): React.ElementType {
  switch (normalizeNotificationCategory(cat)) {
    case 'approval':  return Shield;
    case 'order':     return ShoppingBag;
    case 'message':   return MessageSquare;
    default:          return Bell;
  }
}

function colorForCategory(cat: string): string {
  switch (normalizeNotificationCategory(cat)) {
    case 'approval':  return 'text-amber-500';
    case 'order':     return 'text-emerald-500';
    case 'message':   return 'text-sky-500';
    default:          return 'text-muted-foreground';
  }
}

// ─── Inline action area ─────────────────────────────────────────────────────

interface ActionAreaProps {
  n: SmartNotification;
  onDone: (ids: string[]) => void;
  t: ReturnType<typeof useT>;
}

function InlineActionArea({ n, onDone, t }: ActionAreaProps) {
  const queryClient = useQueryClient();
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionTaken, setActionTaken] = useState<'approved' | 'rejected' | null>(null);

  // Show approve/reject for any customer_order notification that has an order ID
  const isOrderApprovalNotif =
    n.category === 'customer_order' &&
    (n.target.entityType === 'customer_order' || n.target.targetEntityType === 'customer_order' || !n.target.entityType);

  if (!isOrderApprovalNotif) return null;

  const orderId = n.target.entityId ?? n.target.targetEntityId ?? null;
  if (!orderId) return null;

  // If action already taken, show dimmed confirmation
  if (actionTaken) {
    return (
      <div className="flex items-center gap-1.5 mt-2 opacity-50" onClick={(e) => e.stopPropagation()}>
        <span className={cn(
          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
          actionTaken === 'approved' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-destructive/20 text-destructive',
        )}>
          {actionTaken === 'approved' ? (t('approved') || 'Approved') : (t('rejected') || 'Rejected')} ✓
        </span>
      </div>
    );
  }

  const approveMutation = useMutation({
    mutationFn: async () => {
      await respondSharedOrder({
        orderId,
        actorRole: 'customer',
        action: 'approve',
      });
    },
    onSuccess: () => {
      toast.success(t('orderApprovedSuccess') || t('approved') || 'Order approved');
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['c-orders'] });
      setActionTaken('approved');
      onDone([n.id]);
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to approve order');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason?: string) => {
      await respondSharedOrder({
        orderId,
        actorRole: 'customer',
        action: 'reject',
        reason: reason || undefined,
      });
    },
    onSuccess: () => {
      toast.success(t('orderRejectedSuccess') || t('rejected') || 'Order rejected');
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['c-orders'] });
      setActionTaken('rejected');
      onDone([n.id]);
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to reject order');
    },
  });

  const busy = approveMutation.isPending || rejectMutation.isPending;

  if (showRejectReason) {
    return (
      <div className="mt-2 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        <textarea
          placeholder={t('rejectReasonPlaceholder') || 'Reason for rejection...'}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          className="text-xs min-h-[56px] resize-none rounded-md border border-border/50 bg-card px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            className="h-6 text-[10px] px-2.5"
            disabled={busy || !rejectReason.trim()}
            onClick={() => rejectMutation.mutate(rejectReason.trim())}
          >
            {t('confirmReject') || t('reject') || 'Confirm Reject'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={() => { setShowRejectReason(false); setRejectReason(''); }}
          >
            {t('cancel') || 'Cancel'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="default"
        className="h-6 text-[10px] px-2.5 gap-1 bg-emerald-600 hover:bg-emerald-700"
        disabled={busy}
        onClick={() => approveMutation.mutate()}
      >
        <Check className="h-3 w-3" />{t('approve') || 'Approve'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[10px] px-2.5 gap-1 border-destructive text-destructive hover:bg-destructive/10"
        disabled={busy}
        onClick={() => setShowRejectReason(true)}
      >
        <X className="h-3 w-3" />{t('reject') || 'Reject'}
      </Button>
      <span className="ml-auto text-[9px] text-amber-500 font-semibold self-center">{t('actionNeeded') || 'Action needed'}</span>
    </div>
  );
}

// ─── Notification row ────────────────────────────────────────────────────────

interface NotificationRowProps {
  n: SmartNotification;
  onNavigate: (n: SmartNotification) => void;
  onActionDone: (ids: string[]) => void;
  t: ReturnType<typeof useT>;
}

function NotificationRow({ n, onNavigate, onActionDone, t }: NotificationRowProps) {
  const isUnread = !n.read_at;
  const Icon = iconForCategory(n.category);
  const color = colorForCategory(n.category);
  const hasAction = n.category === 'customer_order' &&
    (n.target.entityType === 'customer_order' || n.target.targetEntityType === 'customer_order' || !n.target.entityType) &&
    (n.target.entityId ?? n.target.targetEntityId);

  // Localize stored English titles/bodies
  const lang = t.lang ?? 'en';
  const localizedTitle = localizeNotifTitle(n.title, lang);
  const localizedBody = localizeNotifBody(n.body, lang);

  return (
    <div
      onClick={() => onNavigate(n)}
      className="group cursor-pointer border-b last:border-0 px-3 py-2 hover:bg-muted/50 transition-colors"
    >
      <div className="flex gap-2 text-sm">
        <div className={cn('mt-0.5 shrink-0 rounded-full p-1.5',
          isUnread ? 'bg-primary/10' : 'bg-muted')}>
          <Icon className={cn('h-3.5 w-3.5', isUnread ? color : 'text-muted-foreground')} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-baseline gap-1 justify-between">
            <span className={cn('text-xs font-semibold truncate', isUnread ? 'text-foreground' : 'text-muted-foreground')}>
              {localizedTitle}
              {n.groupCount && n.groupCount > 1 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{n.groupCount}</span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </span>
          </div>

          {/* Body */}
          {localizedBody && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{localizedBody}</p>
          )}

          {/* Inline action buttons */}
          {hasAction && (
            <InlineActionArea n={n} onDone={onActionDone} t={t} />
          )}

          {/* Navigate hint for non-action items */}
          {!hasAction && (
            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{t('viewDetails') || 'View details'}</span>
            </div>
          )}
        </div>

        {/* Unread dot */}
        {isUnread && (
          <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
        )}
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ category, t }: { category: NotificationCategoryGroup; t: ReturnType<typeof useT> }) {
  const messages: Record<NotificationCategoryGroup, string> = {
    all:        t('noNotifications') || 'No notifications',
    approval:   t('noApprovals') || 'No approvals needed',
    order:      t('noNotifications') || 'No orders',
    message:    t('noNotifications') || 'No messages',
    system:     t('noNotifications') || 'No system notifications',
    deal:       t('noNotifications') || 'No notifications',
    invite:     t('noNotifications') || 'No notifications',
    agreement:  t('noNotifications') || 'No notifications',
    settlement: t('noNotifications') || 'No notifications',
  };
  const cfg = CUSTOMER_CATEGORIES.find(c => c.id === category) ?? CUSTOMER_CATEGORIES[0];
  const { Icon, color } = cfg;
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
      <div className="rounded-full bg-muted p-3">
        <Icon className={cn('h-5 w-5', color, 'opacity-40')} />
      </div>
      <p className="text-xs text-muted-foreground">{messages[category]}</p>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

const CUSTOMER_NOTIFICATION_CATEGORIES: NotificationCategoryGroup[] = ['all', 'approval', 'order', 'message', 'system'];

export default function CustomerActivityCenter() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<NotificationCategoryGroup>('all');
  const navigate = useNavigate();
  const t = useT();

  const { data: notifications, unreadCount, unreadByCategory, isLoading, hasLiveNotificationChannel } =
    useNotifications();

  const markRead = useMarkNotificationRead();
  const markManyRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllRead();
  const markCatRead = useMarkCategoryRead();

  // Filter + group
  const filtered = useMemo(() => {
    if (!notifications) return [];
    if (activeCategory === 'all') return notifications;
    return notifications.filter(
      (n) => normalizeNotificationCategory(n.category) === activeCategory,
    );
  }, [notifications, activeCategory]);

  const grouped = useMemo(() => smartGroupNotifications(filtered), [filtered]);

  // Navigate and mark read
  const onNavigate = async (n: SmartNotification) => {
    const ids = n.groupIds?.length ? n.groupIds : (!n.read_at ? [n.id] : []);
    if (ids.length > 1) markManyRead.mutate(ids);
    else if (ids.length === 1) markRead.mutate(ids[0]);
    setOpen(false);
    handleNotificationClick(n, navigate);
  };

  // Called by InlineActionArea after a successful action — marks all group IDs read
  const onActionDone = (ids: string[]) => {
    if (ids.length > 1) markManyRead.mutate(ids);
    else if (ids.length === 1) markRead.mutate(ids[0]);
  };

  // Unread count per visible tab
  const tabCount = (cat: NotificationCategoryGroup) =>
    cat === 'all' ? unreadCount : (unreadByCategory[cat] ?? 0);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) setActiveCategory('all');
        setOpen(v);
      }}
    >
      {/* ── Bell trigger ─────────────────────────────────────────────── */}
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      {/* ── Popover panel ────────────────────────────────────────────── */}
      <PopoverContent align="end" sideOffset={6} className="w-[380px] p-0 shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <strong className="text-sm">{t('activityCenter') || 'Activity Center'}</strong>
            {hasLiveNotificationChannel ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                <Wifi className="h-3 w-3" />
                {t('liveLabel') || 'Live'}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <WifiOff className="h-3 w-3" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isLoading && <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />}
            {activeCategory !== 'all' && (
              <Button
                size="sm" variant="ghost"
                className="h-7 text-[11px] px-2"
                onClick={() => markCatRead.mutate(activeCategory)}
                disabled={markCatRead.isPending}
              >
                {t('clearAll') || 'Clear'}
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2"
              title={t('markAllRead') || 'Mark all as read'}
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="px-2 pt-2 pb-1 flex gap-1 flex-wrap border-b">
          {CUSTOMER_NOTIFICATION_CATEGORIES.map((cat) => {
            const cfg = CUSTOMER_CATEGORIES.find(c => c.id === cat)!;
            const count = tabCount(cat);
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <cfg.Icon className={cn('h-3 w-3', active ? '' : cfg.color)} />
                <span>{t(cfg.labelKey as any) || cat}</span>
                {count > 0 && (
                  <span className={cn(
                    'min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center',
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-destructive text-white',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Notification list */}
        <ScrollArea className="max-h-[440px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t('loading') || 'Loading...'}
            </div>
          ) : grouped.length === 0 ? (
            <EmptyState category={activeCategory} t={t} />
          ) : (
            grouped.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onNavigate={onNavigate}
                onActionDone={onActionDone}
                t={t}
              />
            ))
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground flex justify-between items-center">
          <span>{(notifications ?? []).length} {t('notifTotalCount') || 'notifications'}</span>
          <button
            className="text-[10px] hover:text-foreground transition-colors"
            onClick={() => { setOpen(false); navigate('/customer/notifications'); }}
          >
            {t('viewAllNotifications') || 'View all'} →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
