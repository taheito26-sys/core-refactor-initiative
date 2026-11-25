import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPasskeyAvailability: vi.fn(),
  listDevicePasskeys: vi.fn(),
  registerDevicePasskey: vi.fn(),
  removeDevicePasskey: vi.fn(),
  passkeyDeviceName: vi.fn(() => 'iPhone (Face ID)'),
}));

vi.mock('@/features/auth/passkeys', () => ({
  getPasskeyAvailability: mocks.getPasskeyAvailability,
  listDevicePasskeys: mocks.listDevicePasskeys,
  registerDevicePasskey: mocks.registerDevicePasskey,
  removeDevicePasskey: mocks.removeDevicePasskey,
  passkeyDeviceName: mocks.passkeyDeviceName,
  setPasskeyEnrollmentHint: vi.fn(),
  isPasskeyDisabled: (error: { code?: string }) => error?.code === 'passkey_disabled',
  describePasskeyError: (error: { code?: string }) => `error:${error?.code ?? 'unknown'}`,
}));

vi.mock('@/lib/i18n', () => ({ useT: () => Object.assign((key: string) => key, { isRTL: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PasskeyLoginCard } from '@/features/auth/PasskeyLoginCard';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPasskeyAvailability.mockResolvedValue('available');
  mocks.listDevicePasskeys.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Face ID settings card', () => {
  it('stays hidden on devices without a platform authenticator', async () => {
    mocks.getPasskeyAvailability.mockResolvedValue('no-platform-authenticator');
    render(<PasskeyLoginCard />);
    await waitFor(() => expect(mocks.getPasskeyAvailability).toHaveBeenCalled());
    expect(screen.queryByText('Face ID sign-in')).not.toBeInTheDocument();
  });

  it('enrolls a passkey and then lists it', async () => {
    mocks.registerDevicePasskey.mockResolvedValue({ ok: true, passkey: { id: 'pk1', createdAt: '2026-11-22T20:00:00Z' } });
    render(<PasskeyLoginCard />);
    const turnOn = await screen.findByRole('button', { name: /Turn on Face ID/i });
    mocks.listDevicePasskeys.mockResolvedValue([
      { id: 'pk1', friendlyName: 'iPhone (Face ID)', createdAt: '2026-11-22T20:00:00Z' },
    ]);
    fireEvent.click(turnOn);
    await waitFor(() => expect(mocks.registerDevicePasskey).toHaveBeenCalledWith('iPhone (Face ID)'));
    expect(await screen.findByText('iPhone (Face ID)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
  });

  it('removes a passkey after confirmation', async () => {
    mocks.listDevicePasskeys.mockResolvedValue([
      { id: 'pk1', friendlyName: 'iPhone (Face ID)', createdAt: '2026-11-22T20:00:00Z' },
    ]);
    mocks.removeDevicePasskey.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PasskeyLoginCard />);
    const remove = await screen.findByRole('button', { name: /Remove/i });
    fireEvent.click(remove);
    await waitFor(() => expect(mocks.removeDevicePasskey).toHaveBeenCalledWith('pk1'));
  });

  it('surfaces a friendly message when enrollment fails', async () => {
    mocks.registerDevicePasskey.mockResolvedValue({ ok: false, error: { code: 'webauthn_credential_not_found' } });
    render(<PasskeyLoginCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Turn on Face ID/i }));
    expect(await screen.findByText('error:webauthn_credential_not_found')).toBeInTheDocument();
  });

  it('hides itself while passkeys are switched off on the server', async () => {
    mocks.listDevicePasskeys.mockRejectedValue({ code: 'passkey_disabled' });
    render(<PasskeyLoginCard />);
    await waitFor(() => expect(mocks.listDevicePasskeys).toHaveBeenCalled());
    expect(screen.queryByText('Face ID sign-in')).not.toBeInTheDocument();
  });
});
