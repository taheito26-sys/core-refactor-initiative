/* ═══════════════════════════════════════════════════════════════
   ConversationRow — single entry in the conversation sidebar list
   ═══════════════════════════════════════════════════════════════ */

import type { ConversationSummary } from '@/lib/chat-store';
import { getPalette, fmtListTime, parseMsg } from '../lib/message-codec';

interface Props {
  conv: ConversationSummary;
  isActive: boolean;
  currentUserId: string;
  onClick: () => void;
}

export function ConversationRow({ conv, isActive, currentUserId, onClick }: Props) {
  const palette = getPalette(conv.counterparty_name);
  const isOwn = conv.last_sender_id === currentUserId;
  const parsed = conv.last_message ? parseMsg(conv.last_message) : null;

  let preview = '';
  if (parsed) {
    if (parsed.isVoice) preview = '🎤 Voice message';
    else if (parsed.isPoll) preview = '📊 Poll';
    else if (parsed.isSystemEvent) preview = 'ℹ️ Event';
    else preview = parsed.text.slice(0, 60);
  }

  return (
    <div
      className={`chat-conversation-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        cursor: 'pointer', borderBottom: '1px solid var(--line)',
        background: isActive ? 'color-mix(in srgb, var(--brand) 10%, transparent)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 40, height: 40, borderRadius: 50, flexShrink: 0,
        background: palette.bg, color: palette.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 800, position: 'relative',
      }}>
        {conv.counterparty_name.charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {conv.counterparty_nickname || conv.counterparty_name}
          </span>
          {conv.last_message_at && (
            <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, marginLeft: 6 }}>
              {fmtListTime(conv.last_message_at)}
            </span>
          )}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{
            fontSize: 11, color: 'var(--muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {isOwn && 'You: '}{preview || 'No messages yet'}
          </span>
          {conv.unread_count > 0 && (
            <span style={{
              background: 'var(--brand)', color: '#fff', borderRadius: 50,
              fontSize: 10, fontWeight: 800, minWidth: 18, height: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 5px', flexShrink: 0, marginLeft: 6,
            }}>
              {conv.unread_count > 99 ? '99+' : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
