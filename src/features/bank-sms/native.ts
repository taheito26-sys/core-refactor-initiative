import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from '@/platform/runtime';
import type { RawSms } from './parser';

type SmsPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

interface SmsBalancePlugin {
  checkPermissions(): Promise<{ sms: SmsPermissionState }>;
  requestPermissions(): Promise<{ sms: SmsPermissionState }>;
  readInbox(opts: { sinceMs: number; limit?: number }): Promise<{ messages: RawSms[] }>;
  drainPending(): Promise<{ messages: RawSms[] }>;
  addListener(event: 'smsReceived', cb: () => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<SmsBalancePlugin>('SmsBalance');

/** SMS reading exists only in the Android shell. */
export const isSmsBalanceSupported = (): boolean => isAndroid();

export async function getSmsPermission(): Promise<SmsPermissionState> {
  return (await plugin.checkPermissions()).sms;
}

export async function requestSmsPermission(): Promise<SmsPermissionState> {
  return (await plugin.requestPermissions()).sms;
}

/** Inbox messages newer than `sinceMs` plus any queued while the app was closed. */
export async function fetchBalanceSms(sinceMs: number): Promise<RawSms[]> {
  const [inbox, pending] = await Promise.all([
    plugin.readInbox({ sinceMs }),
    plugin.drainPending(),
  ]);
  return [...inbox.messages, ...pending.messages];
}

export function onSmsReceived(cb: () => void): Promise<PluginListenerHandle> {
  return plugin.addListener('smsReceived', cb);
}
