/* ═══════════════════════════════════════════════════════════════
   ChatPreview — standalone preview with mock data, no auth required.
   Demonstrates the full three-column chat workspace.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useChatStore } from '@/lib/chat-store';
import type { ConversationSummary, ChatMessage } from '@/lib/chat-store';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageTimeline } from '@/features/chat/components/MessageTimeline';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { ContextPanel } from '@/features/chat/components/ContextPanel';
import { encodeReply, encodeVoice, encodePoll } from '@/features/chat/lib/message-codec';
import '@/styles/tracker.css';

const ME = 'user-me-123';

/* ── Mock relationships ──────────────────────────────────────── */
const RELS = [
  { id: 'rel-1', counterparty_name: 'Ahmad Trading Co.', counterparty_nickname: 'Ahmad', counterparty_code: 'ATC-001', merchant_a_id: ME, merchant_b_id: 'user-ahmad' },
  { id: 'rel-2', counterparty_name: 'Dubai Gold Suppliers', counterparty_nickname: 'DGS', counterparty_code: 'DGS-042', merchant_a_id: ME, merchant_b_id: 'user-dgs' },
  { id: 'rel-3', counterparty_name: 'Al Rashid Metals', counterparty_nickname: 'Rashid', counterparty_code: 'ARM-018', merchant_a_id: ME, merchant_b_id: 'user-rashid' },
  { id: 'rel-4', counterparty_name: 'Karachi Exports Ltd', counterparty_nickname: 'KEL', counterparty_code: 'KEL-077', merchant_a_id: ME, merchant_b_id: 'user-kel' },
  { id: 'rel-5', counterparty_name: 'Istanbul Bazaar Group', counterparty_nickname: 'IBG', counterparty_code: 'IBG-103', merchant_a_id: ME, merchant_b_id: 'user-ibg' },
];

function hrs(n: number) { return new Date(Date.now() - n * 3600_000).toISOString(); }
function mins(n: number) { return new Date(Date.now() - n * 60_000).toISOString(); }

const SEED_MESSAGES: ChatMessage[] = [
  // rel-1 — Ahmad Trading Co.
  { id: 'm01', relationship_id: 'rel-1', sender_id: 'user-ahmad', content: 'Hi, I wanted to check on the latest order status', read_at: hrs(2), created_at: hrs(2.1) },
  { id: 'm02', relationship_id: 'rel-1', sender_id: ME, content: 'Sure! Order #1247 is currently being processed. Should be ready by end of day.', read_at: hrs(1.9), created_at: hrs(2) },
  { id: 'm03', relationship_id: 'rel-1', sender_id: 'user-ahmad', content: 'Perfect. What about the settlement for last week?', read_at: hrs(1.5), created_at: hrs(1.8) },
  { id: 'm04', relationship_id: 'rel-1', sender_id: ME, content: 'Settlement was completed yesterday. I can share the receipt if you need it.', read_at: hrs(1.3), created_at: hrs(1.5) },
  { id: 'm05', relationship_id: 'rel-1', sender_id: 'user-ahmad', content: 'Yes please, that would be great. Also, I have a new deal proposal to discuss when you have time.', read_at: null, created_at: mins(12) },
  { id: 'm06', relationship_id: 'rel-1', sender_id: 'user-ahmad', content: 'It involves 500 units at the revised rate we talked about last month.', read_at: null, created_at: mins(10) },
  { id: 'm07', relationship_id: 'rel-1', sender_id: 'user-ahmad', content: 'The shipment is ready for pickup tomorrow morning', read_at: null, created_at: mins(2) },

  // rel-2 — Dubai Gold Suppliers
  { id: 'm08', relationship_id: 'rel-2', sender_id: 'user-dgs', content: 'We have new pricing for Q2, shall I send the sheet?', read_at: hrs(5), created_at: hrs(5.5) },
  { id: 'm09', relationship_id: 'rel-2', sender_id: ME, content: 'Yes please, email it over and we will review.', read_at: hrs(5), created_at: hrs(5.2) },
  { id: 'm10', relationship_id: 'rel-2', sender_id: ME, content: 'Invoice #4521 has been settled', read_at: hrs(3), created_at: hrs(4) },
  { id: 'm11', relationship_id: 'rel-2', sender_id: 'user-dgs', content: 'Confirmed, thank you for the quick turnaround!', read_at: hrs(2), created_at: hrs(3) },

  // rel-3 — Al Rashid Metals
  { id: 'm12', relationship_id: 'rel-3', sender_id: 'user-rashid', content: 'Can we discuss the new pricing?', read_at: null, created_at: mins(45) },

  // rel-4 — Karachi Exports
  { id: 'm13', relationship_id: 'rel-4', sender_id: 'user-kel', content: 'Order confirmed, processing now', read_at: hrs(3), created_at: hrs(3) },

  // rel-5 — Istanbul Bazaar — a reply example
  { id: 'm14', relationship_id: 'rel-5', sender_id: 'user-ibg', content: 'When can you deliver the next batch?', read_at: hrs(8), created_at: hrs(8) },
  { id: 'm15', relationship_id: 'rel-5', sender_id: ME, content: encodeReply('m14', 'IBG', 'When can you deliver the next batch?', 'We can ship by Thursday if payment clears'), read_at: hrs(7), created_at: hrs(7.5) },
];

