/**
 * usePushRegistration — Registers FCM/APNs tokens with the backend.
 * Listens for Capacitor PushNotifications events and upserts device tokens.
 * Also handles push notification tap → deep-link navigation.
 */
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { getNativePlugin, getRuntimePlatform, isNativeApp } from '@/platform/runtime';
import { handleNotificationClick } from '@/lib/notification-router';
import { mapNotificationRowToModel, type NotificationRow } from '@/types/notifications';
import { useNavigate } from 'react-router-dom';

interface PushToken {
  value: string;
}

interface PushNotificationAction {
  notification: {
    data?: Record<string, string>;
  };
}

type PushPlugin = {
  addListener?: (event: string, cb: (data: unknown) => void) => Promise<{ remove: () => void }>;
  requestPermissions?: () => Promise<{ receive: string }>;
  register?: () => Promise<void>;
};

export function usePushRegistration() {
  const { userId } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId || !isNativeApp()) return;

    const push = getNativePlugin<PushPlugin>('PushNotifications');
    if (!push?.addListener || !push.requestPermissions || !push.register) return;

    const listeners: Array<{ remove: () => void }> = [];

    const setup = async () => {
      try {
        const perm = await push.requestPermissions!();
        if (perm.receive !== 'granted') return;
        await push.register!();
      } catch {
        // Push not available
        return;
      }

      // Token received → upsert to backend
      const tokenListener = await push.addListener!('registration', async (data: unknown) => {
        const { value: token } = data as PushToken;
        if (!token) return;

        const platform = getRuntimePlatform();
        const deviceId = `${platform}-${userId.slice(0, 8)}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('push_device_tokens') as any).upsert(
          { user_id: userId, token, platform, device_id: deviceId },
          { onConflict: 'user_id,token' }
        );

        if (error) {
          console.error('[push-reg] Failed to save token:', error.message);
        } else {
          console.info('[push-reg] Token registered for', platform);
        }
      });
      listeners.push(tokenListener);

      // Token error
      const errorListener = await push.addListener!('registrationError', (err: unknown) => {
        console.error('[push-reg] Registration error:', err);
      });
      listeners.push(errorListener);

      // Notification tap → deep-link
      const actionListener = await push.addListener!(
        'pushNotificationActionPerformed',
        async (action: unknown) => {
          const { notification } = action as PushNotificationAction;
          const notifId = notification.data?.notification_id;
          if (!notifId) return;

          // Fetch the full notification to build the deep-link
          const { data } = await supabase
            .from('notifications')
            .select('id, title, body, category, read_at, created_at, conversation_id, message_id, entity_type, entity_id, anchor_id, actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id')
            .eq('id', notifId)
            .single();

          if (data) {
            const model = mapNotificationRowToModel(data as NotificationRow);
            // Mark as read
            await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notifId);
            handleNotificationClick(model, navigate);
          }
        }
      );
      listeners.push(actionListener);
    };

    void setup();

    return () => {
      listeners.forEach(l => l.remove());
    };
  }, [userId, navigate]);
}
