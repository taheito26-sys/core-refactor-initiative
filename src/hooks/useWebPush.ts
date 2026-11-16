import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getNativePlugin, isNativeApp } from '@/platform/runtime';
import { supabase } from '@/integrations/supabase/client';
import { NATIVE_PUSH_TOKEN_KEY } from '@/lib/native-push';
import { setPushOptedOut } from '@/lib/push-opt-out';
import {
  disableWebPush,
  enableWebPush,
  ensureWebPushSubscription,
  getExistingSubscription,
  getNotificationPermission,
  getWebPushSupport,
  sendTestPush,
} from '@/lib/web-push';

interface NativePushPlugin {
  requestPermissions?: () => Promise<{ receive: string }>;
  register?: () => Promise<void>;
}

export function useWebPush() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const isNative = isNativeApp();
  const support = getWebPushSupport();

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(getNotificationPermission);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPermission(getNotificationPermission());
    if (isNative) {
      setSubscribed(Boolean(localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)));
      return;
    }
    if (!support.supported) return;
    const subscription = await getExistingSubscription();
    setSubscribed(Boolean(subscription));
  }, [isNative, support.supported]);

  useEffect(() => {
    void refresh();
  }, [refresh, userId]);

  useEffect(() => {
    const onRegistered = () => setSubscribed(true);
    window.addEventListener('push-token-registered', onRegistered);
    return () => window.removeEventListener('push-token-registered', onRegistered);
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      if (isNative) {
        const push = getNativePlugin<NativePushPlugin>('PushNotifications');
        if (!push?.requestPermissions || !push?.register) throw new Error('Native push is not available');
        const result = await push.requestPermissions();
        if (result.receive !== 'granted') throw new Error('Notification permission was not granted');
        await push.register();
        setPushOptedOut(false);
        setPermission('granted');

        // register() resolves before FCM necessarily delivers the token. Wait
        // briefly so a missing google-services.json is reported honestly.
        const tokenReady = await new Promise<boolean>((resolve) => {
          if (localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)) {
            resolve(true);
            return;
          }
          let timer: ReturnType<typeof setTimeout>;
          const onRegistered = () => {
            clearTimeout(timer);
            window.removeEventListener('push-token-registered', onRegistered);
            resolve(true);
          };
          timer = setTimeout(() => {
            window.removeEventListener('push-token-registered', onRegistered);
            resolve(false);
          }, 6000);
          window.addEventListener('push-token-registered', onRegistered);
        });

        if (!tokenReady) {
          throw new Error('The device token was not received. Check that google-services.json and the FCM service account are configured.');
        }

        setSubscribed(true);
        toast({ title: 'Push notifications enabled', description: 'This device will now receive alerts.' });
      } else {
        await enableWebPush();
        setPermission('granted');
        setSubscribed(true);
        toast({ title: 'Push notifications enabled', description: 'This browser will now receive alerts, even when the app is closed.' });
      }
    } catch (err) {
      toast({
        title: 'Could not enable push notifications',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }, [isNative, toast]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      if (isNative) {
        const token = localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
        if (token) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.rpc as any)('unregister_push_token', { _token: token });
          localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
        }
        setPushOptedOut(true);
        setSubscribed(false);
      } else {
        await disableWebPush();
        setSubscribed(false);
      }
      toast({ title: 'Push notifications turned off', description: 'This device will no longer receive push alerts.' });
    } catch (err) {
      toast({
        title: 'Could not turn off push notifications',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }, [isNative, toast]);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      // Make sure a permission that was already granted still has a live
      // subscription before asking the server to deliver.
      if (!isNative) await ensureWebPushSubscription();

      const result = await sendTestPush();
      const delivered = (result.web ?? 0) + (result.native ?? 0);
      const nativeConfigured = Boolean(result.fcm_configured || result.apns_configured);

      if (delivered > 0) {
        toast({
          title: 'Test notification sent',
          description: `Delivered to ${result.web ?? 0} browser(s) and ${result.native ?? 0} native device(s).`,
        });
      } else if (!nativeConfigured && (result.web ?? 0) === 0) {
        toast({
          title: 'No delivery endpoint registered',
          description: 'Enable push notifications on this device first. Native push also needs FCM (Android) or APNs (iOS) configured on the server.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Nothing was delivered',
          description: result.skipped
            ? `The server skipped delivery (${result.skipped}).`
            : 'No registered device received the test. Try enabling notifications again.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Test notification failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }, [isNative, toast]);

  return {
    isNative,
    supported: support.supported,
    supportReason: support.supported ? null : support.reason,
    permission,
    subscribed,
    busy,
    enable,
    disable,
    test,
    refresh,
  };
}

/** Silently refreshes a browser subscription after sign-in; never prompts. */
export function useWebPushRegistration() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId || isNativeApp()) return;

    void ensureWebPushSubscription();

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'push-subscription-changed') {
        void ensureWebPushSubscription();
      }
    };

    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
  }, [userId]);
}
