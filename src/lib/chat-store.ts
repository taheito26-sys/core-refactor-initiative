/* ═══════════════════════════════════════════════════════════════
   Chat Store — Zustand-based central state for the entire chat system
   ═══════════════════════════════════════════════════════════════ */

import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────

export interface ConversationSummary {
  relationship_id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code?: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  unread_count: number;
  is_muted: boolean;
  is_pinned: boolean;
}

export interface ChatMessage {
  id: string;
  relationship_id: string;
  sender_id: string;
  content: string;
  msg_type?: string;
  read_at: string | null;
  delivered_at?: string | null;
  created_at: string;
  _pending?: boolean;
}

export interface NotificationNavTarget {
  conversationId: string;
  messageId: string | null;
  notificationId: string;
}

export interface AttentionState {
  appFocused: boolean;
  inChatModule: boolean;
  activeConversationVisible: boolean; // message list scrolled near bottom
}

// ── Store shape ──────────────────────────────────────────────────

interface ChatState {
  // Routing
  activeConversationId: string | null;
  activeMessageAnchor: string | null;
  highlightMessageId: string | null;

  // Unread (key = relationship_id)
  unreadCounts: Record<string, number>;
  lastReadByConversation: Record<string, string | null>;

  // Presence (key = user_id)
  presenceByUser: Record<string, 'online' | 'away' | 'offline'>;

  // Typing (key = relationship_id)
  typingByConversation: Record<string, string[]>;

  // Attention
  attention: AttentionState;

  // Notification navigation queue
  pendingNotificationNav: NotificationNavTarget | null;
}

interface ChatActions {
  // Conversation routing
  setActiveConversation: (id: string | null) => void;
  setAnchor: (messageId: string | null) => void;
  clearHighlight: () => void;

  // Attention
  setAttention: (partial: Partial<AttentionState>) => void;

  // Unread
  setUnreadCount: (relationshipId: string, count: number) => void;
  incrementUnread: (relationshipId: string) => void;
  markConversationRead: (relationshipId: string, lastMsgId: string) => void;
  clearAllUnread: () => void;
  setUnreadCounts: (counts: Record<string, number>) => void;

  // Presence / typing
  setPresence: (userId: string, status: 'online' | 'away' | 'offline') => void;
  setTyping: (relationshipId: string, users: string[]) => void;

  // Notification navigation
  setPendingNav: (target: NotificationNavTarget | null) => void;
  consumePendingNav: () => NotificationNavTarget | null;

  // Reset
  reset: () => void;
}

const initialState: ChatState = {
  activeConversationId: null,
  activeMessageAnchor: null,
  highlightMessageId: null,
  unreadCounts: {},
  lastReadByConversation: {},
  presenceByUser: {},
  typingByConversation: {},
  attention: {
    appFocused: true,
    inChatModule: false,
    activeConversationVisible: true,
  },
  pendingNotificationNav: null,
};

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  ...initialState,

  // ── Conversation routing ───────────────────────────────────────

  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      activeMessageAnchor: null,
      highlightMessageId: null,
    }),

  setAnchor: (messageId) =>
    set({
      activeMessageAnchor: messageId,
      highlightMessageId: messageId,
    }),

  clearHighlight: () =>
    set({ highlightMessageId: null }),

  // ── Attention ──────────────────────────────────────────────────

  setAttention: (partial) =>
    set((s) => ({ attention: { ...s.attention, ...partial } })),

  // ── Unread ─────────────────────────────────────────────────────

  setUnreadCount: (relationshipId, count) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [relationshipId]: count },
    })),

  incrementUnread: (relationshipId) =>
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [relationshipId]: (s.unreadCounts[relationshipId] || 0) + 1,
      },
    })),

  markConversationRead: (relationshipId, lastMsgId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [relationshipId]: 0 },
      lastReadByConversation: {
        ...s.lastReadByConversation,
        [relationshipId]: lastMsgId,
      },
    })),

  clearAllUnread: () => set({ unreadCounts: {} }),

  setUnreadCounts: (counts) => set({ unreadCounts: counts }),

  // ── Presence / typing ──────────────────────────────────────────

  setPresence: (userId, status) =>
    set((s) => ({
      presenceByUser: { ...s.presenceByUser, [userId]: status },
    })),

  setTyping: (relationshipId, users) =>
    set((s) => ({
      typingByConversation: { ...s.typingByConversation, [relationshipId]: users },
    })),

  // ── Notification navigation ────────────────────────────────────

  setPendingNav: (target) => set({ pendingNotificationNav: target }),

  consumePendingNav: () => {
    const target = get().pendingNotificationNav;
    if (target) set({ pendingNotificationNav: null });
    return target;
  },

  // ── Reset ──────────────────────────────────────────────────────

  reset: () => set(initialState),
}));

// ── Selectors (convenience) ──────────────────────────────────────

export const selectTotalUnread = (s: ChatState) =>
  Object.values(s.unreadCounts).reduce((sum, n) => sum + n, 0);

export const selectConversationUnread = (relationshipId: string) =>
  (s: ChatState) => s.unreadCounts[relationshipId] || 0;

export const selectIsConversationActive = (relationshipId: string) =>
  (s: ChatState) => s.activeConversationId === relationshipId;

/** True when incoming message should be suppressed (not counted as unread) */
export const selectShouldSuppressUnread = (relationshipId: string) =>
  (s: ChatState & ChatActions) =>
    s.attention.appFocused &&
    s.attention.inChatModule &&
    s.attention.activeConversationVisible &&
    s.activeConversationId === relationshipId;
