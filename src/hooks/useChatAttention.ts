/* ═══════════════════════════════════════════════════════════════
   Chat Attention Hook — window focus, scroll position, module awareness
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatStore } from '@/lib/chat-store';

/**
 * Registers global listeners for the attention model.
 * Call this once in your top-level chat container (ChatPage).
 *
 * Returns a ref callback to attach to the message list scroll container.
 */
export function useChatAttention() {
  const location = useLocation();
  const setAttention = useChatStore((s) => s.setAttention);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Track whether user is on /chat route ───────────────────────
  useEffect(() => {
    const inChat = location.pathname === '/chat';
    setAttention({ inChatModule: inChat });
    if (!inChat) {
      setAttention({ activeConversationVisible: false });
    }
  }, [location.pathname, setAttention]);

  // ── Track window focus / blur ──────────────────────────────────
  useEffect(() => {
    const onFocus = () => setAttention({ appFocused: true });
    const onBlur = () => setAttention({ appFocused: false });

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // Handle visibility change (tab switch, minimize)
    const onVisibility = () => {
      setAttention({ appFocused: document.visibilityState === 'visible' });
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Set initial state
    setAttention({ appFocused: document.hasFocus() });

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [setAttention]);

  // ── Track scroll position (near bottom = visible) ──────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAttention({ activeConversationVisible: nearBottom });
  }, [setAttention]);

  // Attach scroll listener when ref changes
  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      // Remove old listener
      if (scrollRef.current) {
        scrollRef.current.removeEventListener('scroll', handleScroll);
      }
      scrollRef.current = el;
      if (el) {
        el.addEventListener('scroll', handleScroll, { passive: true });
        // Check initial state
        handleScroll();
      }
    },
    [handleScroll]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        scrollRef.current.removeEventListener('scroll', handleScroll);
      }
    };
  }, [handleScroll]);

  // Reset visible state when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      // Assume visible until scroll proves otherwise
      setAttention({ activeConversationVisible: true });
    }
  }, [activeConversationId, setAttention]);

  return { setScrollRef, scrollRef };
}

/**
 * Determine if an incoming message should be suppressed (not counted as unread).
 * Pure function — reads store state directly.
 */
export function shouldSuppressMessage(relationshipId: string): boolean {
  const s = useChatStore.getState();
  return (
    s.attention.appFocused &&
    s.attention.inChatModule &&
    s.attention.activeConversationVisible &&
    s.activeConversationId === relationshipId
  );
}
