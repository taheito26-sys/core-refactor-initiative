import { Bell, BellOff, Send, CheckCircle2, AlertCircle, Smartphone, Monitor, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useWebPush } from '@/hooks/useWebPush';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { cn } from '@/lib/utils';

function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PushNotificationsCard() {
  const push = useWebPush();
  const { data: settings, upsert } = useNotificationSettings();

  const accountEnabled = settings?.push_enabled !== false;
  const active = accountEnabled && push.subscribed;

  const statusLabel = !accountEnabled ? 'Paused' : active ? 'Active' : 'Off';
  const statusClass = !accountEnabled
    ? 'border-muted-foreground/30 text-muted-foreground'
    : active
      ? 'border-success/40 text-success'
      : 'border-muted-foreground/30 text-muted-foreground';

  const unsupportedText = (() => {
    if (push.isNative) return 'Native push is handled by the mobile app. Enable notifications there to receive alerts.';
    switch (push.supportReason) {
      case 'no-push-manager':
        return 'This browser does not support Web Push. Try Chrome, Edge, Firefox or Safari 16.4+.';
      case 'no-service-worker':
        return 'This browser cannot run the notification service worker.';
      case 'no-notification':
        return 'This browser does not expose the Notification API.';
      case 'native':
        return 'Native push is handled by the mobile app.';
      default:
        return 'Push notifications are not available in this environment.';
    }
  })();

  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Push Notifications
          </CardTitle>
          <Badge variant="outline" className={cn('text-[10px]', statusClass)}>
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Get alerts on this device even when Raseed is closed. Push notifications follow the category
          preferences and quiet hours below.
        </p>

        {/* Account-wide master switch */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <Label className="text-xs font-medium">Push notifications on this account</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Pauses delivery to every device without unsubscribing them.
            </p>
          </div>
          <Switch
            checked={accountEnabled}
            disabled={upsert.isPending}
            onCheckedChange={(value) => upsert.mutate({ push_enabled: value })}
          />
        </div>

        {/* This device */}
        <div className="rounded-lg border border-border/60 px-3 py-2.5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {push.isNative ? (
                <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium">This device</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {push.isNative
                    ? push.subscribed ? 'Registered with the mobile push service.' : 'Not registered yet.'
                    : push.subscribed ? 'This browser is subscribed to push.' : 'This browser is not subscribed yet.'}
                </p>
              </div>
            </div>

            {push.subscribed ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </div>

          {!push.supported && !push.isNative && (
            <p className="text-[10px] text-muted-foreground">
              {unsupportedText}
              {isIosBrowser() && (
                <> On iPhone or iPad, add Raseed to your Home Screen first (Share → Add to Home Screen), then enable notifications from the installed app.</>
              )}
            </p>
          )}

          {push.permission === 'denied' && (
            <p className="text-[10px] text-destructive">
              Notifications are blocked for this site. Allow them in your browser's site settings, then try again.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!push.subscribed && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1"
                disabled={push.busy || (!push.supported && !push.isNative) || (push.permission === 'denied' && !push.isNative)}
                onClick={() => void push.enable()}
              >
                {push.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                Enable notifications
              </Button>
            )}

            {push.subscribed && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                disabled={push.busy}
                onClick={() => void push.test()}
              >
                {push.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Send test notification
              </Button>
            )}

            {push.subscribed && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs gap-1 text-muted-foreground"
                disabled={push.busy}
                onClick={() => void push.disable()}
              >
                <BellOff className="h-3 w-3" />
                Turn off on this device
              </Button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Push is not sent to a device while you are actively using the app on that device — the in-app
          notification is shown instead.
        </p>
      </CardContent>
    </Card>
  );
}
