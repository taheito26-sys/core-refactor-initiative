import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Handshake, Mail, ShieldCheck, Package,
  Zap, Clock, ArrowRight, Sparkles, Search, Trash2, Filter,
  ChevronDown, X,
} from 'lucide-react';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import { Button } from '@/components/ui/button';
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
type CategoryKey = 'all' | 'deal' | 'order' | 'invite' | 'approval' | 'system';

const CATEGORY_KEYS: { key: CategoryKey; labelKey: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }[] = [
  { key: 'all', labelKey: 'notifAllActivity', icon: Sparkles, color: 'text-primary', bg: 'bg-primary/10' },
  { key: 'deal', labelKey: 'notifDeals', icon: Handshake, color: 'text-accent', bg: 'bg-accent/10' },
  { key: 'order', labelKey: 'orders', icon: Package, color: 'text-warning', bg: 'bg-warning/10' },
  { key: 'invite', labelKey: 'notifInvites', icon: Mail, color: 'text-primary', bg: 'bg-primary/10' },
  { key: 'approval', labelKey: 'notifApprovals', icon: ShieldCheck, color: 'text-success', bg: 'bg-success/10' },
  { key: 'system', labelKey: 'notifSystem', icon: Zap, color: 'text-muted-foreground', bg: 'bg-muted' },
];

const categoryMeta: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string; gradient: string }> = {
  deal: { icon: Handshake, color: 'text-accent', bg: 'bg-accent/10', gradient: 'from-accent/20 to-transparent' },
  order: { icon: Package, color: 'text-warning', bg: 'bg-warning/10', gradient: 'from-warning/20 to-transparent' },
  invite: { icon: Mail, color: 'text-primary', bg: 'bg-primary/10', gradient: 'from-primary/20 to-transparent' },
  network: { icon: Mail, color: 'text-primary', bg: 'bg-primary/10', gradient: 'from-primary/20 to-transparent' },
  approval: { icon: ShieldCheck, color: 'text-success', bg: 'bg-success/10', gradient: 'from-success/20 to-transparent' },
  merchant: { icon: Handshake, color: 'text-accent', bg: 'bg-accent/10', gradient: 'from-accent/20 to-transparent' },
  system: { icon: Zap, color: 'text-muted-foreground', bg: 'bg-muted', gradient: 'from-muted to-transparent' },
};

