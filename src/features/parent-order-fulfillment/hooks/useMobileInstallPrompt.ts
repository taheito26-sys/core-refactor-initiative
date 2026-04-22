/**
 * Hook: useMobileInstallPrompt
 *
 * Detects the mobile install context, listens for the `beforeinstallprompt`
 * event, re-detects on window resize (debounced), and exposes actions to
 * trigger the native install prompt or dismiss the banner for the session.
 *
 * Requirements: 9.1–9.9, 10.1–10.7
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MobileInstallContext } from '../types';
import {
  detectMobileInstallContext,
  captureInstallPrompt,
  getDeferredInstallPrompt,
  consumeInstallPrompt,
} from '../mobileInstall';

const SESSION_DISMISS_KEY = 'install_prompt_dismissed';

export interface UseMobileInstallPromptReturn {
  /** Current mobile install context. */
  context: MobileInstallContext;
  /** Whether the install banner should be shown. */
  shouldShow: boolean;
  /** Trigger the native install prompt (Android) or no-op (iOS — component shows instructions). */
  triggerInstall: () => Promise<void>;
  /** Dismiss the banner for the remainder of the session. */
  dismiss: () => void;
}

export function useMobileInstallPrompt(): UseMobileInstallPromptReturn {
  const [context, setContext] = useState<MobileInstallContext>(
    detectMobileInstallContext,
  );

  // Track whether the user has dismissed the banner in this hook instance.
  const [dismissed, setDismissed] = useState(false);

  // ── Listen for `beforeinstallprompt` and capture it ──
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      captureInstallPrompt(event as BeforeInstallPromptEvent);
      setContext(detectMobileInstallContext());
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // ── Re-detect on window resize (debounced 300ms) ──
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        setContext(detectMobileInstallContext());
      }, 300);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
    };
  }, []);

  // ── triggerInstall ──
  const triggerInstall = useCallback(async () => {
    const current = detectMobileInstallContext();

    if (current.platform === 'android' && current.nativePromptAvailable) {
      const prompt = getDeferredInstallPrompt();
      if (prompt) {
        await prompt.prompt();
        consumeInstallPrompt();
        setContext(detectMobileInstallContext());
      }
    }
  }, []);

  // ── dismiss ──
  const dismiss = useCallback(() => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_DISMISS_KEY, 'true');
    }
    setDismissed(true);
    setContext(detectMobileInstallContext());
  }, []);

  const shouldShow = !dismissed && context.promptState === 'pending';

  return { context, shouldShow, triggerInstall, dismiss };
}
