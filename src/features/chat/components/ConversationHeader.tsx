/* ═══════════════════════════════════════════════════════════════
   ConversationHeader — sticky top bar of the active conversation
   ═══════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';
import { ArrowLeft, Search, Phone, MoreVertical } from 'lucide-react';
import { useChatStore } from '@/lib/chat-store';
import { getPalette } from '../lib/message-codec';

interface Props {
  name: string;
  nickname: string;
  onBack: () => void;
  onSearchToggle: () => void;
  isMobile?: boolean;
}

export function ConversationHeader({ name, nickname, onBack, onSearchToggle, isMobile }: Props) {
  const typingUsers = useChatStore((s) => {
    const id = s.activeConversationId;
    if (!id) return undefined;
    return s.typingByConversation[id];
  });
  const typing = typingUsers ?? [];
  const palette = getPalette(name);

  const displayName = nickname || name;
  const isTyping = typing.length > 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      borderBottom: '1px solid var(--line)', flexShrink: 0,
      background: 'var(--panel)',
    }}>
      {/* Back button (mobile or always visible) */}
      {isMobile && (
        <button
          onClick={onBack}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 4, display: 'flex',
          }}
        >
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: 50, flexShrink: 0,
        background: palette.bg, color: palette.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800,
      }}>
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Name + status */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName}
        </div>
        <div style={{ fontSize: 10, color: isTyping ? 'var(--brand)' : 'var(--muted)' }}>
          {isTyping ? 'typing...' : 'online'}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          onClick={onSearchToggle}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 6, display: 'flex', borderRadius: 6,
          }}
          title="Search in conversation"
        >
          <Search size={16} />
        </button>
        <button
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 6, display: 'flex', borderRadius: 6,
          }}
          title="Voice call"
        >
          <Phone size={16} />
        </button>
        <button
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 6, display: 'flex', borderRadius: 6,
          }}
          title="More options"
        >
          <MoreVertical size={16} />
        </button>
      </div>
    </div>
  );
}
