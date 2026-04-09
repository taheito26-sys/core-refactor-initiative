import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChatPrivacySettings {
  user_id: string;
  hide_read_receipts: boolean;
  hide_last_seen: boolean;
  hide_typing: boolean;
  invisible_mode: boolean;
  online_visibility: 'everyone' | 'room_members' | 'nobody';
  notification_preview: 'full' | 'sender_only' | 'none';
  show_sender_in_notification: boolean;
  anonymous_mode: boolean;
  screenshot_protection: boolean;
  watermark_enabled: boolean;
  forwarding_disabled: boolean;
  copy_disabled: boolean;
  export_disabled: boolean;
  updated_at: string;
}

export type UpdatePrivacySettingsInput = Partial<Omit<ChatPrivacySettings, 'user_id' | 'updated_at'>>;

const PRIVACY_SETTINGS_KEY = ['chat', 'privacy-settings'];

export const DEFAULT_PRIVACY_SETTINGS: Omit<ChatPrivacySettings, 'user_id' | 'updated_at'> = {
  hide_read_receipts: false,
  hide_last_seen: false,
  hide_typing: false,
  invisible_mode: false,
  online_visibility: 'everyone',
  notification_preview: 'full',
  show_sender_in_notification: true,
  anonymous_mode: false,
  screenshot_protection: false,
  watermark_enabled: false,
  forwarding_disabled: false,
  copy_disabled: false,
  export_disabled: false,
};

async function getPrivacySettings(): Promise<ChatPrivacySettings> {
  const { data, error } = await supabase.rpc('chat_get_privacy_settings' as never);
  if (error) throw error;
  return data as ChatPrivacySettings;
}

async function updatePrivacySettings(input: UpdatePrivacySettingsInput): Promise<ChatPrivacySettings> {
  const { data, error } = await supabase.rpc('chat_update_privacy_settings' as never, {
    _hide_read_receipts: input.hide_read_receipts ?? null,
    _hide_last_seen: input.hide_last_seen ?? null,
    _hide_typing: input.hide_typing ?? null,
    _invisible_mode: input.invisible_mode ?? null,
    _online_visibility: input.online_visibility ?? null,
    _notification_preview: input.notification_preview ?? null,
    _show_sender_in_notification: input.show_sender_in_notification ?? null,
    _anonymous_mode: input.anonymous_mode ?? null,
    _screenshot_protection: input.screenshot_protection ?? null,
    _watermark_enabled: input.watermark_enabled ?? null,
    _forwarding_disabled: input.forwarding_disabled ?? null,
    _copy_disabled: input.copy_disabled ?? null,
    _export_disabled: input.export_disabled ?? null,
  } as never);
  if (error) throw error;
  return data as ChatPrivacySettings;
}

export function usePrivacySettings() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: PRIVACY_SETTINGS_KEY,
    queryFn: getPrivacySettings,
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: updatePrivacySettings,
    onSuccess: (data) => {
      qc.setQueryData(PRIVACY_SETTINGS_KEY, data);
    },
  });

  const settings = useMemo(() => {
    if (query.data) return query.data;
    return {
      user_id: '',
      ...DEFAULT_PRIVACY_SETTINGS,
      updated_at: '',
    } as ChatPrivacySettings;
  }, [query.data]);

  return {
    settings,
    isLoading: query.isLoading,
    update: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    refetch: query.refetch,
  };
}