// ─── Group by day ───────────────────────────────────────────────────
function groupByDay(items: Notification[], t: any): { label: string; items: Notification[] }[] {
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const d = new Date(n.created_at);
    let label: string;
    if (isToday(d)) label = t('notifToday');
    else if (isYesterday(d)) label = t('notifYesterday');
    else label = format(d, 'EEEE, MMM d');
    const existing = groups.get(label) || [];
    existing.push(n);
    groups.set(label, existing);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function normalizeCategory(cat: string): CategoryKey {
  if (cat === 'network' || cat === 'invite') return 'invite';
  if (cat === 'merchant' || cat === 'deal') return 'deal';
  if (CATEGORY_KEYS.some(c => c.key === cat)) return cat as CategoryKey;
  return 'system';
}

// ─── Notification Card ──────────────────────────────────────────────
function NotificationCard({
  n,
  onNavigate,
  onMarkRead,
}: {
  n: Notification;
  onNavigate: (n: Notification) => void;
  onMarkRead: (id: string) => void;
}) {
  const meta = categoryMeta[n.category] ?? categoryMeta.system;
  const Icon = meta.icon;
  const isUnread = !n.read_at;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-4 p-4 rounded-xl transition-all cursor-pointer border',
        isUnread
          ? 'bg-card border-primary/15 shadow-sm hover:shadow-md hover:border-primary/25'
          : 'bg-card/50 border-border/50 hover:bg-card hover:border-border'
      )}
      onClick={() => onNavigate(n)}
    >
      {/* Timeline connector dot */}
      {isUnread && (
        <div className="absolute -left-[29px] top-5 hidden lg:flex">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-40" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary border-2 border-background" />
          </span>
        </div>
      )}
      {!isUnread && (
        <div className="absolute -left-[27px] top-6 hidden lg:flex h-2 w-2 rounded-full bg-border" />
      )}

      {/* Category icon */}
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110',
        meta.bg
      )}>
        <Icon className={cn('h-5 w-5', meta.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isUnread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
              <h4 className={cn(
                'text-sm leading-tight truncate',
                isUnread ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
              )}>
                {n.title}
              </h4>
            </div>
            {n.body && (
              <p className="text-[12px] text-muted-foreground/70 leading-relaxed mt-1 line-clamp-2">
                {n.body}
              </p>
            )}
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/30 mt-0.5 opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-0.5 shrink-0" />
        </div>

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50 font-medium">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </span>
          </div>
          <span className={cn(
            'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md',
            meta.bg, meta.color
          )}>
            {n.category}
          </span>
          {isUnread && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkRead(n.id); }}
              className="ml-auto text-[10px] text-muted-foreground/50 hover:text-foreground font-medium transition-colors"
            >
              Mark read
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function NotificationsPage() {
  const navigate = useNavigate();
  const { data: notifications, isLoading, unreadCount } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const filtered = useMemo(() => {
    let items = notifications ?? [];

    if (activeCategory !== 'all') {
      items = items.filter(n => normalizeCategory(n.category) === activeCategory);
    }

    if (showUnreadOnly) {
      items = items.filter(n => !n.read_at);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.body ?? '').toLowerCase().includes(q)
      );
    }

    return items;
  }, [notifications, activeCategory, showUnreadOnly, searchQuery]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of (notifications ?? [])) {
      if (!n.read_at) {
        const cat = normalizeCategory(n.category);
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [notifications]);

  const handleNavigate = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    navigate(notificationRoute(n));
  };

  return (
    <div className="min-h-full bg-background">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-accent/[0.03]" />
        <div className="relative px-4 sm:px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 shadow-sm">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-black text-foreground tracking-tight">Activity Center</h1>
                <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                  </span>
                  Real-time updates · {(notifications ?? []).length} total alerts
                </p>
              </div>
            </div>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-[11px] h-8 rounded-lg"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read ({unreadCount})
              </Button>
            )}
          </div>

          {/* ── Stats bar ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[
              { label: 'Total', value: (notifications ?? []).length, icon: Bell, color: 'text-foreground' },
              { label: 'Unread', value: unreadCount, icon: Sparkles, color: unreadCount > 0 ? 'text-destructive' : 'text-muted-foreground' },
              { label: 'Deals', value: (notifications ?? []).filter(n => normalizeCategory(n.category) === 'deal').length, icon: Handshake, color: 'text-accent' },
              { label: 'This Week', value: (notifications ?? []).filter(n => Date.now() - new Date(n.created_at).getTime() < 7 * 86400000).length, icon: Clock, color: 'text-primary' },
            ].map(stat => (
              <div key={stat.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-card/80 border border-border/50">
                <stat.icon className={cn('h-4 w-4', stat.color)} />
                <div>
                  <div className={cn('text-lg font-black leading-none', stat.color)}>{stat.value}</div>
                  <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2 rounded-lg border border-border/50 bg-card text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Unread toggle */}
          <button
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-semibold transition-all whitespace-nowrap',
              showUnreadOnly
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            Unread only
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-1">
          {CATEGORIES.map(cat => {
            const count = cat.key === 'all' ? unreadCount : (categoryCounts[cat.key] || 0);
            const isActive = activeCategory === cat.key;
            const CatIcon = cat.icon;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                    : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <CatIcon className="h-3.5 w-3.5" />
                {cat.label}
                {count > 0 && (
                  <span className={cn(
                    'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-black',
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-destructive/10 text-destructive'
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
      <div className="px-4 sm:px-6 pb-10">
        {isLoading ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <div className="h-12 w-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground font-medium">Loading activity feed...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50">
              {activeCategory === 'all' ? (
                <Bell className="h-8 w-8 text-muted-foreground/30" />
              ) : (
                (() => {
                  const CatIcon = CATEGORIES.find(c => c.key === activeCategory)?.icon ?? Bell;
                  return <CatIcon className="h-8 w-8 text-muted-foreground/30" />;
                })()
              )}
            </div>
            <div className="text-center">
              <h3 className="text-sm font-bold text-muted-foreground">
                {searchQuery ? 'No results found' : showUnreadOnly ? 'No unread notifications' : 'No activity yet'}
              </h3>
              <p className="text-[12px] text-muted-foreground/60 mt-1 max-w-[260px]">
                {searchQuery
                  ? `No notifications match "${searchQuery}"`
                  : showUnreadOnly
                  ? 'You\'re all caught up! Toggle off the filter to see all activity.'
                  : 'Create a deal or send an invite to start seeing activity here.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-0 top-0 bottom-0 w-px bg-border/50 hidden lg:block" style={{ left: '15px' }} />

            <div className="space-y-6 lg:pl-10">
              {grouped.map(group => (
                <div key={group.label}>
                  {/* Day header */}
                  <div className="flex items-center gap-3 mb-3 relative">
                    <div className="absolute -left-10 hidden lg:flex h-7 w-7 items-center justify-center rounded-full bg-card border-2 border-border">
                      <span className="text-[9px] font-black text-muted-foreground">
                        {group.label === 'Today' ? '🔥' : group.label === 'Yesterday' ? '📅' : '📆'}
                      </span>
                    </div>
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/60">
                      {group.label}
                    </h3>
                    <div className="h-px flex-1 bg-border/30" />
                    <span className="text-[10px] font-semibold text-muted-foreground/40">
                      {group.items.length} item{group.items.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2">
                    {group.items.map(n => (
                      <NotificationCard
                        key={n.id}
                        n={n}
                        onNavigate={handleNavigate}
                        onMarkRead={(id) => markRead.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
