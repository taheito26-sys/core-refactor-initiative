import { useEffect, useRef } from 'react';
import {
  Bell, BellOff,
  Handshake, Package, Mail, ShieldCheck, FileText,
  MessageSquare, Zap, Settings2, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { getDndSchedule, setDndSchedule, type DndSchedule } from '@/lib/notification-sounds';
import { PushNotificationsCard } from './PushNotificationsCard';

const CATEGORY_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  deal:       { icon: Handshake,    label: 'Deals',        color: 'text-accent' },
  order:      { icon: Package,      label: 'Orders',       color: 'text-warning' },
  invite:     { icon: Mail,         label: 'Invites',      color: 'text-primary' },
  approval:   { icon: ShieldCheck,  label: 'Approvals',    color: 'text-success' },
  agreement:  { icon: FileText,     label: 'Agreements',   color: 'text-primary' },
  settlement: { icon: Settings2,    label: 'Settlements',  color: 'text-accent' },
  message:    { icon: MessageSquare,label: 'Messages',     color: 'text-primary' },
  system:     { icon: Zap,          label: 'System',       color: 'text-muted-foreground' },
};

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function NotificationPreferencesPanel() {
  const { data: prefs, isLoading, upsert } = useNotificationPreferences();
  const { data: settings, upsert: upsertSettings } = useNotificationSettings();
  const migratedLocalDnd = useRef(false);

  const dnd: DndSchedule = {
    enabled: settings?.dnd_enabled ?? false,
    startTime: settings?.dnd_start ?? '22:00',
    endTime: settings?.dnd_end ?? '07:00',
  };

  // The server is the source of truth so quiet hours also apply to push. Mirror
  // it locally, where the Web Audio chimes read it synchronously.
  useEffect(() => {
    if (!settings?.exists) return;
    setDndSchedule({
      enabled: settings.dnd_enabled,
      startTime: settings.dnd_start,
      endTime: settings.dnd_end,
    });
  }, [settings?.exists, settings?.dnd_enabled, settings?.dnd_start, settings?.dnd_end]);

  // One-time migration of a quiet-hours schedule that only existed in this
  // browser's localStorage before push settings were stored server-side.
  useEffect(() => {
    if (migratedLocalDnd.current || !settings || settings.exists) return;
    migratedLocalDnd.current = true;
    const local = getDndSchedule();
    if (local.enabled) {
      upsertSettings.mutate({
        dnd_enabled: true,
        dnd_start: local.startTime,
        dnd_end: local.endTime,
        timezone: currentTimezone(),
      });
    }
  }, [settings, upsertSettings]);

  const handleDndChange = (partial: Partial<DndSchedule>) => {
    const updated = { ...dnd, ...partial };
    setDndSchedule(updated);
    upsertSettings.mutate({
      dnd_enabled: updated.enabled,
      dnd_start: updated.startTime,
      dnd_end: updated.endTime,
      timezone: currentTimezone(),
    });
  };

  const handleToggle = (category: string, field: 'in_app_enabled' | 'push_enabled' | 'sound_enabled', value: boolean) => {
    upsert.mutate({ category, field, value });
  };

  if (isLoading) {
    return (
      <Card className="glass">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-10 rounded bg-muted" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master push switch + this device */}
      <PushNotificationsCard />

      {/* Category Preferences */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notification Preferences
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {(prefs ?? []).length} categories
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Category</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">In-App</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Push</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Sound</span>
          </div>

          {(prefs ?? []).map((pref) => {
            const meta = CATEGORY_META[pref.category] ?? CATEGORY_META.system;
            const Icon = meta.icon;
            return (
              <div
                key={pref.category}
                className="grid grid-cols-[1fr_60px_60px_60px] gap-2 items-center px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', meta.color)} />
                  <span className="text-xs font-medium">{meta.label}</span>
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.in_app_enabled}
                    onCheckedChange={(v) => handleToggle(pref.category, 'in_app_enabled', v)}
                    className="scale-75"
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.push_enabled}
                    onCheckedChange={(v) => handleToggle(pref.category, 'push_enabled', v)}
                    className="scale-75"
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={pref.sound_enabled}
                    onCheckedChange={(v) => handleToggle(pref.category, 'sound_enabled', v)}
                    className="scale-75"
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Do Not Disturb */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <BellOff className="h-4 w-4 text-muted-foreground" />
            Do Not Disturb
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Enable DND schedule</Label>
            <Switch checked={dnd.enabled} onCheckedChange={(v) => handleDndChange({ enabled: v })} />
          </div>

          {dnd.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Start
                </Label>
                <Input
                  type="time"
                  value={dnd.startTime}
                  onChange={(e) => handleDndChange({ startTime: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> End
                </Label>
                <Input
                  type="time"
                  value={dnd.endTime}
                  onChange={(e) => handleDndChange({ endTime: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            During DND hours, push notifications, sounds and haptics are suppressed on every device. In-app
            alerts still appear. Times use this device's timezone ({currentTimezone()}).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
