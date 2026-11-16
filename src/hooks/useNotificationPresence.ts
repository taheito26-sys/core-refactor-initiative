/**
 * useNotificationPresence — tells the server that this browser is actively
 * showing the app, so it does not also raise an OS notification on this
 * device. Presence is stored per subscription (not per user), so a phone still
 * gets pushed while the desktop is open.
 */
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { isNativeApp } from '@/platform/runtime';
import { getExistingSubscription } from '@/lib/web-push';

const HEARTBEAT_MS = 45_000;

async function setPresence(active: boolean, endpoint: string | null) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('set_notification_presence', {
      _active: active,
      _endpoint: endpoint,
    });
  } catch {
    // Presence only suppresses duplicate OS pushes; failure is harmless.
  }
}

export function useNotificationPresence() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId || typeof document === 'undefined' || isNativeApp()) return;

    let endpoint: string | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = () => {
      if (stopped || document.visibilityState !== 'visible') return;

      if (!endpoint) {
        // The service worker can finish registering after this hook mounts.
        void getExistingSubscription().then((subscription) => {
          endpoint = subscription?.endpoint ?? null;
          if (endpoint) void setPresence(true, endpoint);
        });
        return;
      }

      void setPresence(true, endpoint);
    };

    const clear = () => {
      void setPresence(false, endpoint);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') ping();
      else clear();
    };

    void (async () => {
      const subscription = await getExistingSubscription();
      if (stopped) return;
      endpoint = subscription?.endpoint ?? null;
      ping();
      timer = setInterval(ping, HEARTBEAT_MS);
    })();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', ping);
    window.addEventListener('pagehide', clear);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', ping);
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [userId]);
}
