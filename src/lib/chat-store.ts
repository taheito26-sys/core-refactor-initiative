import { create } from 'zustand';

export interface NotificationNavTarget {
  conversationId: string;
  messageId: string | null;
  notificationId: string;
}

export interface ConversationSummary {
  id: string;
  counterparty_name: string;
  counterparty_nickname?: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
}

export interface ChatMessage {
  id: string;
  relationship_id: string;
  sender_id: string;
  content: string;
  msg_type: string;
  created_at: string;
  read_at: string | null;
  metadata?: Record<string, unknown>;
  reply_to?: string | null;
  sender_name?: string;
}

export interface AttentionState {
  appFocused: boolean;
  inChatModule: boolean;
  activeConversationVisible: boolean;
}

interface ChatState {
  activeConversationId: string | null;
  activeMessageAnchor: string | null;
  highlightMessageId: string | null;
  unreadCounts: Record<string, number>;
  lastReadByConversation: Record<string, string | null>;
  presenceByUser: Record<string, 'online' | 'away' | 'offline'>;
  typingByConversation: Record<string, string[]>;
  attention: AttentionState;
  pendingNotificationNav: NotificationNavTarget | null;
  pendingNotificationNavVersion: number;
}

interface ChatActions {
  setActiveConversation: (id: string | null) => void;
  setAnchor: (messageId: string | null) => void;
  clearHighlight: () => void;
  setAttention: (partial: Partial<AttentionState>) => void;
  setUnreadCount: (relationshipId: string, count: number) => void;
  incrementUnread: (relationshipId: string) => void;
  markConversationRead: (relationshipId: string, lastMsgId: string) => void;
  clearAllUnread: () => void;
  setUnreadCounts: (counts: Record<string, number>) => void;
  setPresence: (userId: string, status: 'online' | 'away' | 'offline') => void;
  setTyping: (relationshipId: string, users: string[]) => void;
  setPendingNav: (target: NotificationNavTarget | null) => void;
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
    activeConversationVisible: false,
  },
  pendingNotificationNav: null,
  pendingNotificationNavVersion: 0,
};

export const useChatStore = create<ChatState & ChatActions>()((set) => ({
  ...initialState,
  setActiveConversation: (id) => set((s) => {
    if (s.activeConversationId === id) return s;
    return { activeConversationId: id, activeMessageAnchor: null, highlightMessageId: null };
  }),
  setAnchor: (messageId) => set({ activeMessageAnchor: messageId, highlightMessageId: messageId }),
  clearHighlight: () => set({ highlightMessageId: null }),
  setAttention: (partial) => set((s) => {
    // Basic avoid-redundant-render check
    const hasChange = Object.entries(partial).some(([k, v]) => (s.attention as any)[k] !== v);
    if (!hasChange) return s;
    return { attention: { ...s.attention, ...partial } };
  }),
  setUnreadCount: (relationshipId, count) => set((s) => ({ unreadCounts: { ...s.unreadCounts, [relationshipId]: count } })),
  incrementUnread: (relationshipId) => set((s) => ({ unreadCounts: { ...s.unreadCounts, [relationshipId]: (s.unreadCounts[relationshipId] || 0) + 1 } })),
  markConversationRead: (relationshipId, lastMsgId) => set((s) => ({
    unreadCounts: { ...s.unreadCounts, [relationshipId]: 0 },
    lastReadByConversation: { ...s.lastReadByConversation, [relationshipId]: lastMsgId },
  })),
  clearAllUnread: () => set({ unreadCounts: {} }),
  setUnreadCounts: (counts) => set({ unreadCounts: counts }),
  setPresence: (userId, status) => set((s) => ({ presenceByUser: { ...s.presenceByUser, [userId]: status } })),
  setTyping: (relationshipId, users) => set((s) => ({ typingByConversation: { ...s.typingByConversation, [relationshipId]: users } })),
  setPendingNav: (target) => set((s) => ({ pendingNotificationNav: target, pendingNotificationNavVersion: s.pendingNotificationNavVersion + 1 })),
  reset: () => set(initialState),
}));

export const selectTotalUnread = (s: ChatState) => Object.values(s.unreadCounts).reduce((sum, n) => sum + n, 0);
export const selectConversationUnread = (relationshipId: string) => (s: ChatState) => s.unreadCounts[relationshipId] || 0;
export const selectIsConversationActive = (relationshipId: string) => (s: ChatState) => s.activeConversationId === relationshipId;

export const isViewingConversationMessage = (
  state: Pick<ChatState, 'activeConversationId' | 'attention'>,
  conversationId: string,
  _messageId?: string | null,
): boolean => (
  state.activeConversationId === conversationId
  && state.attention.appFocused
  && state.attention.inChatModule
  && state.attention.activeConversationVisible
);

export const selectShouldSuppressUnread = (relationshipId: string) => (s: ChatState) =>
  isViewingConversationMessage(s, relationshipId);
