/**
 * web-push.ts — browser/PWA Web Push subscription helpers.
 *
 * Native builds use FCM through Capacitor instead; every function here is a
 * no-op there. The VAPID public key is fetched from push-send and cached for
 * the lifetime of the tab.
 */
import { supabase } from '@/integrations/supabase/client';
import { isNativeApp } from '@/platform/runtime';
import { isPushOptedOut, setPushOptedOut } from '@/lib/push-opt-out';

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'native' | 'no-service-worker' | 'no-push-manager' | 'no-notification' | 'server' };

let cachedPublicKey: string | null = null;
let webPushActive = false;

/** Whether this browser currently has a live push subscription. */
export function isWebPushActive(): boolean {
  return webPushActive;
}

export function getWebPushSupport(): PushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'server' };
  if (isNativeApp()) return { supported: false, reason: 'native' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'no-service-worker' };
  if (!('PushManager' in window)) return { supported: false, reason: 'no-push-manager' };
  if (!('Notification' in window)) return { supported: false, reason: 'no-notification' };
  return { supported: true };
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getVapidPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;

  const { data, error } = await supabase.functions.invoke('push-send', {
    body: { action: 'public_key' },
  });
  if (error) throw new Error(error.message || 'Could not load the push public key');
  if (!data?.public_key) throw new Error('Push is not configured on the server');

  cachedPublicKey = data.public_key as string;
  return cachedPublicKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function getReadyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) => {
      setTimeout(() => reject(new Error('The notification service worker is not ready yet')), timeoutMs);
    }),
  ]);
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!getWebPushSupport().supported) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = (await registration?.pushManager.getSubscription()) ?? null;
  webPushActive = Boolean(subscription);
  return subscription;
}

async function subscribe(): Promise<PushSubscription> {
  const publicKey = await getVapidPublicKey();
  const registration = await getReadyRegistration();

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('The browser returned an incomplete push subscription');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('register_web_push_subscription', {
    _endpoint: subscription.endpoint,
    _p256dh: p256dh,
    _auth_key: auth,
    _user_agent: navigator.userAgent.slice(0, 500),
  });
  if (error) throw error;
}

/**
 * Called after sign-in. It never prompts: if permission was already granted it
 * silently refreshes the subscription (browser endpoints rotate) and re-saves
 * it for the current account.
 */
export async function ensureWebPushSubscription(): Promise<PushSubscription | null> {
  if (!getWebPushSupport().supported) return null;
  if (isPushOptedOut()) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const subscription = await subscribe();
    await saveSubscription(subscription);
    webPushActive = true;
    return subscription;
  } catch (err) {
    console.warn('[web-push] Could not refresh the subscription:', err);
    return null;
  }
}

/** Must be called from a user gesture (button click) on iOS/Safari. */
export async function enableWebPush(): Promise<PushSubscription> {
  const support = getWebPushSupport();
  if (!support.supported) throw new Error('Push notifications are not available in this browser');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const subscription = await subscribe();
  await saveSubscription(subscription);
  setPushOptedOut(false);
  webPushActive = true;
  return subscription;
}

export async function disableWebPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  setPushOptedOut(true);
  webPushActive = false;
  if (!subscription) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('unregister_web_push_subscription', {
      _endpoint: subscription.endpoint,
    });
  } catch {
    // The endpoint is deleted server-side on the next stale send anyway.
  }

  await subscription.unsubscribe();
}

/** Clears this browser's subscription when the user signs out. */
export async function unregisterWebPushOnSignOut(): Promise<void> {
  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('unregister_web_push_subscription', {
      _endpoint: subscription.endpoint,
    });
    await subscription.unsubscribe();
    webPushActive = false;
  } catch {
    // Signing out must never fail because of push cleanup.
  }
}

export interface TestPushResult {
  web?: number;
  native?: number;
  fcm_configured?: boolean;
  skipped?: string;
}

export async function sendTestPush(): Promise<TestPushResult> {
  const { data, error } = await supabase.functions.invoke('push-send', {
    body: { action: 'test' },
  });
  if (error) throw new Error(error.message || 'The test notification could not be sent');
  if (data?.error) throw new Error(String(data.error));
  return data as TestPushResult;
}
