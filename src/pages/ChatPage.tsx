import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

type ConversationSection = 'Chat' | 'Approvals' | 'Settlements' | 'Agreements' | 'System' | 'Direct Messages';
type MessageType = 'text' | 'image' | 'file' | 'voice' | 'system event' | 'approval' | 'settlement' | 'agreement';
type MessageStatus = 'sent' | 'delivered' | 'seen' | 'failed';
type ReadState = 'unread' | 'read';
type PresenceStatus = 'online' | 'offline' | 'last seen' | 'typing';

interface Conversation {
  conversation_id: string;
  participants: string[];
  last_message_id: string;
  unread_count: number;
  status: string;
  name: string;
  avatar: string;
  section: ConversationSection;
  relatedOrder: string;
  agreementType: string;
  settlementStatus: string;
  approvalState: string;
  merchantProfile: string;
  transactionMetadata: string;
}

interface Message {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  timestamp: number;
  status: MessageStatus;
  read_state: ReadState;
  type: MessageType;
  mine: boolean;
  pendingRetry?: boolean;
}

interface Notification {
  notification_id: string;
  conversation_id: string;
  message_id: string;
  user_id: string;
  read_state: ReadState;
  timestamp: number;
}

const CURRENT_USER_ID = 'me';

const sections: ConversationSection[] = ['Chat', 'Approvals', 'Settlements', 'Agreements', 'System', 'Direct Messages'];

const avatarById: Record<string, string> = {
  c1: '🧑‍💼',
  c2: '🧕',
  c3: '🧑‍💻',
  c4: '🏦',
  c5: '🧾',
  c6: '👤',
};

const seedConversations: Conversation[] = [
  {
    conversation_id: 'c1', participants: ['me', 'zack'], last_message_id: 'm-c1-15', unread_count: 2, status: 'active', name: 'Zack Trading', avatar: avatarById.c1,
    section: 'Chat', relatedOrder: 'ORD-1198', agreementType: 'Spot', settlementStatus: 'Pending', approvalState: 'Awaiting', merchantProfile: 'Tier A / Doha', transactionMetadata: 'USDT-QAR · P2P'
  },
  {
    conversation_id: 'c2', participants: ['me', 'mohamed'], last_message_id: 'm-c2-8', unread_count: 0, status: 'active', name: 'Mohamed', avatar: avatarById.c2,
    section: 'Direct Messages', relatedOrder: 'ORD-1204', agreementType: 'Split 60/40', settlementStatus: 'Completed', approvalState: 'Approved', merchantProfile: 'Tier B / Lusail', transactionMetadata: 'USDT-QAR · OTC'
  },
  {
    conversation_id: 'c3', participants: ['me', 'approvals-bot'], last_message_id: 'm-c3-5', unread_count: 1, status: 'active', name: 'Approvals Queue', avatar: avatarById.c3,
    section: 'Approvals', relatedOrder: 'APR-550', agreementType: 'Policy', settlementStatus: 'N/A', approvalState: 'Open', merchantProfile: 'System', transactionMetadata: 'Rule Engine v2'
  },
  {
    conversation_id: 'c4', participants: ['me', 'settlement-desk'], last_message_id: 'm-c4-7', unread_count: 0, status: 'active', name: 'Settlement Desk', avatar: avatarById.c4,
    section: 'Settlements', relatedOrder: 'SET-032', agreementType: 'Bank Wire', settlementStatus: 'In Progress', approvalState: 'N/A', merchantProfile: 'Treasury', transactionMetadata: 'QNB Settlement Rail'
  },
  {
    conversation_id: 'c5', participants: ['me', 'agreement-bot'], last_message_id: 'm-c5-4', unread_count: 0, status: 'active', name: 'Agreement Updates', avatar: avatarById.c5,
    section: 'Agreements', relatedOrder: 'AGR-1009', agreementType: 'Master', settlementStatus: 'N/A', approvalState: 'N/A', merchantProfile: 'Legal', transactionMetadata: 'Clause Set 4.1'
  },
  {
    conversation_id: 'c6', participants: ['me', 'system'], last_message_id: 'm-c6-3', unread_count: 0, status: 'active', name: 'System', avatar: avatarById.c6,
    section: 'System', relatedOrder: 'N/A', agreementType: 'N/A', settlementStatus: 'N/A', approvalState: 'N/A', merchantProfile: 'Platform', transactionMetadata: 'Notification bus'
  },
];

