import { unregisterNativePushToken } from '@/lib/native-push';
import { unregisterWebPushOnSignOut } from '@/lib/web-push';

/**
 * Removes this device's delivery endpoints before the session ends. Without
 * this, a shared device would keep receiving pushes for the previous account.
 */
export async function unregisterPushDevicesOnSignOut(): Promise<void> {
  await Promise.allSettled([
    unregisterNativePushToken(),
    unregisterWebPushOnSignOut(),
  ]);
}
