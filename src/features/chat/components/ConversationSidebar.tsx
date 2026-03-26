/* ═══════════════════════════════════════════════════════════════
   ConversationSidebar — Rocket.Chat-style left panel
   Two sections: Channels (nav links) + Directs (contacts)
   ═══════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import { MessageSquare, ShieldCheck, Receipt, FileText, Mail, ChevronDown, ChevronRight } from 'lucide-react';
import { useChatStore, selectTotalUnread } from '@/lib/chat-store';
import type { ConversationSummary } from '@/lib/chat-store';
import { getPalette } from '../lib/message-codec';

interface Props {
  conversations: ConversationSummary[];
  currentUserId: string;
}

const CHANNEL_ITEMS = [
  { key: 'chat', label: 'Chat', icon: MessageSquare, color: 'hsl(var(--primary))' },
  { key: 'approvals', label: 'Approvals', icon: ShieldCheck, color: 'hsl(var(--destructive))' },
  { key: 'settlements', label: 'Settlements', icon: Receipt, color: 'hsl(var(--muted-foreground))' },
  { key: 'agreements', label: 'Agreements', icon: FileText, color: 'hsl(var(--muted-foreground))' },
];

export function ConversationSidebar({ conversations, currentUserId }: Props) {
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [directsOpen, setDirectsOpen] = useState(true);
  const [activeChannel, setActiveChannel] = useState('chat');
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const totalUnread = useChatStore(selectTotalUnread);

  // Compute per-channel badge counts (approvals from conversations for now)
  const approvalCount = 2; // placeholder

  return (
    <div className="flex flex-col h-full w-[220px] flex-shrink-0 border-r border-border bg-card overflow-hidden">

      {/* ── Channels Section ── */}
      <button
        onClick={() => setChannelsOpen(!channelsOpen)}
        className="flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
      >
        {channelsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Channels</span>
      </button>

      {channelsOpen && (
        <div className="flex flex-col">
          {CHANNEL_ITEMS.map((ch) => {
            const Icon = ch.icon;
            const isActive = activeChannel === ch.key;
            const badge = ch.key === 'approvals' ? approvalCount : ch.key === 'chat' && totalUnread > 0 ? totalUnread : 0;
            return (
              <button
                key={ch.key}
                onClick={() => setActiveChannel(ch.key)}
                className={`flex items-center gap-2.5 px-4 py-1.5 text-[12px] font-semibold transition-colors w-full text-left ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
                }`}
              >
                <Icon size={14} style={{ color: isActive ? 'hsl(var(--primary))' : undefined }} />
                <span className="flex-1">{ch.label}</span>
                {badge > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Directs Section ── */}
      <button
        onClick={() => setDirectsOpen(!directsOpen)}
        className="flex items-center gap-2 px-3 py-2.5 mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
      >
        {directsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Mail size={12} />
        <span>Directs</span>
      </button>

      {directsOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {conversations.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted-foreground text-[11px]">
              No contacts yet
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.relationship_id === activeId;
              const palette = getPalette(conv.counterparty_name);
              return (
                <button
                  key={conv.relationship_id}
                  onClick={() => setActive(conv.relationship_id)}
                  className={`flex items-center gap-2.5 px-3 py-1.5 w-full text-left transition-colors ${
                    isActive
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-extrabold"
                    style={{ background: palette.bg, color: palette.text }}
                  >
                    {conv.counterparty_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-[12px] font-semibold truncate">
                    {conv.counterparty_nickname || conv.counterparty_name}
                  </span>
                  {conv.unread_count > 0 && (
                    <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