function generateMessages(conversationId: string, count: number): Message[] {
  const list: Message[] = [];
  const now = Date.now();
  for (let i = 1; i <= count; i++) {
    const mine = i % 3 === 0;
    list.push({
      message_id: `m-${conversationId}-${i}`,
      conversation_id: conversationId,
      sender_id: mine ? CURRENT_USER_ID : `${conversationId}-remote`,
      content: i % 11 === 0 ? `Attachment invoice-${i}.pdf` : i % 7 === 0 ? `Voice memo #${i}` : `Message ${i} in ${conversationId}`,
      timestamp: now - (count - i) * 60_000,
      status: mine ? 'seen' : 'delivered',
      read_state: i > count - 3 ? 'unread' : 'read',
      type: i % 17 === 0 ? 'system event' : i % 13 === 0 ? 'approval' : i % 19 === 0 ? 'settlement' : i % 23 === 0 ? 'agreement' : i % 11 === 0 ? 'file' : i % 7 === 0 ? 'voice' : 'text',
      mine,
    });
  }
  return list;
}

const seedMessages = {
  c1: generateMessages('c1', 120),
  c2: generateMessages('c2', 42),
  c3: generateMessages('c3', 25),
  c4: generateMessages('c4', 27),
  c5: generateMessages('c5', 13),
  c6: generateMessages('c6', 9),
} as Record<string, Message[]>;

const seedNotifications: Notification[] = [
  {
    notification_id: 'n1',
    conversation_id: 'c1',
    message_id: 'm-c1-118',
    user_id: CURRENT_USER_ID,
    read_state: 'unread',
    timestamp: Date.now() - 90_000,
  },
];

function sortByLatest(conversations: Conversation[], messages: Record<string, Message[]>) {
  return [...conversations].sort((a, b) => {
    const aTs = messages[a.conversation_id]?.[messages[a.conversation_id].length - 1]?.timestamp || 0;
    const bTs = messages[b.conversation_id]?.[messages[b.conversation_id].length - 1]?.timestamp || 0;
    return bTs - aTs;
  });
}

function statusIcon(status: MessageStatus) {
  if (status === 'sent') return '✓';
  if (status === 'delivered') return '✓✓';
  if (status === 'seen') return '✓✓';
  return '⚠';
}

function statusColor(status: MessageStatus) {
  if (status === 'seen') return '#1d74f5';
  if (status === 'failed') return '#ef4444';
  return '#94a3b8';
}

const chatStore = {
  activeConversationId: 'c1',
  messages: seedMessages,
  conversations: seedConversations,
  unreadCounts: Object.fromEntries(seedConversations.map((c) => [c.conversation_id, c.unread_count])) as Record<string, number>,
  notifications: seedNotifications,
  typingUsers: {} as Record<string, string[]>,
  presenceStatus: {
    c1: 'online',
    c2: 'last seen',
    c3: 'online',
    c4: 'offline',
    c5: 'online',
    c6: 'online',
  } as Record<string, PresenceStatus>,
};

