import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Handshake, Mail, ShieldCheck, Package,
  Zap, Filter, Clock, ArrowRight, Sparkles, Circle, MessageCircle,
} from 'lucide-react';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllRead,
  notificationRoute,
  type Notification,
} from '@/hooks/useNotifications';
import { useT } from '@/lib/i18n';

// ─── Category Config ────────────────────────────────────────────────
type CategoryKey = 'all' | 'deal' | 'order' | 'invite' | 'approval' | 'message' | 'system';

const CATEGORIES: { key: CategoryKey; labelKey: string; icon: React.ComponentType<{ className?: string }>; activeBg: string; activeText: string }[] = [
  { key: 'all', labelKey: 'notifAllActivity', icon: Sparkles, activeBg: 'bg-primary', activeText: 'text-primary-foreground' },
  { key: 'deal', labelKey: 'notifDeals', icon: Handshake, activeBg: 'bg-accent', activeText: 'text-accent-foreground' },
  { key: 'order', labelKey: 'orders', icon: Package, activeBg: 'bg-warning', activeText: 'text-warning-foreground' },
  { key: 'invite', labelKey: 'notifInvites', icon: Mail, activeBg: 'bg-[hsl(260,60%,50%)]', activeText: 'text-white' },
  { key: 'approval', labelKey: 'notifApprovals', icon: ShieldCheck, activeBg: 'bg-success', activeText: 'text-success-foreground' },
  { key: 'message', labelKey: 'notifMessages', icon: MessageCircle, activeBg: 'bg-[hsl(200,70%,50%)]', activeText: 'text-white' },
  { key: 'system', labelKey: 'notifSystem', icon: Zap, activeBg: 'bg-muted-foreground', activeText: 'text-background' },
];

const categoryMeta: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  deal: { icon: Handshake, color: 'text-accent', bg: 'bg-accent/10' },
  order: { icon: Package, color: 'text-warning', bg: 'bg-warning/10' },
  invite: { icon: Mail, color: 'text-primary', bg: 'bg-primary/10' },
  network: { icon: Mail, color: 'text-primary', bg: 'bg-primary/10' },
  approval: { icon: ShieldCheck, color: 'text-success', bg: 'bg-success/10' },
  merchant: { icon: Handshake, color: 'text-accent', bg: 'bg-accent/10' },
  message: { icon: MessageCircle, color: 'text-[hsl(200,70%,50%)]', bg: 'bg-[hsl(200,70%,50%)]/10' },
  system: { icon: Zap, color: 'text-muted-foreground', bg: 'bg-muted' },
};

