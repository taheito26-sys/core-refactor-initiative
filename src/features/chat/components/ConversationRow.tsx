/* ═══════════════════════════════════════════════════════════════
   ConversationRow — single entry in the Directs section
   (kept for import compatibility but sidebar now renders inline)
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
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full text-left px-3 py-2 transition-colors border-b border-border/50 ${
        isActive ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
      }`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-extrabold"
        style={{ background: palette.bg, color: palette.text }}
      >
        {conv.counterparty_name.charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className="text-[12px] font-bold text-foreground truncate">
            {conv.counterparty_nickname || conv.counterparty_name}
          </span>
          {conv.last_message_at && (
            <span className="text-[9px] text-muted-foreground flex-shrink-0 ml-1.5">
              {fmtListTime(conv.last_message_at)}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-muted-foreground truncate flex-1">
            {isOwn && 'You: '}{preview || 'No messages yet'}
          </span>
          {conv.unread_count > 0 && (
            <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0 ml-1.5">
              {conv.unread_count > 99 ? '99+' : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
