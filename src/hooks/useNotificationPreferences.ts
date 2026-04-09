import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface NotificationPref {
  id: string;
  category: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  sound_enabled: boolean;
}

const DEFAULT_CATEGORIES = [
  'deal', 'order', 'invite', 'approval', 'agreement',
  'settlement', 'message', 'system',
] as const;

export function useNotificationPreferences() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: async (): Promise<NotificationPref[]> => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('id, category, in_app_enabled, push_enabled, sound_enabled')
        .eq('user_id', userId!);
      if (error) throw error;

      // Fill in defaults for missing categories
      const existing = new Map((data ?? []).map(d => [d.category, d]));
      const result: NotificationPref[] = [];
      for (const cat of DEFAULT_CATEGORIES) {
        if (existing.has(cat)) {
          result.push(existing.get(cat)!);
        } else {
          result.push({
            id: `default-${cat}`,
            category: cat,
            in_app_enabled: true,
            push_enabled: true,
            sound_enabled: true,
          });
        }
      }
      return result;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const upsert = useMutation({
    mutationFn: async (pref: { category: string; field: 'in_app_enabled' | 'push_enabled' | 'sound_enabled'; value: boolean }) => {
      const { data: existing } = await supabase
        .from('notification_preferences')
        .select('id')
        .eq('user_id', userId!)
        .eq('category', pref.category)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('notification_preferences')
          .update({ [pref.field]: pref.value })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const row: Record<string, unknown> = {
          user_id: userId!,
          category: pref.category,
          in_app_enabled: true,
          push_enabled: true,
          sound_enabled: true,
          [pref.field]: pref.value,
        };
        const { error } = await supabase
          .from('notification_preferences')
          .insert([{
            user_id: userId!,
            category: pref.category,
            in_app_enabled: true,
            push_enabled: true,
            sound_enabled: true,
            [pref.field]: pref.value,
          }]);
        if (error) throw error;
      }
    },
    onMutate: async (pref) => {
      qc.setQueryData<NotificationPref[]>(
        ['notification-preferences', userId],
        (old) => old?.map(p =>
          p.category === pref.category ? { ...p, [pref.field]: pref.value } : p
        ),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  return { ...query, upsert };
}
