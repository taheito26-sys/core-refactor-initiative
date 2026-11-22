import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPasskey: mocks.signInWithPasskey,
      registerPasskey: mocks.registerPasskey,
      passkey: { list: mocks.list, delete: mocks.remove },
    },
  },
}));

import {
  describePasskeyError,
  getPasskeyAvailability,
  hasPasskeyEnrollmentHint,
  isPasskeyCancellation,
  isPasskeyDisabled,
  registerDevicePasskey,
  signInWithDevicePasskey,
} from '@/features/auth/passkeys';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('passkey error messages', () => {
  it('treats a dismissed Face ID sheet as a cancellation, not an error', () => {
    const dismissed = Object.assign(new Error('The operation was aborted'), { name: 'NotAllowedError' });
    expect(isPasskeyCancellation(dismissed)).toBe(true);
    expect(isPasskeyCancellation({ code: 'ERROR_CEREMONY_ABORTED' })).toBe(true);
    expect(describePasskeyError(dismissed, false)).toBe('Face ID was cancelled');
    expect(describePasskeyError(dismissed, true)).toBe('تم إلغاء التحقق بالبصمة');
  });

  it('explains when passkeys are not enabled on the project', () => {
    const error = { code: 'passkey_disabled', message: 'Passkeys are disabled' };
    expect(isPasskeyDisabled(error)).toBe(true);
    expect(describePasskeyError(error, false)).toContain('not enabled');
    expect(describePasskeyError(error, true)).toContain('غير مُفعّل');
  });

  it('points a user with no passkey to Settings', () => {
    const message = describePasskeyError({ code: 'webauthn_credential_not_found' }, false);
    expect(message).toContain('No Face ID is saved');
    expect(message).toContain('Settings');
  });

  it('falls back to a retry message for unknown failures', () => {
    expect(describePasskeyError(new Error('boom'), false)).toBe(
      'Face ID could not verify you. Try again or use your password.',
    );
  });
});

describe('passkey availability', () => {
  const originalPublicKeyCredential = (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  const originalCredentials = navigator.credentials;

  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  function stubWebAuthn(platformAuthenticator: boolean) {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: { isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(platformAuthenticator) },
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: vi.fn(), create: vi.fn() },
    });
  }

  it('reports unsupported when the browser has no WebAuthn', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: undefined });
    expect(await getPasskeyAvailability()).toBe('unsupported');
  });

  it('reports available when a platform authenticator is present', async () => {
    stubWebAuthn(true);
    expect(await getPasskeyAvailability()).toBe('available');
  });

  it('reports no platform authenticator when the device has none', async () => {
    stubWebAuthn(false);
    expect(await getPasskeyAvailability()).toBe('no-platform-authenticator');
  });

  it('restores the environment for other test files', () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: originalPublicKeyCredential,
    });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: originalCredentials });
    expect(true).toBe(true);
  });
});

describe('passkey sign-in and enrollment', () => {
  it('returns ok with a session from signInWithPasskey', async () => {
    mocks.signInWithPasskey.mockResolvedValue({ data: { session: { access_token: 'token' }, user: { id: 'u1' } }, error: null });
    await expect(signInWithDevicePasskey()).resolves.toEqual({ ok: true });
  });

  it('returns the server error instead of throwing', async () => {
    const error = { code: 'passkey_disabled' };
    mocks.signInWithPasskey.mockResolvedValue({ data: { session: null, user: null }, error });
    await expect(signInWithDevicePasskey()).resolves.toEqual({ ok: false, error });
  });

  it('remembers that this device enrolled a passkey', async () => {
    mocks.registerPasskey.mockResolvedValue({
      data: { id: 'pk_1', friendly_name: 'iPhone (Face ID)', created_at: '2026-11-22T20:00:00Z' },
      error: null,
    });
    const result = await registerDevicePasskey('iPhone (Face ID)');
    expect(result.ok).toBe(true);
    expect(result.passkey?.id).toBe('pk_1');
    expect(hasPasskeyEnrollmentHint()).toBe(true);
  });

  it('does not remember a failed enrollment', async () => {
    mocks.registerPasskey.mockResolvedValue({ data: null, error: { code: 'passkey_disabled' } });
    const result = await registerDevicePasskey();
    expect(result.ok).toBe(false);
    expect(hasPasskeyEnrollmentHint()).toBe(false);
  });
});
