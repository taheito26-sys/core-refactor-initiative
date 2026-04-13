/**
 * ActivityCenter — top-nav notification dropdown
 *
 * Features:
 *  • Real-time badge via Supabase channel (live green dot)
 *  • Category filter tabs with per-category unread counts
 *  • Smart grouping (dedup + 30-min collapse)
 *  • Per-notification icon based on kind
 *  • Inline action buttons:
 *      - approval   → Approve / Reject deal or settlement
 *      - invite     → Accept / Decline invite
 *      - agreement  → Approve / Reject profit-share agreement
 *      - profile    → Approve / Reject admin user (with reason prompt)
 *  • Empty state per category
 *  • Click-row navigates with deep-link + marks read
 *  • RTL-aware layout
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Check, X, MessageSquare, ShoppingBag,
  Users, Shield, Settings2, FileText, RefreshCw, ChevronRight,
  Wifi, WifiOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
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
import { useUpdateAgreementStatus } from '@/hooks/useProfitShareAgreements';
import {
  useInlineDealApprove, useInlineDealReject,
  useInlineInviteAccept, useInlineInviteReject,
  useInlineProfileApprove, useInlineProfileReject,
  useInlineSettlementApprove, useInlineSettlementReject,
  resolveNotificationActionKind,
} from '@/hooks/useNotificationActions';
import { toast } from 'sonner';

// ─── Category config ────────────────────────────────────────────────────────

interface CatConfig {
  id: NotificationCategoryGroup;
  labelKey: string;
  Icon: React.ElementType;
  color: string;
}

const CAT_CONFIG: CatConfig[] = [
  { id: 'all',      labelKey: 'notifCatAll',      Icon: Bell,         color: 'text-muted-foreground' },
  { id: 'approval', labelKey: 'notifCatApproval',  Icon: Shield,       color: 'text-amber-500'        },
  { id: 'deal',     labelKey: 'notifCatDeal',      Icon: FileText,     color: 'text-blue-500'         },
  { id: 'order',    labelKey: 'notifCatOrder',     Icon: ShoppingBag,  color: 'text-emerald-500'      },
  { id: 'invite',   labelKey: 'notifCatInvite',    Icon: Users,        color: 'text-violet-500'       },
  { id: 'message',  labelKey: 'notifCatMessage',   Icon: MessageSquare,color: 'text-sky-500'          },
  { id: 'system',   labelKey: 'notifCatSystem',    Icon: Settings2,    color: 'text-muted-foreground' },
];

function iconForCategory(cat: string): React.ElementType {
  switch (normalizeNotificationCategory(cat)) {
    case 'approval':  return Shield;
    case 'deal':      return FileText;
    case 'order':     return ShoppingBag;
    case 'invite':    return Users;
    case 'message':   return MessageSquare;
    default:          return Bell;
  }
}

function colorForCategory(cat: string): string {
  switch (normalizeNotificationCategory(cat)) {
    case 'approval':  return 'text-amber-500';
    case 'deal':      return 'text-blue-500';
    case 'order':     return 'text-emerald-500';
    case 'invite':    return 'text-violet-500';
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
  const kind = resolveNotificationActionKind(n.category, n.target.entityType);

  // Agreement action (handled here too)
  const isAgreement = n.category === 'agreement';
  const updateAgreement = useUpdateAgreementStatus();

  // Deal
  const dealApprove  = useInlineDealApprove();
  const dealReject   = useInlineDealReject();

  // Invite
  const inviteAccept = useInlineInviteAccept();
  const inviteReject = useInlineInviteReject();

  // Profile (admin)
  const profileApprove = useInlineProfileApprove();
  const profileReject  = useInlineProfileReject();
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason]         = useState('');

  // Settlement
  const settlApprove = useInlineSettlementApprove();
  const settlReject  = useInlineSettlementReject();

  const entityId = n.target.entityId ?? null;

  if (!entityId && !isAgreement) return null;

  // ── Busy state ────────────────────────────────────────────────────────────
  const busy =
    dealApprove.isPending || dealReject.isPending ||
    inviteAccept.isPending || inviteReject.isPending ||
    profileApprove.isPending || profileReject.isPending ||
    settlApprove.isPending || settlReject.isPending ||
    updateAgreement.isPending;

  const ids = n.groupIds?.length ? n.groupIds : [n.id];

  // ── Agreement ─────────────────────────────────────────────────────────────
  if (isAgreement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agreementId = (n.target as any).targetEntityId ?? entityId;
    if (!agreementId) return null;
    return (
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="default" className="h-6 text-[10px] px-2.5 gap-1" disabled={busy}
          onClick={async () => {
            try {
              await updateAgreement.mutateAsync({ agreementId, status: 'approved' });
              onDone(ids);
              toast.success(t('agreementApprovedSuccess'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <Check className="h-3 w-3" />{t('approve')}
        </Button>
        <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2.5 gap-1" disabled={busy}
          onClick={async () => {
            try {
              await updateAgreement.mutateAsync({ agreementId, status: 'rejected' });
              onDone(ids);
              toast.success(t('agreementRejectedSuccess'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <X className="h-3 w-3" />{t('reject')}
        </Button>
      </div>
    );
  }

  // ── Deal approval ─────────────────────────────────────────────────────────
  if (kind === 'deal_approval') {
    return (
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="default" className="h-6 text-[10px] px-2.5 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={busy}
          onClick={async () => {
            try {
              await dealApprove.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('tradeApproved'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <Check className="h-3 w-3" />{t('approve')}
        </Button>
        <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2.5 gap-1" disabled={busy}
          onClick={async () => {
            try {
              await dealReject.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('tradeRejected'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <X className="h-3 w-3" />{t('reject')}
        </Button>
        <span className="ml-auto text-[9px] text-amber-500 font-semibold self-center">{t('actionNeeded')}</span>
      </div>
    );
  }

  // ── Invite ────────────────────────────────────────────────────────────────
  if (kind === 'invite_incoming') {
    return (
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="default" className="h-6 text-[10px] px-2.5 gap-1 bg-violet-600 hover:bg-violet-700" disabled={busy}
          onClick={async () => {
            try {
              await inviteAccept.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('inviteAccepted'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <Check className="h-3 w-3" />{t('accept')}
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2.5 gap-1 border-destructive text-destructive hover:bg-destructive/10" disabled={busy}
          onClick={async () => {
            try {
              await inviteReject.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('inviteRejected'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <X className="h-3 w-3" />{t('decline')}
        </Button>
      </div>
    );
  }

  // ── Profile approval (admin) ──────────────────────────────────────────────
  if (kind === 'profile_approval') {
    if (showRejectReason) {
      return (
        <div className="mt-2 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Textarea
            placeholder={t('rejectReasonPlaceholder')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="text-xs min-h-[56px] resize-none"
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2.5" disabled={busy || !rejectReason.trim()}
              onClick={async () => {
                try {
                  await profileReject.mutateAsync({ profileUserId: entityId!, reason: rejectReason.trim() });
                  onDone(ids);
                  toast.success(t('rejected'));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (e: any) { toast.error(e.message); }
              }}>
              {t('confirmReject')}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setShowRejectReason(false); setRejectReason(''); }}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="default" className="h-6 text-[10px] px-2.5 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={busy}
          onClick={async () => {
            try {
              await profileApprove.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('tradeApproved'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <Check className="h-3 w-3" />{t('approve')}
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2.5 gap-1 border-destructive text-destructive hover:bg-destructive/10" disabled={busy}
          onClick={() => setShowRejectReason(true)}>
          <X className="h-3 w-3" />{t('reject')}
        </Button>
      </div>
    );
  }

  // ── Settlement ────────────────────────────────────────────────────────────
  if (kind === 'settlement_approval') {
    return (
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="default" className="h-6 text-[10px] px-2.5 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={busy}
          onClick={async () => {
            try {
              await settlApprove.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('settlementApproved'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <Check className="h-3 w-3" />{t('approve')}
        </Button>
        <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2.5 gap-1" disabled={busy}
          onClick={async () => {
            try {
              await settlReject.mutateAsync(entityId!);
              onDone(ids);
              toast.success(t('rejectedNoMutation'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { toast.error(e.message); }
          }}>
          <X className="h-3 w-3" />{t('reject')}
        </Button>
        <span className="ml-auto text-[9px] text-amber-500 font-semibold self-center">{t('actionNeeded')}</span>
      </div>
    );
  }

  return null;
}

// ─── Notification row ────────────────────────────────────────────────────────

interface RowProps {
  n: SmartNotification;
  onNavigate: (n: SmartNotification) => void;
  onActionDone: (ids: string[]) => void;
  t: ReturnType<typeof useT>;
}

function NotificationRow({ n, onNavigate, onActionDone, t }: RowProps) {
  const Icon  = iconForCategory(n.category);
  const color = colorForCategory(n.category);
  const isUnread = !n.read_at;

  const kind = resolveNotificationActionKind(n.category, n.target.entityType);
  const isAgreement = n.category === 'agreement';
  const hasAction = (isUnread && (kind !== null || isAgreement));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(n)}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate(n)}
      className={cn(
        'group w-full text-left px-3 py-2.5 border-b last:border-b-0 cursor-pointer',
        'hover:bg-muted/50 transition-colors',
        isUnread && 'bg-primary/[0.04]',
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Category icon */}
        <div className={cn('mt-0.5 shrink-0 rounded-full p-1.5',
          isUnread ? 'bg-primary/10' : 'bg-muted')}>
          <Icon className={cn('h-3.5 w-3.5', isUnread ? color : 'text-muted-foreground')} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-baseline gap-1 justify-between">
            <span className={cn('text-xs font-semibold truncate', isUnread ? 'text-foreground' : 'text-muted-foreground')}>
              {n.title}
              {n.groupCount && n.groupCount > 1 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{n.groupCount}</span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </span>
          </div>

          {/* Body */}
          {n.body && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
          )}

          {/* Inline action buttons */}
          {hasAction && (
            <InlineActionArea n={n} onDone={onActionDone} t={t} />
          )}

          {/* Navigate hint for non-action items */}
          {!hasAction && (
            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{t('viewDetails')}</span>
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
    all:        t('noNotifications'),
    approval:   t('noApprovals'),
    deal:       t('noNotifications'),
    order:      t('noNotifications'),
    invite:     t('acceptInviteToStart'),
    agreement:  t('noNotifications'),
    message:    t('noNotifications'),
    settlement: t('noNotifications'),
    system:     t('noNotifications'),
  };
  const cfg = CAT_CONFIG.find(c => c.id === category) ?? CAT_CONFIG[0];
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

const CATEGORIES: NotificationCategoryGroup[] = ['all', 'approval', 'deal', 'order', 'invite', 'message', 'system'];

export default function ActivityCenter() {
  const [open, setOpen]                       = useState(false);
  const [activeCategory, setActiveCategory]   = useState<NotificationCategoryGroup>('all');
  const navigate                              = useNavigate();
  const t                                     = useT();

  const { data: notifications, unreadCount, unreadByCategory, isLoading, hasLiveNotificationChannel } =
    useNotifications();

  const markRead      = useMarkNotificationRead();
  const markManyRead  = useMarkNotificationsRead();
  const markAllRead   = useMarkAllRead();
  const markCatRead   = useMarkCategoryRead();

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
            <strong className="text-sm">{t('activityCenter')}</strong>
            {hasLiveNotificationChannel ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                <Wifi className="h-3 w-3" />
                {t('liveLabel')}
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
                {t('clearAll')}
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2"
              title={t('markAllRead')}
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="px-2 pt-2 pb-1 flex gap-1 flex-wrap border-b">
          {CATEGORIES.map((cat) => {
            const cfg   = CAT_CONFIG.find(c => c.id === cat)!;
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
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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
              {t('loading')}
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
          <span>{(notifications ?? []).length} {t('notifTotalCount')}</span>
          <button
            className="text-[10px] hover:text-foreground transition-colors"
            onClick={() => { setOpen(false); navigate('/notifications'); }}
          >
            {t('viewAllNotifications')} →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
