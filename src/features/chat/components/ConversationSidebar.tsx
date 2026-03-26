/* ═══════════════════════════════════════════════════════════════
   ConversationSidebar — left panel with conversation list
   ═══════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import { Search, MessageCircle, Filter } from 'lucide-react';
import { useChatStore, selectTotalUnread } from '@/lib/chat-store';
import type { ConversationSummary } from '@/lib/chat-store';
import { ConversationRow } from './ConversationRow';

interface Props {
  conversations: ConversationSummary[];
  currentUserId: string;
}

type Folder = 'all' | 'unread' | 'muted';

export function ConversationSidebar({ conversations, currentUserId }: Props) {
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<Folder>('all');
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const totalUnread = useChatStore(selectTotalUnread);

  const filtered = useMemo(() => {
    let list = conversations;

    // Folder filter
    if (folder === 'unread') list = list.filter((c) => c.unread_count > 0);
    if (folder === 'muted') list = list.filter((c) => c.is_muted);

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.counterparty_name.toLowerCase().includes(q) ||
          c.counterparty_nickname.toLowerCase().includes(q)
      );
    }

    return list;
  }, [conversations, folder, search]);

  const folderBtn = (f: Folder, label: string) => (
    <button
      onClick={() => setFolder(f)}
      style={{
        padding: '4px 10px', fontSize: 10, fontWeight: 700, border: 'none',
        borderRadius: 4, cursor: 'pointer',
        background: folder === f ? 'var(--brand)' : 'transparent',
        color: folder === f ? '#fff' : 'var(--muted)',
        transition: 'all 0.12s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--line)', height: '100%', overflow: 'hidden',
      background: 'var(--panel)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 14px 10px', borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageCircle size={16} style={{ color: 'var(--brand)' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Messages</span>
            {totalUnread > 0 && (
              <span style={{
                background: 'var(--brand)', color: '#fff', borderRadius: 50,
                fontSize: 10, fontWeight: 800, minWidth: 18, height: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 5px',
              }}>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--input-bg)', border: '1px solid var(--line)',
          borderRadius: 6, padding: '5px 8px',
        }}>
          <Search size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              color: 'var(--text)', fontSize: 11,
            }}
          />
        </div>

        {/* Folder tabs */}
        <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
          {folderBtn('all', 'All')}
          {folderBtn('unread', 'Unread')}
          {folderBtn('muted', 'Muted')}
        </div>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '32px 16px', textAlign: 'center',
            color: 'var(--muted)', fontSize: 12,
          }}>
            {search ? 'No conversations match your search' : 'No conversations'}
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationRow
              key={conv.relationship_id}
              conv={conv}
              isActive={conv.relationship_id === activeId}
              currentUserId={currentUserId}
              onClick={() => setActive(conv.relationship_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
