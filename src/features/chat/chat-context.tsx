/**
 * ChatContext — Global chat attention-state model
 * 
 * Tracks: active conversation, active module, window focus, scroll position.
 * Used by notification system to suppress badges when user is actively viewing.
 * Supports deep-linking via targetConversationId + anchorMessageId.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface ChatState {
  activeConversationId: string | null;
  inChatModule: boolean;
  isTabFocused: boolean;
  isAtBottom: boolean;
  anchorMessageId: string | null;
  targetConversationId: string | null;
}

interface ChatContextValue extends ChatState {
  setActiveConversation: (id: string | null) => void;
  setInChatModule: (v: boolean) => void;
  setIsAtBottom: (v: boolean) => void;
  navigateToMessage: (conversationId: string, messageId?: string) => void;
  clearAnchor: () => void;
  shouldSuppressNotification: (conversationId: string) => boolean;
}

const ChatCtx = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>({
    activeConversationId: null,
    inChatModule: false,
    isTabFocused: true,
    isAtBottom: true,
    anchorMessageId: null,
    targetConversationId: null,
  });

  useEffect(() => {
    const onFocus = () => setState(s => ({ ...s, isTabFocused: true }));
    const onBlur = () => setState(s => ({ ...s, isTabFocused: false }));
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    setState(s => ({ ...s, isTabFocused: document.hasFocus() }));
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const setActiveConversation = useCallback((id: string | null) => {
    setState(s => ({ ...s, activeConversationId: id }));
  }, []);

  const setInChatModule = useCallback((v: boolean) => {
    setState(s => ({ ...s, inChatModule: v }));
  }, []);

  const setIsAtBottom = useCallback((v: boolean) => {
    setState(s => ({ ...s, isAtBottom: v }));
  }, []);

  const navigateToMessage = useCallback((conversationId: string, messageId?: string) => {
    setState(s => ({
      ...s,
      targetConversationId: conversationId,
      anchorMessageId: messageId || null,
    }));
  }, []);

  const clearAnchor = useCallback(() => {
    setState(s => ({ ...s, anchorMessageId: null, targetConversationId: null }));
  }, []);

  const shouldSuppressNotification = useCallback((conversationId: string): boolean => {
    return (
      state.inChatModule &&
      state.activeConversationId === conversationId &&
      state.isTabFocused &&
      state.isAtBottom
    );
  }, [state.inChatModule, state.activeConversationId, state.isTabFocused, state.isAtBottom]);

  return (
    <ChatCtx.Provider value={{
      ...state,
      setActiveConversation,
      setInChatModule,
      setIsAtBottom,
      navigateToMessage,
      clearAnchor,
      shouldSuppressNotification,
    }}>
      {children}
    </ChatCtx.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function useChatContextSafe(): ChatContextValue | null {
  return useContext(ChatCtx);
}