function useChatStore() {
  const [activeConversationId, setActiveConversationId] = useState(chatStore.activeConversationId);
  const [messages, setMessages] = useState(chatStore.messages);
  const [conversations, setConversations] = useState(chatStore.conversations);
  const [unreadCounts, setUnreadCounts] = useState(chatStore.unreadCounts);
  const [notifications, setNotifications] = useState(chatStore.notifications);
  const [typingUsers, setTypingUsers] = useState(chatStore.typingUsers);
  const [presenceStatus, setPresenceStatus] = useState(chatStore.presenceStatus);

  useEffect(() => { chatStore.activeConversationId = activeConversationId; }, [activeConversationId]);
  useEffect(() => { chatStore.messages = messages; }, [messages]);
  useEffect(() => { chatStore.conversations = conversations; }, [conversations]);
  useEffect(() => { chatStore.unreadCounts = unreadCounts; }, [unreadCounts]);
  useEffect(() => { chatStore.notifications = notifications; }, [notifications]);
  useEffect(() => { chatStore.typingUsers = typingUsers; }, [typingUsers]);
  useEffect(() => { chatStore.presenceStatus = presenceStatus; }, [presenceStatus]);

  const openConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  const sendMessage = useCallback((conversationId: string, content: string, type: MessageType = 'text') => {
    const messageId = `m-${conversationId}-${Date.now()}`;
    const canFail = Math.random() < 0.15;
    const newMessage: Message = {
      message_id: messageId,
      conversation_id: conversationId,
      sender_id: CURRENT_USER_ID,
      content,
      timestamp: Date.now(),
      status: canFail ? 'failed' : 'sent',
      read_state: 'read',
      type,
      mine: true,
      pendingRetry: canFail,
    };

    setMessages((prev) => ({ ...prev, [conversationId]: [...(prev[conversationId] || []), newMessage] }));
    setConversations((prev) => prev.map((c) => c.conversation_id === conversationId ? { ...c, last_message_id: messageId } : c));

    if (!canFail) {
      setTimeout(() => {
        setMessages((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).map((m) => m.message_id === messageId ? { ...m, status: 'delivered' } : m),
        }));
      }, 700);
      setTimeout(() => {
        setMessages((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).map((m) => m.message_id === messageId ? { ...m, status: 'seen' } : m),
        }));
      }, 1600);
    }
  }, []);

  const retryMessage = useCallback((conversationId: string, messageId: string) => {
    setMessages((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).map((m) => m.message_id === messageId ? { ...m, status: 'sent', pendingRetry: false } : m),
    }));
    setTimeout(() => {
      setMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) => m.message_id === messageId ? { ...m, status: 'delivered' } : m),
      }));
    }, 500);
  }, []);

  const receiveMessage = useCallback((conversationId: string, content: string, type: MessageType = 'text', shouldUnread = true) => {
    const messageId = `m-${conversationId}-${Date.now()}`;
    const incoming: Message = {
      message_id: messageId,
      conversation_id: conversationId,
      sender_id: `${conversationId}-remote`,
      content,
      timestamp: Date.now(),
      status: 'delivered',
      read_state: shouldUnread ? 'unread' : 'read',
      type,
      mine: false,
    };

    setMessages((prev) => ({ ...prev, [conversationId]: [...(prev[conversationId] || []), incoming] }));
    setConversations((prev) => prev.map((c) => c.conversation_id === conversationId ? { ...c, last_message_id: messageId } : c));
  }, []);

  const markMessageSeen = useCallback((conversationId: string, messageIds: string[]) => {
    if (!messageIds.length) return;
    setMessages((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).map((m) => messageIds.includes(m.message_id) ? { ...m, read_state: 'read' } : m),
    }));
    setUnreadCounts((prev) => {
      const current = prev[conversationId] || 0;
      return { ...prev, [conversationId]: Math.max(0, current - messageIds.length) };
    });
  }, []);

  const updateTypingState = useCallback((conversationId: string, users: string[]) => {
    setTypingUsers((prev) => ({ ...prev, [conversationId]: users }));
    setPresenceStatus((prev) => ({ ...prev, [conversationId]: users.length > 0 ? 'typing' : (prev[conversationId] === 'typing' ? 'online' : prev[conversationId]) }));
  }, []);

  const loadMoreMessages = useCallback((conversationId: string) => {
    setMessages((prev) => {
      const existing = prev[conversationId] || [];
      const firstTs = existing[0]?.timestamp || Date.now();
      const older = Array.from({ length: 30 }).map((_, index) => ({
        message_id: `m-${conversationId}-older-${firstTs}-${index}`,
        conversation_id: conversationId,
        sender_id: index % 2 ? `${conversationId}-remote` : CURRENT_USER_ID,
        content: `Older message ${index + 1}`,
        timestamp: firstTs - (index + 1) * 60_000,
        status: (index % 2 ? 'delivered' : 'seen') as MessageStatus,
        read_state: 'read' as ReadState,
        type: 'text' as MessageType,
        mine: index % 2 === 0,
      }));
      return { ...prev, [conversationId]: [...older.reverse(), ...existing] };
    });
  }, []);

  const handleNotificationClick = useCallback((notificationId: string) => {
    const n = notifications.find((item) => item.notification_id === notificationId);
    if (!n) return null;
    openConversation(n.conversation_id);
    setUnreadCounts((prev) => ({ ...prev, [n.conversation_id]: 0 }));
    setNotifications((prev) => prev.map((item) => item.notification_id === notificationId ? { ...item, read_state: 'read' } : item));
    return { conversationId: n.conversation_id, messageId: n.message_id };
  }, [notifications, openConversation]);

  return {
    activeConversationId,
    messages,
    conversations,
    unreadCounts,
    notifications,
    typingUsers,
    presenceStatus,
    openConversation,
    sendMessage,
    receiveMessage,
    markMessageSeen,
    handleNotificationClick,
    updateTypingState,
    retryMessage,
    loadMoreMessages,
    setUnreadCounts,
    setPresenceStatus,
  };
}

