// ─── Unified Chat Store ────────────────────────────────────────────────────
import { create } from 'zustand';
import type { ChatRoomListItem, PresenceStatus } from '@/features/chat/types';

export interface NotificationNavTarget {
  conversationId: string;     // room_id
  messageId: string | null;
  notificationId: string;
}

export interface AttentionState {
  appFocused: boolean;
  inChatModule: boolean;
  activeConversationVisible: boolean;
}

interface ChatState {
  // navigation
  activeRoomId: string | null;
  /** @deprecated use activeRoomId */
  activeConversationId: string | null;
  activeMessageAnchor: string | null;
  highlightMessageId: string | null;
  pendingNotificationNav: NotificationNavTarget | null;
  pendingNotificationNavVersion: number;

  // rooms cache (populated by useRooms hook)
  rooms: ChatRoomListItem[];

  // per-room unread counts
  unreadCounts: Record<string, number>;
  lastReadByConversation: Record<string, string | null>;

  // presence  (user_id → status)
  presenceByUser: Record<string, PresenceStatus>;

  // typing   (room_id → user_ids currently typing)
  typingByRoom: Record<string, string[]>;
  /** @deprecated use typingByRoom */
  typingByConversation: Record<string, string[]>;

  // attention: suppresses notifications when user is already reading
  attention: AttentionState;

  // calls
  activeCallId: string | null;
  incomingCallId: string | null;
  incomingCallRoomId: string | null;
}

interface ChatActions {
  // navigation
  setActiveRoom: (id: string | null) => void;
  /** @deprecated use setActiveRoom */
  setActiveConversation: (id: string | null) => void;
  setAnchor: (messageId: string | null) => void;
  clearHighlight: () => void;
  setPendingNav: (target: NotificationNavTarget | null) => void;

  // rooms
  setRooms: (rooms: ChatRoomListItem[]) => void;
  patchRoom: (roomId: string, patch: Partial<ChatRoomListItem>) => void;
  bumpRoom: (roomId: string, preview: string, at: string) => void;

  // unread
  setUnreadCount: (roomId: string, count: number) => void;
  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
  clearAllUnread: () => void;
  setUnreadCounts: (counts: Record<string, number>) => void;
  markConversationRead: (roomId: string, lastMsgId: string) => void;

  // presence / typing
  setPresence: (userId: string, status: PresenceStatus) => void;
  setTypingUsers: (roomId: string, userIds: string[]) => void;
  setTyping: (roomId: string, users: string[]) => void;

  // calls
  setActiveCallId: (id: string | null) => void;
  setIncomingCall: (callId: string | null, roomId: string | null) => void;

  // attention
  setAttention: (partial: Partial<AttentionState>) => void;

  reset: () => void;
}

const initialState: ChatState = {
  activeRoomId: null,
  activeConversationId: null,
  activeMessageAnchor: null,
  highlightMessageId: null,
  pendingNotificationNav: null,
  pendingNotificationNavVersion: 0,
  rooms: [],
  unreadCounts: {},
  lastReadByConversation: {},
  presenceByUser: {},
  typingByRoom: {},
  typingByConversation: {},
  attention: {
    appFocused: true,
    inChatModule: false,
    activeConversationVisible: false,
  },
  activeCallId: null,
  incomingCallId: null,
  incomingCallRoomId: null,
};

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  ...initialState,

  // ── navigation ─────────────────────────────────────────────────────────
  setActiveRoom: (id) =>
    set({
      activeRoomId: id,
      activeConversationId: id,  // compat
      activeMessageAnchor: null,
      highlightMessageId: null,
    }),

  setActiveConversation: (id) => get().setActiveRoom(id),

  setAnchor: (messageId) =>
    set({ activeMessageAnchor: messageId, highlightMessageId: messageId }),

  clearHighlight: () => set({ highlightMessageId: null }),

  setPendingNav: (target) =>
    set((s) => ({
      pendingNotificationNav:        target,
      pendingNotificationNavVersion: s.pendingNotificationNavVersion + 1,
    })),

  // ── rooms ───────────────────────────────────────────────────────────────
  setRooms: (rooms) => set({ rooms }),

  patchRoom: (roomId, patch) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.room_id === roomId ? { ...r, ...patch } : r)),
    })),

  bumpRoom: (roomId, preview, at) =>
    set((s) => ({
      rooms: s.rooms
        .map((r) =>
          r.room_id === roomId
            ? { ...r, last_message_preview: preview, last_message_at: at }
            : r,
        )
        .sort((a, b) => {
          const ta = a.last_message_at ?? '';
          const tb = b.last_message_at ?? '';
          return tb > ta ? 1 : -1;
        }),
    })),

  // ── unread ──────────────────────────────────────────────────────────────
  setUnreadCount: (roomId, count) =>
    set((s) => ({ unreadCounts: { ...s.unreadCounts, [roomId]: count } })),

  incrementUnread: (roomId) =>
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [roomId]: (s.unreadCounts[roomId] ?? 0) + 1,
      },
    })),

  clearUnread: (roomId) =>
    set((s) => ({ unreadCounts: { ...s.unreadCounts, [roomId]: 0 } })),

  clearAllUnread: () => set({ unreadCounts: {} }),

  setUnreadCounts: (counts) => set({ unreadCounts: counts }),

  markConversationRead: (roomId, lastMsgId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [roomId]: 0 },
      lastReadByConversation: { ...s.lastReadByConversation, [roomId]: lastMsgId },
    })),

  // ── presence / typing ───────────────────────────────────────────────────
  setPresence: (userId, status) =>
    set((s) => ({ presenceByUser: { ...s.presenceByUser, [userId]: status } })),

  setTypingUsers: (roomId, userIds) =>
    set((s) => ({
      typingByRoom:         { ...s.typingByRoom,         [roomId]: userIds },
      typingByConversation: { ...s.typingByConversation, [roomId]: userIds },  // compat
    })),

  setTyping: (roomId, users) => get().setTypingUsers(roomId, users),

  // ── calls ────────────────────────────────────────────────────────────────
  setActiveCallId: (id) => set({ activeCallId: id }),
  setIncomingCall: (callId, roomId) =>
    set({ incomingCallId: callId, incomingCallRoomId: roomId }),

  // ── attention ────────────────────────────────────────────────────────────
  setAttention: (partial) =>
    set((s) => ({ attention: { ...s.attention, ...partial } })),

  reset: () => set(initialState),
}));

// ── Selectors ───────────────────────────────────────────────────────────────
export const totalUnread = (state: ChatState & ChatActions) =>
  Object.values(state.unreadCounts).reduce((sum, n) => sum + n, 0);

export const typingUsersInRoom = (roomId: string) =>
  (state: ChatState & ChatActions) => state.typingByRoom[roomId] ?? [];

export const presenceOf = (userId: string) =>
  (state: ChatState & ChatActions): PresenceStatus =>
    state.presenceByUser[userId] ?? 'offline';

/** Used by notification-router to suppress in-view chat notifications */
export function isViewingConversationMessage(
  state: Pick<ChatState, 'attention' | 'activeRoomId' | 'activeConversationId'>,
  roomId: string,
): boolean {
  return (
    state.attention.appFocused &&
    state.attention.inChatModule &&
    state.attention.activeConversationVisible &&
    (state.activeRoomId === roomId || state.activeConversationId === roomId)
  );
}
