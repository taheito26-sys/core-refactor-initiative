// ─── Customer notification building blocks ───
// Shared by the bell popover (CustomerActivityCenter) and the full
// /c/notifications page so both read and behave identically.

import { useState } from 'react';
import { Bell, Check, ChevronRight, MessageSquare, ShoppingBag, X, Wallet, type LucideIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { respondSharedOrder } from '@/features/orders/shared-order-workflow';
import { buildNotificationNavigationTarget } from '@/lib/notification-router';
import type { SmartNotification } from '@/lib/notification-grouping';
import type { AppNotification } from '@/types/notifications';

// ─── Categories ───

export type CustomerNotifTab = 'all' | 'action' | 'order' | 'message' | 'other';

export const CUSTOMER_NOTIF_TABS: CustomerNotifTab[] = ['all', 'action', 'order', 'message', 'other'];

export function customerTabLabel(tab: CustomerNotifTab, lang: 'en' | 'ar'): string {
  const labels: Record<CustomerNotifTab, [string, string]> = {
    all: ['All', 'الكل'],
    action: ['Needs action', 'تحتاج إجراء'],
    order: ['Orders', 'الطلبات'],
    message: ['Messages', 'الرسائل'],
    other: ['Other', 'أخرى'],
  };
  return labels[tab][lang === 'ar' ? 1 : 0];
}

const ORDER_CATEGORIES = new Set(['order', 'customer_order', 'deal', 'settlement']);
const MESSAGE_CATEGORIES = new Set(['message', 'chat']);

// Customer order notifications arrive as "<merchant> placed an order for you"
// while still pending; every other wording (approved, rejected, confirmed,
// completed, cancelled, updated) is informational and needs no decision.
const PENDING_DECISION = /placed an order|requested an order|new order|awaiting|needs? your approval|approval required/i;
const ALREADY_DECIDED = /approved|rejected|confirmed|completed|cancelled|updated|قبول|رفض|تأكيد/i;

export function customerOrderId(n: AppNotification): string | null {
  const t = n.target;
  const isOrder = n.category === 'customer_order'
    && (t.entityType === 'customer_order' || t.targetEntityType === 'customer_order' || !t.entityType);
  return isOrder ? (t.entityId ?? t.targetEntityId ?? null) : null;
}

export function needsCustomerAction(n: AppNotification): boolean {
  if (n.read_at || !customerOrderId(n)) return false;
  const text = `${n.title ?? ''} ${n.body ?? ''}`;
  return PENDING_DECISION.test(text) && !ALREADY_DECIDED.test(n.title ?? '');
}

export function customerTabOf(n: AppNotification): Exclude<CustomerNotifTab, 'all' | 'action'> {
  if (MESSAGE_CATEGORIES.has(n.category)) return 'message';
  if (ORDER_CATEGORIES.has(n.category)) return 'order';
  return 'other';
}

export function matchesCustomerTab(n: AppNotification, tab: CustomerNotifTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'action') return needsCustomerAction(n);
  return customerTabOf(n) === tab;
}

// ─── Routing ───

// The shared router falls back to merchant routes (/trading/orders, /chat)
// for notifications without a stored target; a customer must stay in /c/*.
export function customerNotificationTarget(n: AppNotification): { pathname: string; search?: string } {
  const target = buildNotificationNavigationTarget(n);
  if (target.pathname.startsWith('/c/')) return { pathname: target.pathname, search: target.search };
  const tab = customerTabOf(n);
  if (tab === 'message') return { pathname: '/c/chat' };
  if (tab === 'order') return { pathname: '/c/orders' };
  if (/payment|loan|cash/i.test(n.title ?? '')) return { pathname: '/c/wallet' };
  return { pathname: '/c/notifications' };
}

// ─── Localisation of server-written English titles ───

