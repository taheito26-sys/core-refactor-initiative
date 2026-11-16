import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface NotificationSettings {
  user_id: string;
  push_enabled: boolean;
  dnd_enabled: boolean;
  /** HH:MM */
  dnd_start: string;
  /** HH:MM */
  dnd_end: string;
  timezone: string;
  exists: boolean;
}

export interface NotificationSettingsPatch {
  push_enabled?: boolean;
  dnd_enabled?: boolean;
  dnd_start?: string;
  dnd_end?: string;
  timezone?: string;
}

export function toHhMm(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const DEFAULTS: Omit<NotificationSettings, 'user_id'> = {
  push_enabled: true,
  dnd_enabled: false,
  dnd_start: '22:00',
  dnd_end: '07:00',
  timezone: 'UTC',
  exists: false,
};

export function useNotificationSettings() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notification-settings', userId],
    queryFn: async (): Promise<NotificationSettings> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('notification_settings') as any)
        .select('user_id, push_enabled, dnd_enabled, dnd_start, dnd_end, timezone')
        .eq('user_id', userId!)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return {
          user_id: userId!,
          ...DEFAULTS,
          timezone: currentTimezone(),
        };
      }

      return {
        user_id: data.user_id,
        push_enabled: data.push_enabled !== false,
        dnd_enabled: data.dnd_enabled === true,
        dnd_start: toHhMm(data.dnd_start, DEFAULTS.dnd_start),
        dnd_end: toHhMm(data.dnd_end, DEFAULTS.dnd_end),
        timezone: data.timezone || currentTimezone(),
        exists: true,
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const upsert = useMutation({
    mutationFn: async (patch: NotificationSettingsPatch) => {
      const current = queryClient.getQueryData<NotificationSettings>(['notification-settings', userId]);
      const row = {
        user_id: userId!,
        push_enabled: patch.push_enabled ?? current?.push_enabled ?? true,
        dnd_enabled: patch.dnd_enabled ?? current?.dnd_enabled ?? false,
        dnd_start: patch.dnd_start ?? current?.dnd_start ?? DEFAULTS.dnd_start,
        dnd_end: patch.dnd_end ?? current?.dnd_end ?? DEFAULTS.dnd_end,
        timezone: patch.timezone ?? currentTimezone(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('notification_settings') as any)
        .upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      return row;
    },
    onMutate: async (patch) => {
      const previous = queryClient.getQueryData<NotificationSettings>(['notification-settings', userId]);
      if (previous) {
        queryClient.setQueryData<NotificationSettings>(['notification-settings', userId], {
          ...previous,
          ...patch,
          exists: true,
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notification-settings', userId], context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings', userId] });
    },
  });

  return { ...query, upsert };
}
