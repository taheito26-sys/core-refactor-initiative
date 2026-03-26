/* ═══════════════════════════════════════════════════════════════
   ConversationHeader — Rocket.Chat-style top bar
   Avatar + Name/subtitle + action icons
   ═══════════════════════════════════════════════════════════════ */

import { ArrowLeft, Search, Phone, Users, MessageSquare, RefreshCw, MoreVertical } from 'lucide-react';
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

  const iconBtnClass = "bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground p-1.5 flex items-center rounded transition-colors";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0 bg-card">
      {/* Back (mobile) */}
      {isMobile && (
        <button onClick={onBack} className={iconBtnClass}>
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[14px] font-extrabold"
        style={{ background: palette.bg, color: palette.text }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Name + subtitle */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-foreground truncate">
          {displayName}
        </div>
        <div className={`text-[10px] ${isTyping ? 'text-primary' : 'text-muted-foreground'}`}>
          {isTyping ? 'typing...' : 'Merchant conversation'}
        </div>
      </div>

      {/* Action icons — matching the reference */}
      <div className="flex items-center gap-0.5">
        <button className={iconBtnClass} title="Search in conversation" onClick={onSearchToggle}>
          <MessageSquare size={15} />
        </button>
        <button className={iconBtnClass} title="Members">
          <Users size={15} />
        </button>
        <button className={iconBtnClass} title="Discussion">
          <Search size={15} />
        </button>
        <button className={iconBtnClass} title="Refresh">
          <RefreshCw size={15} />
        </button>
        <button className={iconBtnClass} title="More options">
          <MoreVertical size={15} />
        </button>
      </div>
    </div>
  );
}
