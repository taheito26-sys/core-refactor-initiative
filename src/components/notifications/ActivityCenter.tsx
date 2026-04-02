import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Check, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useMarkAllRead, useMarkCategoryRead, useMarkNotificationRead, useMarkNotificationsRead, useNotifications } from '@/hooks/useNotifications';
import { smartGroupNotifications, type SmartNotification } from '@/lib/notification-grouping';
import { handleNotificationClick } from '@/lib/notification-router';
import { normalizeNotificationCategory, type NotificationCategoryGroup } from '@/types/notifications';
import { useUpdateAgreementStatus } from '@/hooks/useProfitShareAgreements';
import { toast } from 'sonner';

const categories: NotificationCategoryGroup[] = ['all', 'deal', 'order', 'invite', 'approval', 'agreement', 'message', 'system'];

export default function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<NotificationCategoryGroup>('all');
  const navigate = useNavigate();
  const t = useT();

  const { data: notifications, unreadCount, unreadByCategory, isLoading, hasLiveNotificationChannel } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markManyRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllRead();
  const markCategoryRead = useMarkCategoryRead();
  const updateStatus = useUpdateAgreementStatus();
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!notifications) return [];
    if (activeCategory === 'all') return notifications;
    return notifications.filter((n) => normalizeNotificationCategory(n.category) === activeCategory);
  }, [notifications, activeCategory]);

  const grouped = useMemo(() => smartGroupNotifications(filtered), [filtered]);

  const onNavigate = async (n: SmartNotification) => {
    const ids = n.groupIds?.length ? n.groupIds : (!n.read_at ? [n.id] : []);
    if (ids.length > 1) await markManyRead.mutateAsync(ids);
    else if (ids.length === 1) await markRead.mutateAsync(ids[0]);
    setOpen(false);
    handleNotificationClick(n, navigate);
  };

  const handleAgreementAction = async (n: SmartNotification, status: 'approved' | 'rejected', e: React.MouseEvent) => {
    e.stopPropagation();
    const agreementId = n.target?.targetEntityId || n.target?.entityId;
    if (!agreementId) return;

    setActioningIds(prev => new Set(prev).add(n.id));
    try {
      await updateStatus.mutateAsync({ agreementId, status });
      // Mark notification as read
      if (!n.read_at) await markRead.mutateAsync(n.id);
      toast.success(status === 'approved' ? t('agreementApprovedSuccess') : t('agreementRejectedSuccess'));
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    } finally {
      setActioningIds(prev => { const next = new Set(prev); next.delete(n.id); return next; });
    }
  };

  const isAgreementNotification = (n: SmartNotification) =>
    n.category === 'agreement' && (n.target?.targetEntityType === 'agreement' || n.target?.entityType === 'agreement');

  return (
    <Popover open={open} onOpenChange={(v) => { if (v) setActiveCategory('all'); setOpen(v); }}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-destructive px-1 text-[9px] font-bold text-white">{unreadCount}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="p-3 border-b flex items-center justify-between">
          <strong>{t('activityCenter')}</strong>
          <div className="flex gap-1">
            {activeCategory !== 'all' && (
              <Button size="sm" variant="ghost" onClick={() => markCategoryRead.mutate(activeCategory)} disabled={markCategoryRead.isPending}>Clear</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}><CheckCheck className="h-3 w-3" /></Button>
          </div>
        </div>
        <div className="p-2 flex flex-wrap gap-1 border-b">
          {categories.map((cat) => (
            <button key={cat} className={cn('text-xs px-2 py-1 rounded', activeCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted')} onClick={() => setActiveCategory(cat)}>
              {cat} {cat === 'all' ? unreadCount : unreadByCategory[cat] || 0}
            </button>
          ))}
        </div>
        <ScrollArea className="max-h-[420px]">
          {isLoading ? <div className="p-4 text-sm">Loading...</div> : grouped.map((n) => (
            <button key={n.id} onClick={() => onNavigate(n)} className={cn('w-full text-left p-3 border-b hover:bg-muted/40', !n.read_at && 'bg-primary/5')}>
              <div className="text-xs font-semibold">{n.title} {n.groupCount && n.groupCount > 1 ? `×${n.groupCount}` : ''}</div>
              {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
              {/* Inline approve/reject for agreement notifications */}
              {isAgreementNotification(n) && !n.read_at && (
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-6 text-[10px] px-3"
                    disabled={actioningIds.has(n.id)}
                    onClick={(e) => handleAgreementAction(n, 'approved', e)}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    {t('approveAction')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 text-[10px] px-3"
                    disabled={actioningIds.has(n.id)}
                    onClick={(e) => handleAgreementAction(n, 'rejected', e)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    {t('rejectAction')}
                  </Button>
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</div>
            </button>
          ))}
        </ScrollArea>
        <div className="p-2 border-t text-[10px] text-muted-foreground flex justify-between">
          <span>{hasLiveNotificationChannel ? t('liveLabel') : 'Degraded'}</span>
          <span>{(notifications ?? []).length} total</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
