/**
 * usePushRegistration — registers FCM/APNs tokens with the backend.
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
import { NATIVE_PUSH_TOKEN_KEY } from '@/lib/native-push';
import { isPushOptedOut } from '@/lib/push-opt-out';

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

const DEVICE_ID_KEY = 'push_device_id';

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'device';
  }
}

export function usePushRegistration() {
  const { userId } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId || !isNativeApp()) return;

    const push = getNativePlugin<PushPlugin>('PushNotifications');
    if (!push?.addListener || !push.requestPermissions || !push.register) return;

    const listeners: Array<{ remove: () => void }> = [];

    const setup = async () => {
      // The user explicitly turned push off on this device.
      if (isPushOptedOut()) return;
      try {
        const perm = await push.requestPermissions!();
        if (perm.receive !== 'granted') return;
        await push.register!();
      } catch {
        // Push not available (missing google-services.json / APNs capability).
        return;
      }

      // Token received → register it for the signed-in account.
      const tokenListener = await push.addListener!('registration', async (data: unknown) => {
        const { value: token } = data as PushToken;
        if (!token) return;

        const platform = getRuntimePlatform();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)('register_push_token', {
          _token: token,
          _platform: platform,
          _device_id: getDeviceId(),
        });

        if (error) {
          console.error('[push-reg] Failed to save token:', error.message);
        } else {
          try {
            localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
          } catch { /* storage may be unavailable */ }
          window.dispatchEvent(new CustomEvent('push-token-registered'));
          console.info('[push-reg] Token registered for', platform);
        }
      });
      listeners.push(tokenListener);

      const errorListener = await push.addListener!('registrationError', (err: unknown) => {
        console.error('[push-reg] Registration error:', err);
      });
      listeners.push(errorListener);

      // Notification tap → deep-link
      const actionListener = await push.addListener!(
        'pushNotificationActionPerformed',
        async (action: unknown) => {
          const { notification } = action as PushNotificationAction;
          const data = notification.data ?? {};
          const notifId = data.notification_id;

          if (notifId) {
            const { data: row } = await supabase
              .from('notifications')
              .select('id, title, body, category, read_at, created_at, conversation_id, message_id, entity_type, entity_id, anchor_id, actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id')
              .eq('id', notifId)
              .single();

            if (row) {
              const model = mapNotificationRowToModel(row as NotificationRow);
              await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notifId);
              handleNotificationClick(model, navigate);
              return;
            }
          }

          // Fallback when the notification row is gone: use the path that the
          // server embedded in the push payload.
          if (data.path) navigate(data.path);
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
