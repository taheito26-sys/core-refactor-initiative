/**
 * Mobile install context detection for the Parent Order Fulfillment feature.
 *
 * Detects whether the user is on a mobile browser, whether the app is already
 * installed (PWA or native), which platform they're on, and whether the native
 * Android install prompt is available.
 *
 * Reuses existing platform detection from `@/platform/runtime`.
 */

import { isNativeApp, isInstalledPwa } from '@/platform/runtime';
import type { MobileInstallContext, InstallPromptState } from './types';

// ── BeforeInstallPromptEvent capture ─────────────────────────────────

/**
 * The browser's `BeforeInstallPromptEvent`, captured at the module level so it
 * can be triggered later when the user taps "Install".
 */
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

/**
 * Store a `BeforeInstallPromptEvent` for later use.
 * Typically called from a global `window.addEventListener('beforeinstallprompt', …)`.
 */
export function captureInstallPrompt(event: BeforeInstallPromptEvent): void {
  deferredInstallPrompt = event;
}

/**
 * Retrieve the currently stored `BeforeInstallPromptEvent`, or `null` if none
 * has been captured (or it has already been consumed).
 */
export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

/**
 * Clear the stored `BeforeInstallPromptEvent` after it has been used.
 */
export function consumeInstallPrompt(): void {
  deferredInstallPrompt = null;
}

// ── Platform derivation ──────────────────────────────────────────────

function derivePlatform(): MobileInstallContext['platform'] {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

// ── Prompt state derivation ──────────────────────────────────────────

function derivePromptState(
  isInstalled: boolean,
  isMobileBrowser: boolean,
): InstallPromptState {
  if (isInstalled || !isMobileBrowser) return 'not_applicable';

  if (
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('install_prompt_dismissed') === 'true'
  ) {
    return 'dismissed';
  }

  return 'pending';
}

// ── Main detection function ──────────────────────────────────────────

/**
 * Detect the current mobile install context.
 *
 * Postconditions (from design spec):
 * - `isMobileBrowser` = `window.innerWidth < 768 AND !isNativeApp()`
 * - `isInstalled` = `isInstalledPwa() || isNativeApp()`
 * - `platform` derived from `navigator.userAgent`
 * - `nativePromptAvailable` = true iff a `BeforeInstallPromptEvent` has been
 *   captured and not yet consumed
 * - `promptState` follows the three-way mapping
 */
export function detectMobileInstallContext(): MobileInstallContext {
  const native = isNativeApp();
  const pwa = isInstalledPwa();

  const isMobileBrowser =
    typeof window !== 'undefined' && window.innerWidth < 768 && !native;

  const isInstalled = pwa || native;

  const platform = derivePlatform();

  const nativePromptAvailable = deferredInstallPrompt !== null;

  const promptState = derivePromptState(isInstalled, isMobileBrowser);

  return {
    isMobileBrowser,
    isInstalled,
    platform,
    promptState,
    nativePromptAvailable,
  };
}
