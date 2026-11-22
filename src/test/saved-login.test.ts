import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSavedLogin,
  getRememberedIdentifier,
  getRememberPreference,
  loadSavedLogin,
  saveLogin,
} from '@/lib/saved-login';

const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('saved login store', () => {
  it('remembers the identifier and trims it', async () => {
    await saveLogin('  merchant@example.com  ', PASSWORD, false);
    expect(getRememberedIdentifier()).toBe('merchant@example.com');
    expect(getRememberPreference()).toBe(false);
    const saved = await loadSavedLogin();
    expect(saved?.identifier).toBe('merchant@example.com');
    expect(saved?.password).toBe('');
  });

  it('never writes the password in clear text', async () => {
    await saveLogin('customer01', PASSWORD, true);
    const raw = localStorage.getItem('saved-login-v1') ?? '';
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain('password');
  });

  it('drops the stored password when the user opts out', async () => {
    await saveLogin('customer01', PASSWORD, true);
    await saveLogin('customer01', PASSWORD, false);
    const saved = await loadSavedLogin();
    expect(saved?.password).toBe('');
    expect(saved?.remember).toBe(false);
  });

  it('defaults to remembering when nothing is stored', () => {
    expect(getRememberedIdentifier()).toBe('');
    expect(getRememberPreference()).toBe(true);
  });

  it('clears everything on request', async () => {
    await saveLogin('customer01', PASSWORD, true);
    clearSavedLogin();
    expect(getRememberedIdentifier()).toBe('');
    expect(await loadSavedLogin()).toBeNull();
  });
});
