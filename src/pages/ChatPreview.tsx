/* Temporary preview page — renders chat UI with mock data, no auth required */

import { useEffect } from 'react';
import { useChatStore } from '@/lib/chat-store';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageTimeline } from '@/features/chat/components/MessageTimeline';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import type { ConversationSummary, ChatMessage } from '@/lib/chat-store';

const MOCK_USER = 'user-me-123';

const MOCK_CONVERSATIONS: ConversationSummary[] = [
  {
    relationship_id: 'rel-1',
    counterparty_name: 'Ahmad Trading Co.',
    counterparty_nickname: 'Ahmad',
    last_message: 'The shipment is ready for pickup tomorrow morning',
    last_message_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    last_sender_id: 'user-ahmad',
    unread_count: 3,
    is_muted: false,
    is_pinned: true,
  },
  {
    relationship_id: 'rel-2',
    counterparty_name: 'Dubai Gold Suppliers',
    counterparty_nickname: 'DGS',
    last_message: 'Invoice #4521 has been settled',
    last_message_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    last_sender_id: MOCK_USER,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-3',
    counterparty_name: 'Al Rashid Metals',
    counterparty_nickname: 'Rashid',
    last_message: 'Can we discuss the new pricing?',
    last_message_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    last_sender_id: 'user-rashid',
    unread_count: 1,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-4',
    counterparty_name: 'Karachi Exports Ltd',
    counterparty_nickname: 'KEL',
    last_message: 'Order confirmed, processing now',
    last_message_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    last_sender_id: 'user-kel',
    unread_count: 0,
    is_muted: true,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-5',
    counterparty_name: 'Istanbul Bazaar Group',
    counterparty_nickname: 'IBG',
    last_message: '🎤 Voice message',
    last_message_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
    last_sender_id: 'user-ibg',
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
];

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    relationship_id: 'rel-1',
    sender_id: 'user-ahmad',
    content: 'Hi, I wanted to check on the latest order status',
    read_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 65 * 60_000).toISOString(),
  },
  {
    id: 'msg-2',
    relationship_id: 'rel-1',
    sender_id: MOCK_USER,
    content: 'Sure! Order #1247 is currently being processed. Should be ready by end of day.',
    read_at: new Date(Date.now() - 58 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  },
  {
    id: 'msg-3',
    relationship_id: 'rel-1',
    sender_id: 'user-ahmad',
    content: 'Perfect. What about the settlement for last week?',
    read_at: new Date(Date.now() - 50 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 55 * 60_000).toISOString(),
  },
  {
    id: 'msg-4',
    relationship_id: 'rel-1',
    sender_id: MOCK_USER,
    content: 'Settlement was completed yesterday. I can share the receipt if you need it.',
    read_at: new Date(Date.now() - 48 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 50 * 60_000).toISOString(),
  },
  {
    id: 'msg-5',
    relationship_id: 'rel-1',
    sender_id: 'user-ahmad',
    content: 'Yes please, that would be great. Also, I have a new deal proposal to discuss when you have time.',
    read_at: null,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
  {
    id: 'msg-6',
    relationship_id: 'rel-1',
    sender_id: 'user-ahmad',
    content: 'It involves 500 units at the revised rate we talked about last month.',
    read_at: null,
    created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  },
  {
    id: 'msg-7',
    relationship_id: 'rel-1',
    sender_id: 'user-ahmad',
    content: 'The shipment is ready for pickup tomorrow morning',
    read_at: null,
    created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
];

const MOCK_REL = {
  id: 'rel-1',
  counterparty_name: 'Ahmad Trading Co.',
  counterparty_nickname: 'Ahmad',
  counterparty_code: 'ATC-001',
  merchant_a_id: MOCK_USER,
  merchant_b_id: 'user-ahmad',
};

export default function ChatPreview() {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  // Auto-select first conversation on mount
  useEffect(() => {
    if (!activeConversationId) {
      setActiveConversation('rel-1');
    }
  }, [activeConversationId, setActiveConversation]);

  const activeMessages = MOCK_MESSAGES.filter(
    (m) => m.relationship_id === activeConversationId
  );

  const activeRel = activeConversationId === 'rel-1' ? MOCK_REL : null;

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bg, #0d1117)',
      // Inject CSS variables for dark theme
      ['--bg' as any]: '#0d1117',
      ['--panel' as any]: '#161b22',
      ['--panel2' as any]: '#1c2128',
      ['--text' as any]: '#e6edf3',
      ['--muted' as any]: '#8b949e',
      ['--brand' as any]: '#6c63ff',
      ['--line' as any]: '#30363d',
      ['--input-bg' as any]: '#0d1117',
      ['--good' as any]: '#3fb950',
      ['--bad' as any]: '#f85149',
    }}>
      {/* LEFT — Conversation Sidebar */}
      <ConversationSidebar
        conversations={MOCK_CONVERSATIONS}
        currentUserId={MOCK_USER}
      />

      {/* CENTER — Active Conversation */}
      {activeConversationId && activeRel ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          height: '100%', overflow: 'hidden', minWidth: 0,
        }}>
          <ConversationHeader
            name={activeRel.counterparty_name}
            nickname={activeRel.counterparty_nickname}
            onBack={() => setActiveConversation(null)}
            onSearchToggle={() => {}}
          />

          <MessageTimeline
            messages={activeMessages}
            currentUserId={MOCK_USER}
            counterpartyName={activeRel.counterparty_name}
            scrollRef={() => {}}
            onReply={() => {}}
          />

          <MessageComposer
            sending={false}
            onSend={(payload) => console.log('Send:', payload)}
            onTyping={() => {}}
            replyTo={null}
            onCancelReply={() => {}}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: 13,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Select a conversation</div>
            <div style={{ fontSize: 11 }}>Choose a conversation from the left to start messaging</div>
          </div>
        </div>
      )}

      {/* RIGHT — Context Panel */}
      {activeConversationId && (
        <ContextPanel relationship={activeRel} />
      )}
    </div>
  );
}
