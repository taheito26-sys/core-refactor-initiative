import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, Loader2 } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { formatCustomerDate, listCustomerNotifications, type CustomerNotificationRow } from '@/features/customer/customer-portal';

export default function CustomerNotificationsPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const t = useT();
  const language = settings.language === 'ar' ? 'ar' : 'en';

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['customer-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerNotifications(userId);
      if (error) return [];
      return (data ?? []) as CustomerNotificationRow[];
    },
    enabled: !!userId,
  });

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{t('notifications')}</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">{t('customerNotifications')}</h1>
            <p className="text-sm text-muted-foreground">{t('customerNotificationsSubtitle')}</p>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> {t('customerNotifications')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-3 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">{t('noNotifications')}</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <div key={notification.id} className="rounded-lg border border-border/60 bg-card/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{notification.title}</p>
                      {notification.read_at ? <Badge variant="secondary">{t('read')}</Badge> : <Badge>{t('unread')}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{notification.body ?? t('noDetails')}</p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCustomerDate(notification.created_at, language)}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