export function localizeNotifTitle(title: string | null | undefined, lang: string): string {
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

export function localizeNotifBody(body: string | null | undefined, lang: string): string {
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

// ─── Visual identity per kind ───

interface Look { Icon: LucideIcon; chip: string; }

function lookFor(n: AppNotification, actionNeeded: boolean): Look {
  if (actionNeeded) return { Icon: ShoppingBag, chip: 'bg-amber-500/20 text-amber-500' };
  if (/payment|loan|cash/i.test(n.title ?? '')) return { Icon: Wallet, chip: 'bg-violet-500/15 text-violet-400' };
  switch (customerTabOf(n)) {
    case 'message': return { Icon: MessageSquare, chip: 'bg-sky-500/15 text-sky-400' };
    case 'order':   return { Icon: ShoppingBag, chip: 'bg-emerald-500/15 text-emerald-400' };
    default:        return { Icon: Bell, chip: 'bg-muted text-muted-foreground' };
  }
}

// ─── Approve / reject controls ───

function DecisionButtons({ orderId, lang, onDone }: { orderId: string; lang: 'en' | 'ar'; onDone: () => void }) {
  const L = (en: string, arText: string) => (lang === 'ar' ? arText : en);
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);

  const respond = useMutation({
    mutationFn: async (vars: { action: 'approve' | 'reject'; reason?: string }) => {
      await respondSharedOrder({ orderId, actorRole: 'customer', action: vars.action, reason: vars.reason });
      return vars.action;
    },
    onSuccess: (action) => {
      toast.success(action === 'approve' ? L('Order approved', 'تمت الموافقة على الطلب') : L('Order rejected', 'تم رفض الطلب'));
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['c-orders'] });
      setOutcome(action === 'approve' ? 'approved' : 'rejected');
      onDone();
    },
    onError: (error: { message?: string }) => {
      toast.error(error?.message ?? L('Could not update the order', 'تعذر تحديث الطلب'));
    },
  });

  if (outcome) {
    return (
      <p className={cn('mt-3 text-sm font-bold', outcome === 'approved' ? 'text-emerald-500' : 'text-destructive')}>
        {outcome === 'approved' ? L('You approved this order ✓', 'وافقت على هذا الطلب ✓') : L('You rejected this order', 'رفضت هذا الطلب')}
      </p>
    );
  }

  if (rejecting) {
    return (
      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={L('Why are you rejecting this order?', 'ما سبب رفض الطلب؟')}
          className="min-h-[72px] w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="h-10 flex-1 text-sm font-bold"
            disabled={respond.isPending || !reason.trim()}
            onClick={() => respond.mutate({ action: 'reject', reason: reason.trim() })}
          >
            {L('Confirm reject', 'تأكيد الرفض')}
          </Button>
          <Button variant="ghost" className="h-10 text-sm" onClick={() => { setRejecting(false); setReason(''); }}>
            {L('Back', 'رجوع')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        className="h-10 flex-1 gap-1.5 bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
        disabled={respond.isPending}
        onClick={() => respond.mutate({ action: 'approve' })}
      >
        <Check className="h-4 w-4" />{L('Approve', 'موافقة')}
      </Button>
      <Button
        variant="outline"
        className="h-10 flex-1 gap-1.5 border-destructive text-sm font-bold text-destructive hover:bg-destructive/10"
        disabled={respond.isPending}
        onClick={() => setRejecting(true)}
      >
        <X className="h-4 w-4" />{L('Reject', 'رفض')}
      </Button>
    </div>
  );
}

// ─── Card ───

interface CardProps {
  n: SmartNotification;
  lang: 'en' | 'ar';
  onOpen: (n: SmartNotification) => void;
  onDecided: (ids: string[]) => void;
}

export function CustomerNotificationCard({ n, lang, onOpen, onDecided }: CardProps) {
  const L = (en: string, arText: string) => (lang === 'ar' ? arText : en);
  const unread = !n.read_at;
  const actionNeeded = needsCustomerAction(n);
  const orderId = customerOrderId(n);
  const { Icon, chip } = lookFor(n, actionNeeded);
  const body = localizeNotifBody(n.body, lang);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(n); }}
      className={cn(
        'relative cursor-pointer border-b border-border/50 px-4 py-3.5 transition-colors last:border-0 hover:bg-muted/40',
        actionNeeded && 'bg-amber-500/[0.07]',
        !actionNeeded && unread && 'bg-primary/[0.05]',
      )}
    >
      {unread && (
        <span className={cn('absolute inset-y-0 start-0 w-1', actionNeeded ? 'bg-amber-500' : 'bg-primary')} />
      )}
      <div className="flex gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', chip)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('text-[15px] leading-snug', unread ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}>
              {localizeNotifTitle(n.title, lang)}
              {n.groupCount && n.groupCount > 1 && (
                <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">×{n.groupCount}</span>
              )}
            </p>
            {unread && !actionNeeded && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
          </div>
          {body && <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground">{body}</p>}
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: lang === 'ar' ? arLocale : undefined })}</span>
            {actionNeeded && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-black">
                {L('Needs your decision', 'يحتاج قرارك')}
              </span>
            )}
          </div>

          {actionNeeded && orderId && (
            <DecisionButtons
              orderId={orderId}
              lang={lang}
              onDone={() => onDecided(n.groupIds?.length ? n.groupIds : [n.id])}
            />
          )}

          {!actionNeeded && (
            <p className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-primary">
              {orderId ? L('View order', 'عرض الطلب') : L('Open', 'فتح')}
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
