import { supabase } from '@/integrations/supabase/client';
import { isNativeApp } from '@/platform/runtime';

/**
 * Face ID / Touch ID sign-in is implemented with WebAuthn passkeys handled by
 * Supabase Auth (auth.signInWithPasskey / auth.registerPasskey). The private key
 * never leaves the device's secure enclave and the server only ever stores the
 * public half, so this is a real second credential — not a local toggle that
 * unlocks a password kept in the browser.
 *
 * Passkeys are bound to the domain that registered them, so they work in Safari
 * and in the installed home-screen app on the same domain. The Capacitor shell
 * runs on capacitor://localhost and therefore cannot use them.
 */

/** Remembers that this browser/device holds a passkey for the app. */
const ENROLLED_HINT_KEY = 'tracker.passkey.enrolled.v1';

export type PasskeyAvailability = 'available' | 'unsupported' | 'no-platform-authenticator';

export type PasskeySummary = {
  id: string;
  friendlyName?: string;
  createdAt: string;
  lastUsedAt?: string;
};

function canUseWebAuthn(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.get === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/**
 * Whether this device can both create and use a platform passkey (Face ID,
 * Touch ID, Android fingerprint). Deliberately conservative: if the platform
 * authenticator probe is missing we treat it as unavailable rather than showing
 * a button that cannot work.
 */
export async function getPasskeyAvailability(): Promise<PasskeyAvailability> {
  if (isNativeApp() || !canUseWebAuthn()) return 'unsupported';
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available ? 'available' : 'no-platform-authenticator';
  } catch {
    return 'unsupported';
  }
}

export function hasPasskeyEnrollmentHint(): boolean {
  try {
    return localStorage.getItem(ENROLLED_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPasskeyEnrollmentHint(enrolled: boolean): void {
  try {
    if (enrolled) localStorage.setItem(ENROLLED_HINT_KEY, '1');
    else localStorage.removeItem(ENROLLED_HINT_KEY);
  } catch {
    // Storage unavailable (private mode); the button still works.
  }
}

function errorField(error: unknown, field: string): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  return '';
}

/** Any string an error carries that could identify it, including its cause. */
function errorText(error: unknown): string {
  if (!error) return '';
  const parts = [
    errorField(error, 'code'),
    errorField(error, 'error_code'),
    errorField(error, 'name'),
    errorField(error, 'message'),
    errorField(error, 'cause'),
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
  ];
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause && cause !== error) parts.push(errorText(cause));
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** True when the user simply dismissed the Face ID sheet. */
export function isPasskeyCancellation(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('notallowederror') ||
    text.includes('ceremony_aborted') ||
    text.includes('aborterror') ||
    text.includes('cancelled') ||
    text.includes('canceled') ||
    text.includes('user cancelled')
  );
}

/** True when passkeys have not been switched on for the Supabase project. */
export function isPasskeyDisabled(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('passkey_disabled') || text.includes('passkeys are disabled');
}

/** True when the account/device has no passkey to sign in with. */
function isMissingPasskey(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('credential_not_found') ||
    text.includes('passkey_not_found') ||
    text.includes('no_passkey') ||
    text.includes('no passkey') ||
    text.includes('no credentials') ||
    text.includes('not found')
  );
}

export function describePasskeyError(error: unknown, isRTL: boolean): string {
  if (isPasskeyCancellation(error)) {
    return isRTL ? 'تم إلغاء التحقق بالبصمة' : 'Face ID was cancelled';
  }
  if (isPasskeyDisabled(error)) {
    return isRTL
      ? 'تسجيل الدخول بالبصمة غير مُفعّل لهذا التطبيق بعد. استخدم كلمة المرور.'
      : 'Face ID sign-in is not enabled for this app yet. Use your password for now.';
  }
  const text = errorText(error);
  if (text.includes('webauthn_credential_exists')) {
    return isRTL
      ? 'هذا الجهاز مسجّل بالفعل لهذا الحساب.'
      : 'This device is already set up for Face ID on this account.';
  }
  if (text.includes('too_many_passkeys')) {
    return isRTL
      ? 'وصلت إلى الحد الأقصى للأجهزة المسجّلة. أزل جهازاً من الإعدادات أولاً.'
      : 'You have reached the maximum number of devices. Remove one in Settings first.';
  }
  if (isMissingPasskey(error)) {
    return isRTL
      ? 'لا توجد بصمة محفوظة لهذا الحساب على هذا الجهاز. سجّل الدخول بكلمة المرور ثم فعّل البصمة من الإعدادات.'
      : 'No Face ID is saved for this account on this device. Sign in with your password, then turn on Face ID in Settings.';
  }
  return isRTL
    ? 'تعذّر التحقق بالبصمة. جرّب مرة أخرى أو استخدم كلمة المرور.'
    : 'Face ID could not verify you. Try again or use your password.';
}

/** Sign in with the passkey already stored on this device. */
export async function signInWithDevicePasskey(): Promise<{ ok: boolean; error?: unknown }> {
  try {
    const { data, error } = await supabase.auth.signInWithPasskey();
    if (error) return { ok: false, error };
    return { ok: Boolean(data?.session ?? data?.user) };
  } catch (error) {
    return { ok: false, error };
  }
}

export type RegisterPasskeyResult = {
  ok: boolean;
  passkey?: PasskeySummary;
  error?: unknown;
};

/** Create a passkey for the signed-in user on this device. */
export async function registerDevicePasskey(friendlyName?: string): Promise<RegisterPasskeyResult> {
  try {
    const { data, error } = await supabase.auth.registerPasskey();
    if (error) return { ok: false, error };
    setPasskeyEnrollmentHint(true);
    return {
      ok: true,
      passkey: {
        id: data?.id ?? '',
        friendlyName: data?.friendly_name ?? friendlyName,
        createdAt: data?.created_at ?? new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function listDevicePasskeys(): Promise<PasskeySummary[]> {
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw error;
  return (data ?? []).map(item => ({
    id: item.id,
    friendlyName: item.friendly_name,
    createdAt: item.created_at,
    lastUsedAt: item.last_used_at,
  }));
}

export async function removeDevicePasskey(passkeyId: string): Promise<void> {
  const { error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

/** A short, human label for the credential created on this device. */
export function passkeyDeviceName(): string {
  if (typeof navigator === 'undefined') return 'TRACKER';
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone (Face ID)';
  if (/iPad/i.test(ua)) return 'iPad (Face ID / Touch ID)';
  if (/Macintosh/i.test(ua)) return 'Mac (Touch ID)';
  if (/Android/i.test(ua)) return 'Android device';
  return 'This device';
}
