/**
 * A device-level preference: once the user turns push off on this device, the
 * app must not silently re-register on the next launch. Signing out does not
 * change it, so the choice survives account switches on the same device.
 */
export const PUSH_OPT_OUT_KEY = 'push_device_opt_out';

export function isPushOptedOut(): boolean {
  try {
    return localStorage.getItem(PUSH_OPT_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPushOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(PUSH_OPT_OUT_KEY, 'true');
    else localStorage.removeItem(PUSH_OPT_OUT_KEY);
  } catch {
    // Storage restrictions only affect this preference, not delivery.
  }
}