/* ═══════════════════════════════════════════════════════════════ */

export default function ChatPreview() {
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; preview: string } | null>(null);

  // Select first conversation on mount
  useEffect(() => {
    if (!activeId) setActive('rel-1');
    return () => { useChatStore.getState().reset(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build summaries
  const conversations: ConversationSummary[] = useMemo(() => {
    return RELS.map((r) => {
      const relMsgs = messages.filter((m) => m.relationship_id === r.id);
      const last = relMsgs[relMsgs.length - 1];
      return {
        relationship_id: r.id,
        counterparty_name: r.counterparty_name,
        counterparty_nickname: r.counterparty_nickname,
        last_message: last?.content || '',
        last_message_at: last?.created_at || '',
        last_sender_id: last?.sender_id || '',
        unread_count: relMsgs.filter((m) => m.sender_id !== ME && !m.read_at).length,
        is_muted: r.id === 'rel-4',
        is_pinned: r.id === 'rel-1',
      };
    }).sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
  }, [messages]);

  const activeRel = RELS.find((r) => r.id === activeId) || null;
  const activeMessages = useMemo(
    () => messages.filter((m) => m.relationship_id === activeId),
    [messages, activeId]
  );

  // Send message handler — works locally in preview
  const handleSend = useCallback((content: string) => {
    if (!activeId) return;
    const newMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      relationship_id: activeId,
      sender_id: ME,
      content,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setReplyTo(null);

    // Simulate counterparty reply after 2.5s
    setTimeout(() => {
      const replies = [
        'Got it, thanks!',
        'I will get back to you on that.',
        'Sounds good, let me check.',
        'Understood. Processing now.',
        'Perfect, will confirm shortly.',
      ];
      const counterpartyId = RELS.find((r) => r.id === activeId)?.merchant_b_id || 'unknown';
      setMessages((prev) => [...prev, {
        id: `m-${Date.now()}-reply`,
        relationship_id: activeId,
        sender_id: counterpartyId,
        content: replies[Math.floor(Math.random() * replies.length)],
        read_at: null,
        created_at: new Date().toISOString(),
      }]);
    }, 2500);
  }, [activeId]);

  const handleReply = useCallback((msg: ChatMessage) => {
    const cpName = activeRel?.counterparty_nickname || activeRel?.counterparty_name || '';
    const sender = msg.sender_id === ME ? 'You' : cpName;
    const preview = msg.content.startsWith('||VOICE||') ? '🎤 Voice' : msg.content.slice(0, 80);
    setReplyTo({ id: msg.id, sender, preview });
  }, [activeRel]);

  return (
    <div className="tracker-root" style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--bg)',
      color: 'var(--text)',
    }}>
      {/* LEFT — sidebar */}
      <ConversationSidebar conversations={conversations} currentUserId={ME} />

      {/* CENTER — conversation */}
      {activeId && activeRel ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          height: '100%', overflow: 'hidden', minWidth: 0,
          background: 'var(--bg)',
        }}>
          <ConversationHeader
            name={activeRel.counterparty_name}
            nickname={activeRel.counterparty_nickname}
            onBack={() => setActive(null)}
            onSearchToggle={() => {}}
          />
          <MessageTimeline
            messages={activeMessages}
            currentUserId={ME}
            counterpartyName={activeRel.counterparty_name}
            scrollRef={() => {}}
            onReply={handleReply}
          />
          <MessageComposer
            onSend={handleSend}
            onTyping={() => {}}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: 13,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>💬</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>
              Select a conversation
            </div>
            <div style={{ fontSize: 12 }}>
              Choose from the sidebar to start messaging
            </div>
          </div>
        </div>
      )}

      {/* RIGHT — context */}
      {activeId && <ContextPanel relationship={activeRel} />}
    </div>
  );
}