function ConversationRow({
  conversation,
  active,
  unread,
  lastPreview,
  timestamp,
  status,
  onClick,
}: {
  conversation: Conversation;
  active: boolean;
  unread: number;
  lastPreview: string;
  timestamp: number;
  status: PresenceStatus;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="chat-row" style={{ background: active ? '#1f2937' : 'transparent' }}>
      <span className="chat-avatar" aria-hidden>{conversation.avatar}</span>
      <span className="chat-row-content">
        <span className="chat-row-top">
          <span className="chat-row-name">{conversation.name}</span>
          <span className="chat-row-time">{formatDistanceToNow(timestamp, { addSuffix: true })}</span>
        </span>
        <span className="chat-row-bottom">
          <span className="chat-row-preview">{lastPreview}</span>
          {unread > 0 && <span className="chat-unread-badge">{unread}</span>}
        </span>
        <span className="chat-presence-dot" style={{ background: status === 'online' || status === 'typing' ? '#16a34a' : '#64748b' }} />
      </span>
    </button>
  );
}

function ConversationList({
  grouped,
  search,
  onSearch,
  activeConversationId,
  unreadCounts,
  messages,
  presenceStatus,
  openConversation,
}: {
  grouped: Record<ConversationSection, Conversation[]>;
  search: string;
  onSearch: (value: string) => void;
  activeConversationId: string;
  unreadCounts: Record<string, number>;
  messages: Record<string, Message[]>;
  presenceStatus: Record<string, PresenceStatus>;
  openConversation: (conversationId: string) => void;
}) {
  return (
    <aside className="chat-left-panel">
      <div className="chat-search-wrap">
        <input aria-label="Search conversations" className="chat-search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search" />
      </div>
      {sections.map((section) => (
        <section key={section} className="chat-section">
          <h3 className="chat-section-title">{section}</h3>
          <div>
            {grouped[section].map((conversation) => {
              const list = messages[conversation.conversation_id] || [];
              const last = list[list.length - 1];
              return (
                <ConversationRow
                  key={conversation.conversation_id}
                  conversation={conversation}
                  active={activeConversationId === conversation.conversation_id}
                  unread={unreadCounts[conversation.conversation_id] || 0}
                  lastPreview={last?.content || 'No messages'}
                  timestamp={last?.timestamp || Date.now()}
                  status={presenceStatus[conversation.conversation_id] || 'offline'}
                  onClick={() => openConversation(conversation.conversation_id)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </aside>
  );
}

function TypingIndicator({ users }: { users: string[] }) {
  if (!users.length) return null;
  return <span className="chat-typing">{users.join(', ')} typing…</span>;
}

function SeenIndicator({ status }: { status: MessageStatus }) {
  return <span style={{ color: statusColor(status), fontSize: 12 }}>{statusIcon(status)}</span>;
}

function MessageBubble({
  message,
  highlighted,
  onRetry,
}: {
  message: Message;
  highlighted: boolean;
  onRetry: (messageId: string) => void;
}) {
  return (
    <div className={`chat-message-row ${message.mine ? 'mine' : ''}`} data-message-id={message.message_id}>
      <span className="chat-message-avatar">{message.mine ? '🟢' : '⚪'}</span>
      <div className={`chat-message-bubble ${highlighted ? 'highlighted' : ''}`}>
        <div className="chat-message-content">{message.content}</div>
        <div className="chat-message-meta">
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <SeenIndicator status={message.status} />
          {message.pendingRetry && <button type="button" className="chat-retry" onClick={() => onRetry(message.message_id)}>Retry</button>}
        </div>
      </div>
    </div>
  );
}

function UnreadDivider() {
  return <div className="chat-unread-divider">--- Unread Messages ---</div>;
}

function JumpToLatestButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return <button type="button" className="chat-jump" onClick={onClick}>Jump to latest</button>;
}

function MessageList({
  messages,
  unreadMessageId,
  highlightedMessageId,
  onVisibleUnread,
  onLoadMore,
  onRetry,
  typingUsers,
  onScrollState,
}: {
  messages: Message[];
  unreadMessageId: string | null;
  highlightedMessageId: string | null;
  onVisibleUnread: (ids: string[]) => void;
  onLoadMore: () => void;
  onRetry: (messageId: string) => void;
  typingUsers: string[];
  onScrollState: (atBottom: boolean, scrolledUp: boolean) => void;
}) {
  const rowHeight = 74;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const visibleCount = Math.ceil(height / rowHeight) + 8;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const endIndex = Math.min(messages.length, startIndex + visibleCount);
  const visible = messages.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (messages.length - endIndex) * rowHeight);

  useEffect(() => {
    if (!containerRef.current) return;
    const update = () => setHeight(containerRef.current?.clientHeight || 480);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const visibleIds = visible.filter((m) => m.read_state === 'unread' && !m.mine).map((m) => m.message_id);
    if (visibleIds.length) onVisibleUnread(visibleIds);
  }, [visible, onVisibleUnread]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (el.scrollTop < 40) onLoadMore();
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    onScrollState(atBottom, !atBottom);
  };

  return (
    <div ref={containerRef} className="chat-message-list" onScroll={handleScroll}>
      <div style={{ height: topPad }} />
      {visible.map((message) => (
        <div key={message.message_id} style={{ minHeight: rowHeight }}>
          {unreadMessageId === message.message_id && <UnreadDivider />}
          <MessageBubble message={message} highlighted={highlightedMessageId === message.message_id} onRetry={onRetry} />
        </div>
      ))}
      <TypingIndicator users={typingUsers} />
      <div style={{ height: bottomPad }} />
    </div>
  );
}

function ConversationHeader({
  conversation,
  status,
}: {
  conversation: Conversation;
  status: PresenceStatus;
}) {
  const statusLabel = status === 'typing' ? 'typing' : status === 'last seen' ? 'last seen 2m ago' : status;
  return (
    <header className="chat-center-header">
      <span className="chat-avatar">{conversation.avatar}</span>
      <div>
        <div className="chat-header-name">{conversation.name}</div>
        <div className="chat-header-status">{statusLabel}</div>
      </div>
      <div className="chat-header-actions">
        <button type="button">📞</button>
        <button type="button">🎥</button>
        <button type="button">⋯</button>
      </div>
    </header>
  );
}

function MessageComposer({
  onSend,
  onTyping,
}: {
  onSend: (text: string, type?: MessageType) => void;
  onTyping: (typing: boolean) => void;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="chat-composer">
      <button type="button" onClick={() => onSend('Attached file: contract.pdf', 'file')}>📎</button>
      <button type="button" onClick={() => onSend('Voice recording sent', 'voice')}>🎙️</button>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onTyping(e.target.value.trim().length > 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!value.trim()) return;
            onSend(value.trim(), 'text');
            setValue('');
            onTyping(false);
          }
        }}
        placeholder="Message"
      />
      <button type="button" onClick={() => onSend('😀', 'text')}>😊</button>
      <button
        type="button"
        onClick={() => {
          if (!value.trim()) return;
          onSend(value.trim(), 'text');
          setValue('');
          onTyping(false);
        }}
      >
        ➤
      </button>
    </div>
  );
}

function ContextPanel({ conversation }: { conversation: Conversation }) {
  return (
    <aside className="chat-right-panel">
      {[
        ['Related Order', conversation.relatedOrder],
        ['Agreement Type', conversation.agreementType],
        ['Settlement Status', conversation.settlementStatus],
        ['Approval State', conversation.approvalState],
        ['Merchant Profile', conversation.merchantProfile],
        ['Transaction Metadata', conversation.transactionMetadata],
      ].map(([title, value]) => (
        <div key={title} className="chat-context-section">
          <div className="chat-context-title">{title}</div>
          <div className="chat-context-value">{value}</div>
        </div>
      ))}
    </aside>
  );
}

function NotificationRouter({
  notifications,
  onRoute,
}: {
  notifications: Notification[];
  onRoute: (notificationId: string) => { conversationId: string; messageId: string } | null;
}) {
  return (
    <div className="chat-notification-router" role="region" aria-label="Notifications">
      {notifications.filter((n) => n.read_state === 'unread').map((n) => (
        <button key={n.notification_id} type="button" onClick={() => onRoute(n.notification_id)}>
          Notification → {n.conversation_id}
        </button>
      ))}
    </div>
  );
}

function ChatLayout() {
  const {
    activeConversationId,
    messages,
    conversations,
    unreadCounts,
    notifications,
    typingUsers,
    presenceStatus,
    openConversation,
    sendMessage,
    receiveMessage,
    markMessageSeen,
    handleNotificationClick,
    updateTypingState,
    retryMessage,
    loadMoreMessages,
    setUnreadCounts,
    setPresenceStatus,
  } = useChatStore();

  const [search, setSearch] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [jumpVisible, setJumpVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [isTabFocused, setIsTabFocused] = useState(true);
  const panelVisibleRef = useRef(true);

  const sorted = useMemo(() => sortByLatest(conversations, messages), [conversations, messages]);
  const filtered = useMemo(() => sorted.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())), [sorted, search]);
  const grouped = useMemo(() => {
    const initial = Object.fromEntries(sections.map((section) => [section, []])) as Record<ConversationSection, Conversation[]>;
    for (const c of filtered) initial[c.section].push(c);
    return initial;
  }, [filtered]);

  const activeConversation = conversations.find((c) => c.conversation_id === activeConversationId) || conversations[0];
  const activeMessages = messages[activeConversation.conversation_id] || [];
  const unreadMessageId = activeMessages.find((m) => m.read_state === 'unread' && !m.mine)?.message_id || null;

  useEffect(() => {
    const onFocus = () => setIsTabFocused(true);
    const onBlur = () => setIsTabFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const targetConversation = conversations[Math.floor(Math.random() * conversations.length)]?.conversation_id;
      if (!targetConversation) return;

      setPresenceStatus((prev) => ({
        ...prev,
        [targetConversation]: Math.random() > 0.5 ? 'online' : 'last seen',
      }));

      receiveMessage(targetConversation, `Live update ${new Date().toLocaleTimeString()}`, 'text', true);

      const shouldIncreaseUnread = !(
        targetConversation === activeConversationId && isTabFocused && panelVisibleRef.current
      );
      if (shouldIncreaseUnread) {
        setUnreadCounts((prev) => ({ ...prev, [targetConversation]: (prev[targetConversation] || 0) + 1 }));
      }
      if (targetConversation === activeConversationId && !atBottom) {
        setJumpVisible(true);
      }
    }, 7000);

    return () => clearInterval(timer);
  }, [receiveMessage, activeConversationId, isTabFocused, atBottom, setUnreadCounts, conversations, setPresenceStatus]);

  const onOpenConversation = (conversationId: string) => {
    openConversation(conversationId);
    setHighlightedMessageId(null);
    setMobileConversationOpen(true);
  };

  const onNotificationRoute = (notificationId: string): { conversationId: string; messageId: string } => {
    const routed = handleNotificationClick(notificationId);
    if (!routed) return { conversationId: '', messageId: '' };
    setMobileConversationOpen(true);
    setHighlightedMessageId(routed.messageId);
    setTimeout(() => setHighlightedMessageId(null), 2000);
    return routed;
  };

  return (
    <div className="chat-layout-root">
      <NotificationRouter notifications={notifications} onRoute={onNotificationRoute} />
      <div className="chat-layout">
        <div className={`mobile-list-pane ${mobileConversationOpen ? 'hidden-mobile' : ''}`}>
          <ConversationList
            grouped={grouped}
            search={search}
            onSearch={setSearch}
            activeConversationId={activeConversation.conversation_id}
            unreadCounts={unreadCounts}
            messages={messages}
            presenceStatus={presenceStatus}
            openConversation={onOpenConversation}
          />
        </div>

        <main className={`chat-center-panel ${!mobileConversationOpen ? 'hidden-mobile' : ''}`}>
          <div className="chat-mobile-top">
            <button type="button" onClick={() => setMobileConversationOpen(false)}>← Back</button>
          </div>
          <ConversationHeader conversation={activeConversation} status={presenceStatus[activeConversation.conversation_id] || 'offline'} />
          <div className="chat-message-wrap">
            <MessageList
              messages={activeMessages}
              unreadMessageId={unreadMessageId}
              highlightedMessageId={highlightedMessageId}
              onVisibleUnread={(ids) => markMessageSeen(activeConversation.conversation_id, ids)}
              onLoadMore={() => loadMoreMessages(activeConversation.conversation_id)}
              onRetry={(messageId) => retryMessage(activeConversation.conversation_id, messageId)}
              typingUsers={typingUsers[activeConversation.conversation_id] || []}
              onScrollState={(isAtBottom, scrolledUp) => {
                panelVisibleRef.current = isAtBottom;
                setAtBottom(isAtBottom);
                if (scrolledUp) setJumpVisible(true);
                if (isAtBottom) setJumpVisible(false);
              }}
            />
            <JumpToLatestButton visible={jumpVisible} onClick={() => {
              const el = document.querySelector('.chat-message-list');
              if (el) el.scrollTop = el.scrollHeight;
              setJumpVisible(false);
            }} />
          </div>
          <MessageComposer
            onSend={(text, type) => {
              sendMessage(activeConversation.conversation_id, text, type);
              const el = document.querySelector('.chat-message-list');
              if (el) el.scrollTop = el.scrollHeight;
            }}
            onTyping={(typing) => {
              updateTypingState(activeConversation.conversation_id, typing ? [activeConversation.name] : []);
            }}
          />
        </main>

        <div className={`mobile-context-pane ${!mobileConversationOpen ? 'hidden-mobile' : ''}`}>
          <ContextPanel conversation={activeConversation} />
        </div>
      </div>

      <style>{`
        .chat-layout-root { height: calc(100vh - 92px); background: #0f172a; color: #e2e8f0; }
        .chat-layout { height: 100%; display: grid; grid-template-columns: 280px 1fr 320px; }
        .chat-left-panel { border-right: 1px solid #1e293b; overflow-y: auto; }
        .chat-search-wrap { padding: 12px; border-bottom: 1px solid #1e293b; }
        .chat-search { width: 100%; border-radius: 6px; background: #111827; border: 1px solid #334155; color: #f8fafc; padding: 8px 10px; }
        .chat-section { padding: 8px; }
        .chat-section-title { margin: 6px 6px 8px; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }
        .chat-row { width: 100%; text-align: left; border: none; color: inherit; display: flex; gap: 10px; padding: 8px; border-radius: 8px; margin-bottom: 4px; position: relative; }
        .chat-avatar { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; }
        .chat-row-content { min-width: 0; flex: 1; position: relative; }
        .chat-row-top { display: flex; justify-content: space-between; gap: 8px; }
        .chat-row-name { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chat-row-time { font-size: 10px; color: #94a3b8; white-space: nowrap; }
        .chat-row-bottom { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 3px; }
        .chat-row-preview { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chat-unread-badge { background: #dc2626; color: white; min-width: 18px; height: 18px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; padding: 0 6px; }
        .chat-presence-dot { width: 8px; height: 8px; border-radius: 999px; position: absolute; left: -14px; top: 15px; }
        .chat-center-panel { border-right: 1px solid #1e293b; display: flex; flex-direction: column; min-width: 0; }
        .chat-center-header { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #1e293b; background: #0f172a; }
        .chat-header-name { font-size: 14px; font-weight: 700; }
        .chat-header-status { font-size: 12px; color: #94a3b8; }
        .chat-header-actions { margin-left: auto; display: flex; gap: 8px; }
        .chat-header-actions button { background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; padding: 4px 7px; }
        .chat-message-wrap { position: relative; flex: 1; min-height: 0; }
        .chat-message-list { overflow-y: auto; height: 100%; padding: 12px 16px; }
        .chat-message-row { display: flex; gap: 10px; align-items: flex-start; }
        .chat-message-row.mine { justify-content: flex-end; }
        .chat-message-avatar { width: 24px; }
        .chat-message-bubble { max-width: 68%; padding: 9px 10px; border-radius: 10px; background: #1e293b; margin-bottom: 8px; transition: background 1.6s ease; }
        .chat-message-row.mine .chat-message-bubble { background: #14532d; }
        .chat-message-bubble.highlighted { background: #fef9c3; color: #1f2937; }
        .chat-message-content { font-size: 13px; white-space: pre-wrap; }
        .chat-message-meta { margin-top: 4px; display: flex; justify-content: flex-end; gap: 8px; font-size: 11px; color: #94a3b8; align-items: center; }
        .chat-retry { border: none; background: #dc2626; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; }
        .chat-unread-divider { text-align: center; color: #fca5a5; font-size: 12px; margin: 4px 0 8px; }
        .chat-jump { position: absolute; right: 14px; bottom: 12px; border: none; background: #1d4ed8; color: #fff; border-radius: 999px; padding: 6px 12px; font-size: 12px; }
        .chat-composer { position: sticky; bottom: 0; z-index: 3; display: grid; grid-template-columns: auto auto 1fr auto auto; gap: 8px; padding: 10px 14px; border-top: 1px solid #1e293b; background: #0f172a; }
        .chat-composer textarea { min-height: 42px; max-height: 120px; resize: vertical; border-radius: 8px; border: 1px solid #334155; background: #111827; color: #f8fafc; padding: 8px 10px; }
        .chat-composer button { border: 1px solid #334155; background: #1e293b; color: #f8fafc; border-radius: 8px; min-width: 38px; }
        .chat-right-panel { overflow-y: auto; padding: 14px; }
        .chat-context-section { border-bottom: 1px solid #1e293b; padding: 10px 0; }
        .chat-context-title { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
        .chat-context-value { margin-top: 4px; font-size: 13px; }
        .chat-notification-router { position: absolute; top: 6px; right: 8px; z-index: 5; display: flex; gap: 6px; }
        .chat-notification-router button { border: 1px solid #1e293b; background: #111827; color: #f8fafc; border-radius: 999px; font-size: 11px; padding: 4px 8px; }
        .chat-typing { display: inline-block; margin: 6px 0; color: #22c55e; font-size: 12px; }
        .chat-mobile-top { display: none; }

        @media (max-width: 900px) {
          .chat-layout { grid-template-columns: 1fr; }
          .chat-right-panel { display: none; }
          .hidden-mobile { display: none; }
          .chat-mobile-top { display: block; border-bottom: 1px solid #1e293b; padding: 8px 12px; }
          .chat-mobile-top button { border: 1px solid #334155; background: #1e293b; color: #fff; border-radius: 6px; padding: 4px 8px; }
        }
      `}</style>
    </div>
  );
}

export default function ChatPage() {
  return <ChatLayout />;
}
