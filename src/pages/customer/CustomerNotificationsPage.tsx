import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { formatCustomerDate, listCustomerNotifications, type CustomerNotificationRow } from '@/features/customer/customer-portal';

export default function CustomerNotificationsPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery<CustomerNotificationRow[]>({
    queryKey: ['c-notifications', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerNotifications(userId); return (data ?? []) as CustomerNotificationRow[]; },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`c-notif-rt-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ['c-notifications', userId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId!).is('read_at', null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['c-notifications', userId] }),
  });

  const unread = notifications.filter(n => !n.read_at).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{L('Notifications', 'التنبيهات')}</h1>
          {unread > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{unread}</span>}
        </div>
        {unread > 0 && (
          <button onClick={() => markAllRead.mutate()} className="flex items-center gap-1.5 text-xs text-primary font-medium">
            <CheckCheck className="h-3.5 w-3.5" />{L('Mark all read', 'تحديد الكل كمقروء')}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <Bell className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{L('No notifications', 'لا توجد تنبيهات')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id} className={cn('rounded-2xl border px-4 py-3', !n.read_at ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card')}>
              <div className="flex items-start gap-3">
                <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', !n.read_at ? 'bg-primary/10' : 'bg-muted')}>
                  <Bell className={cn('h-3.5 w-3.5', !n.read_at ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-semibold', !n.read_at ? 'text-foreground' : 'text-muted-foreground')}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatCustomerDate(n.created_at, lang)}</p>
                </div>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
