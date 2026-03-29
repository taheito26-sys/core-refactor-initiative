import { isNativeApp } from '@/platform/runtime';

export const NATIVE_APP_SCHEME = 'com.taheito26sys.corerefactorinitiative';
export const NATIVE_OAUTH_CALLBACK_HOST = 'login-callback';
export const NATIVE_RESET_CALLBACK_HOST = 'reset-password-callback';

export const NATIVE_OAUTH_CALLBACK_URL = `${NATIVE_APP_SCHEME}://${NATIVE_OAUTH_CALLBACK_HOST}`;
export const NATIVE_PASSWORD_RESET_CALLBACK_URL = `${NATIVE_APP_SCHEME}://${NATIVE_RESET_CALLBACK_HOST}`;

export function isNativeRuntime(): boolean {
  return isNativeApp();
}

function getWebOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function getAuthFlowContext() {
  const native = isNativeRuntime();

  return {
    runtime: native ? 'native' : 'web',
    oauthRedirectTo: native ? NATIVE_OAUTH_CALLBACK_URL : `${getWebOrigin()}/auth/callback`,
    passwordResetRedirectTo: native
      ? NATIVE_PASSWORD_RESET_CALLBACK_URL
      : `${getWebOrigin()}/reset-password`,
  } as const;
}

export function mapIncomingAuthCallbackToRoute(url: string): string | null {
  try {
    const parsed = new URL(url);
    const normalizedHash = parsed.hash || '';
    const normalizedSearch = parsed.search || '';

    if (parsed.protocol.replace(':', '') !== NATIVE_APP_SCHEME) {
      return null;
    }

    if (parsed.hostname === NATIVE_OAUTH_CALLBACK_HOST) {
      return `/auth/callback${normalizedSearch}${normalizedHash}`;
    }

    if (parsed.hostname === NATIVE_RESET_CALLBACK_HOST) {
      return `/reset-password${normalizedSearch}${normalizedHash}`;
    }

    return null;
  } catch {
    return null;
  }
}

export function isAuthCallbackUrl(url: string): boolean {
  return mapIncomingAuthCallbackToRoute(url) !== null;
}
