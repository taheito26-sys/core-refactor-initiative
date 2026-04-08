import { useState } from 'react';
import {
  Bell, BellOff, Volume2, VolumeX, Smartphone,
  Handshake, Package, Mail, ShieldCheck, FileText,
  MessageSquare, Zap, Settings2, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { getDndSchedule, setDndSchedule, type DndSchedule } from '@/lib/notification-sounds';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (t: any, key: string, fallback: string) => { try { return t(key); } catch { return fallback; } };

const CATEGORY_META: Record<string, { icon: React.ElementType; labelKey: string; color: string }> = {
  deal:       { icon: Handshake,    labelKey: 'notifDeals',      color: 'text-accent' },
  order:      { icon: Package,      labelKey: 'orders',          color: 'text-warning' },
  invite:     { icon: Mail,         labelKey: 'notifInvites',    color: 'text-primary' },
  approval:   { icon: ShieldCheck,  labelKey: 'notifApprovals',  color: 'text-success' },
  agreement:  { icon: FileText,     labelKey: 'agreements',      color: 'text-blue-500' },
  settlement: { icon: Settings2,    labelKey: 'settlements',     color: 'text-orange-500' },
  message:    { icon: MessageSquare,labelKey: 'messages',        color: 'text-sky-500' },
  system:     { icon: Zap,          labelKey: 'notifSystem',     color: 'text-muted-foreground' },
};

export function NotificationPreferencesPanel() {
  const t = useT();
  const { data: prefs, isLoading, upsert } = useNotificationPreferences();
  const [dnd, setLocalDnd] = useState<DndSchedule>(getDndSchedule);

  const handleDndChange = (partial: Partial<DndSchedule>) => {
    const updated = { ...dnd, ...partial };
    setLocalDnd(updated);
    setDndSchedule(updated);
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
      {/* Category Preferences */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              {t('notificationPreferences') || 'Notification Preferences'}
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {(prefs ?? []).length} {t('categories') || 'categories'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('category') || 'Category'}</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">{t('inApp') || 'In-App'}</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">{t('push') || 'Push'}</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">{t('sound') || 'Sound'}</span>
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
                  <span className="text-xs font-medium capitalize">{t(meta.labelKey) || pref.category}</span>
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
            {t('doNotDisturb') || 'Do Not Disturb'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t('enableDnd') || 'Enable DND schedule'}</Label>
            <Switch checked={dnd.enabled} onCheckedChange={(v) => handleDndChange({ enabled: v })} />
          </div>

          {dnd.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {t('startTime') || 'Start'}
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
                  <Clock className="h-3 w-3" /> {t('endTime') || 'End'}
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
            {t('dndDescription') || 'During DND hours, all notification sounds and haptics are suppressed. In-app alerts still appear.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
