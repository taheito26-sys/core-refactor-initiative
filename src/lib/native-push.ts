import { supabase } from '@/integrations/supabase/client';

export const NATIVE_PUSH_TOKEN_KEY = 'push_device_token';

/** Removes this device's FCM/APNs token when the user signs out. */
export async function unregisterNativePushToken(): Promise<void> {
  try {
    const token = localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
    if (!token) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('unregister_push_token', { _token: token });
    localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
  } catch {
    // Signing out must never fail because of push cleanup.
  }
}
