// ─── usePrivacyGuard — Phases 6, 8, 9, 10, 14 ──────────────────────────
// Hooks for screenshot detection, window blur protection, copy blocking

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  detectScreenshotKeys,
  detectWindowBlur,
  applyScreenshotProtection,
  removeScreenshotProtection,
  logPrivacyEvent,
} from '../lib/privacy-engine';

interface UsePrivacyGuardOptions {
  userId: string;
  roomId?: string | null;
  screenshotProtection?: boolean;
  copyProtection?: boolean;
  blurOnLoseFocus?: boolean;
}

export function usePrivacyGuard({
  userId,
  roomId,
  screenshotProtection = false,
  copyProtection = false,
  blurOnLoseFocus = false,
}: UsePrivacyGuardOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isBlurred, setIsBlurred] = useState(false);
  const [screenshotDetected, setScreenshotDetected] = useState(false);

  // Phase 6: Screenshot key detection
  useEffect(() => {
    if (!screenshotProtection) return;
    return detectScreenshotKeys(() => {
      setScreenshotDetected(true);
      logPrivacyEvent(userId, 'screenshot_detected', roomId, {
        user_agent: navigator.userAgent,
      });
      // Auto-dismiss after 3s
      setTimeout(() => setScreenshotDetected(false), 3000);
    });
  }, [screenshotProtection, userId, roomId]);

  // Phase 8: CSS protection on container
  useEffect(() => {
    if (!screenshotProtection && !copyProtection) return;
    const el = containerRef.current;
    if (el) applyScreenshotProtection(el);
    return () => { if (el) removeScreenshotProtection(el); };
  }, [screenshotProtection, copyProtection]);

  // Phase 9: Blur content when window loses focus
  useEffect(() => {
    if (!blurOnLoseFocus) return;
    return detectWindowBlur(
      () => {
        setIsBlurred(true);
        logPrivacyEvent(userId, 'window_blur_protection', roomId, { action: 'blur' });
      },
      () => setIsBlurred(false),
    );
  }, [blurOnLoseFocus, userId, roomId]);

  // Phase 14: Block copy shortcuts
  useEffect(() => {
    if (!copyProtection) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        logPrivacyEvent(userId, 'copy_blocked', roomId);
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [copyProtection, userId, roomId]);

  return {
    containerRef,
    isBlurred,
    screenshotDetected,
  };
}

// ── Phase 11: View-once message hook ────────────────────────────────────
export function useViewOnceGuard(messageId: string | null, viewOnce: boolean, userId: string) {
  const [viewed, setViewed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10); // 10 second view window

  useEffect(() => {
    if (!messageId || !viewOnce || viewed) return;
    // Start countdown when message is viewed
    setViewed(true);
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(interval);
          logPrivacyEvent(userId, undefined, 'view_once_expired', { messageId });
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [messageId, viewOnce, userId, viewed]);

  return { viewed, timeLeft, isExpired: viewed && timeLeft <= 0 };
}

// ── Phase 15: Read receipt privacy hook ──────────────────────────────────
export function useReadReceiptPrivacy() {
  const [hideReadReceipts, setHideReadReceipts] = useState(() => {
    try { return localStorage.getItem('privacy_hide_read_receipts') === 'true'; } catch { return false; }
  });
  const [hideLastSeen, setHideLastSeen] = useState(() => {
    try { return localStorage.getItem('privacy_hide_last_seen') === 'true'; } catch { return false; }
  });
  const [hideTyping, setHideTyping] = useState(() => {
    try { return localStorage.getItem('privacy_hide_typing') === 'true'; } catch { return false; }
  });

  const toggleReadReceipts = useCallback(() => {
    setHideReadReceipts((v) => {
      const next = !v;
      try { localStorage.setItem('privacy_hide_read_receipts', String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const toggleLastSeen = useCallback(() => {
    setHideLastSeen((v) => {
      const next = !v;
      try { localStorage.setItem('privacy_hide_last_seen', String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const toggleTyping = useCallback(() => {
    setHideTyping((v) => {
      const next = !v;
      try { localStorage.setItem('privacy_hide_typing', String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  return {
    hideReadReceipts,
    hideLastSeen,
    hideTyping,
    toggleReadReceipts,
    toggleLastSeen,
    toggleTyping,
  };
}