// ─── Group by day ───────────────────────────────────────────────────
function groupByDay(items: Notification[], t: ReturnType<typeof useT>): { label: string; items: Notification[] }[] {
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const d = new Date(n.created_at);
    let label: string;
    if (isToday(d)) label = t('notifToday');
    else if (isYesterday(d)) label = t('notifYesterday');
    else label = format(d, 'MMM d, yyyy');
    const existing = groups.get(label) || [];
    existing.push(n);
    groups.set(label, existing);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

// ─── Single Notification Row ────────────────────────────────────────
function NotificationRow({
  n,
  onNavigate,
}: {
  n: Notification;
  onNavigate: (n: Notification) => void;
}) {
  const meta = categoryMeta[n.category] ?? categoryMeta.system;
  const Icon = meta.icon;
  const isUnread = !n.read_at;

  return (
    <button
      onClick={() => onNavigate(n)}
      className={cn(
        'group w-full flex items-start gap-3 px-3 py-2.5 text-left transition-all rounded-lg relative',
        isUnread
          ? 'bg-primary/[0.04] hover:bg-primary/[0.08]'
          : 'hover:bg-muted/50'
      )}
    >
      {isUnread && (
        <span className="absolute top-3 left-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
      )}

      <div className={cn(
        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105',
        meta.bg
      )}>
        <Icon className={cn('h-4 w-4', meta.color)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            'text-[12px] leading-tight truncate',
            isUnread ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
          )}>
            {n.title}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
        {n.body && (
          <p className="text-[11px] text-muted-foreground/80 leading-snug mt-0.5 line-clamp-2">
            {n.body}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Clock className="h-2.5 w-2.5 text-muted-foreground/50" />
          <span className="text-[9px] text-muted-foreground/60 font-medium">
            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
          </span>
          <span className={cn(
            'text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
            meta.bg, meta.color
          )}>
            {n.category}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────
export default function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const navigate = useNavigate();
  const t = useT();
  const { data: notifications, isLoading, unreadCount } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const filtered = useMemo(() => {
    if (!notifications) return [];
    if (activeCategory === 'all') return notifications;
    return notifications.filter(n => {
      if (activeCategory === 'invite') return n.category === 'invite' || n.category === 'network';
      if (activeCategory === 'deal') return n.category === 'deal' || n.category === 'merchant';
      if (activeCategory === 'message') return n.category === 'message';
      return n.category === activeCategory;
    });
  }, [notifications, activeCategory]);

  const grouped = useMemo(() => groupByDay(filtered, t), [filtered, t]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of (notifications ?? [])) {
      if (!n.read_at) {
        const cat = (n.category === 'network' || n.category === 'invite') ? 'invite'
          : (n.category === 'merchant' || n.category === 'deal') ? 'deal'
          : n.category === 'message' ? 'message'
          : n.category;
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [notifications]);

  const handleNavigate = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    setOpen(false);
    navigate(notificationRoute(n));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground transition-all hover:text-foreground group">
          <Bell className={cn(
            'h-5 w-5 transition-transform',
            unreadCount > 0 && 'group-hover:animate-[wiggle_0.3s_ease-in-out]'
          )} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-black text-destructive-foreground shadow-lg shadow-destructive/30 animate-in zoom-in-50">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] p-0 shadow-2xl border-border/50 rounded-xl overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="relative bg-gradient-to-r from-primary/5 via-transparent to-accent/5 px-4 py-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-[13px] font-bold text-foreground leading-tight">{t('activityCenter')}</h3>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {unreadCount > 0
                    ? `${unreadCount} ${unreadCount > 1 ? t('unreadAlertsPlural') : t('unreadAlerts')}`
                    : t('allCaughtUpShort')}
                </p>
              </div>
            </div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] text-muted-foreground hover:text-foreground gap-1 rounded-lg"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3 w-3" />
                {t('clearAll')}
              </Button>
            )}
          </div>

          {/* ── Category pills ── */}
          <div className="flex flex-wrap gap-1 mt-2.5">
            {CATEGORIES.map(cat => {
              const count = cat.key === 'all' ? unreadCount : (categoryCounts[cat.key] || 0);
              const isActive = activeCategory === cat.key;
              const CatIcon = cat.icon;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all whitespace-nowrap',
                    isActive
                      ? cn(cat.activeBg, cat.activeText, 'shadow-sm')
                      : 'bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <CatIcon className="h-3 w-3" />
                  {t(cat.labelKey as any)}
                  {count > 0 && (
                    <span className={cn(
                      'ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-black',
                      isActive
                        ? 'bg-white/20'
                        : 'bg-destructive/15 text-destructive'
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Timeline ── */}
        <ScrollArea className="max-h-[420px]">
          {isLoading ? (
            <div className="flex flex-col items-center py-14 gap-3">
              <div className="relative">
                <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              </div>
              <p className="text-[11px] text-muted-foreground font-medium">{t('loadingActivity')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-14 gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                {activeCategory === 'all' ? (
                  <Bell className="h-6 w-6 text-muted-foreground/50" />
                ) : (
                  (() => {
                    const CatIcon = CATEGORIES.find(c => c.key === activeCategory)?.icon ?? Bell;
                    return <CatIcon className="h-6 w-6 text-muted-foreground/50" />;
                  })()
                )}
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-muted-foreground">
                  {activeCategory === 'all' ? t('noActivityShort') : t('noCategoryNotif')}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {activeCategory === 'all'
                    ? t('startDealOrInvite')
                    : t('checkBackLater')}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-1.5">
              {grouped.map(group => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-background/95 backdrop-blur-sm">
                    <div className="h-px flex-1 bg-border/50" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">
                      {group.label}
                    </span>
                    <div className="h-px flex-1 bg-border/50" />
                  </div>
                  <div className="px-1.5 space-y-0.5">
                    {group.items.map(n => (
                      <NotificationRow key={n.id} n={n} onNavigate={handleNavigate} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* ── Footer with live indicator ── */}
        <div className="border-t border-border/50 px-4 py-2 bg-gradient-to-r from-transparent via-muted/30 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
              </span>
              <span className="text-[9px] font-semibold text-success uppercase tracking-wider">{t('liveLabel')}</span>
            </div>
            <span className="text-[9px] text-muted-foreground/50">
              {(notifications ?? []).length} {t('totalDot')} · {t('realTimeEnabled')}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
