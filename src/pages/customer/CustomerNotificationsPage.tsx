import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { formatCustomerDate, listCustomerNotifications, type CustomerNotificationRow } from '@/features/customer/customer-portal';

export default function CustomerNotificationsPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['c-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerNotifications(userId);
      return (data ?? []) as CustomerNotificationRow[];
    },
    enabled: !!userId,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{lang === 'ar' ? 'التنبيهات' : 'Notifications'}</h1>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : notifications.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {lang === 'ar' ? 'لا توجد تنبيهات' : 'No notifications'}
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                'rounded-2xl border border-border/50 bg-card px-4 py-3',
                !n.read_at && 'border-primary/30 bg-primary/5',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-semibold text-foreground', !n.read_at && 'text-primary')}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                  )}
                </div>
                {!n.read_at && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {formatCustomerDate(n.created_at, lang)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
