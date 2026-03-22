import { Bell, Mail, Handshake, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecentActivity, type ActivityItem } from '../hooks/useRecentActivity';
import { formatDistanceToNow } from 'date-fns';

const iconMap = {
  notification: Bell,
  invite: Mail,
  deal: Handshake,
} as const;

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = iconMap[item.type] ?? Bell;

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
      <span className="mt-0.5 p-1.5 rounded-lg bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
        {item.description && (
          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
      </span>
    </div>
  );
}

export function RecentActivity() {
  const { data, isLoading } = useRecentActivity();

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <div className="divide-y-0">
            {data.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Bell className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Activity from deals, invites, and notifications will appear here
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
