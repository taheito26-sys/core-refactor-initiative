import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Handshake, Mail, ShieldCheck, Package, LayoutDashboard, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

const categoryIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  deal: Handshake,
  order: Package,
  invite: Mail,
  network: Mail,
  approval: ShieldCheck,
  merchant: Handshake,
  system: Bell,
};

function NotificationRow({
  n,
  onNavigate,
}: {
  n: Notification;
  onNavigate: (n: Notification) => void;
}) {
  const Icon = categoryIcon[n.category] ?? Bell;
  const isUnread = !n.read_at;

  return (
    <button
      onClick={() => onNavigate(n)}
      className={cn(
        'w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors rounded-md',
        isUnread
          ? 'bg-primary/5 hover:bg-primary/10'
          : 'hover:bg-muted/60'
      )}
    >
      <div className={cn(
        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        isUnread ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      )}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
          <span className={cn('text-[12px] leading-tight truncate', isUnread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
            {n.title}
          </span>
        </div>
        {n.body && (
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
            {n.body}
          </p>
        )}
        <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
        </span>
      </div>
    </button>
  );
}

export default function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: notifications, isLoading, unreadCount } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllRead();

  const handleNavigate = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    setOpen(false);
    navigate(notificationRoute(n));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground animate-in zoom-in-50">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] p-0 shadow-xl border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="max-h-[380px]">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="py-1 space-y-0.5 px-1">
              {notifications.map(n => (
                <NotificationRow key={n.id} n={n} onNavigate={handleNavigate} />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications && notifications.length > 0 && (
          <div className="border-t border-border px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1.5"
              onClick={() => { setOpen(false); navigate('/notifications'); }}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              View all notifications
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
