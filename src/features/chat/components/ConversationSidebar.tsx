/* ═══════════════════════════════════════════════════════════════
   ConversationSidebar — Rocket.Chat-style left panel
   Responsive: full on desktop, icons on tablet, drawer on mobile
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { MessageSquare, ShieldCheck, Receipt, FileText, Mail, ChevronDown, ChevronRight, X, Menu } from 'lucide-react';
import { useChatStore, selectTotalUnread } from '@/lib/chat-store';
import type { ConversationSummary } from '@/lib/chat-store';
import { getPalette } from '../lib/message-codec';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  conversations: ConversationSummary[];
  currentUserId: string;
}

const CHANNEL_ITEMS = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { key: 'settlements', label: 'Settlements', icon: Receipt },
  { key: 'agreements', label: 'Agreements', icon: FileText },
];

export function ConversationSidebar({ conversations, currentUserId }: Props) {
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [directsOpen, setDirectsOpen] = useState(true);
  const [activeChannel, setActiveChannel] = useState('chat');
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const totalUnread = useChatStore(selectTotalUnread);
  const isMobile = useIsMobile();

  const approvalCount = 2; // placeholder

  const handleSelectConversation = (id: string) => {
    setActive(id);
    if (isMobile) setMobileOpen(false);
  };

  /* ── Sidebar content (shared between desktop and mobile drawer) ── */
  const sidebarContent = (expanded: boolean) => (
    <>
      {/* Channels */}
      <button
        onClick={() => setChannelsOpen(!channelsOpen)}
        className="flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
      >
        {expanded && (channelsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        {expanded && <span>Channels</span>}
        {!expanded && <MessageSquare size={14} className="mx-auto" />}
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
                title={!expanded ? ch.label : undefined}
                className={`flex items-center gap-2.5 py-1.5 text-[12px] font-semibold transition-colors w-full text-left ${
                  expanded ? 'px-4' : 'px-0 justify-center'
                } ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
                }`}
              >
                <Icon size={14} style={{ color: isActive ? 'hsl(var(--primary))' : undefined }} />
                {expanded && <span className="flex-1">{ch.label}</span>}
                {expanded && badge > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center">
                    {badge}
                  </span>
                )}
                {!expanded && badge > 0 && (
                  <span className="absolute top-0 right-0.5 w-2 h-2 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Directs */}
      <button
        onClick={() => setDirectsOpen(!directsOpen)}
        className="flex items-center gap-2 px-3 py-2.5 mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
      >
        {expanded && (directsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        <Mail size={12} />
        {expanded && <span>Directs</span>}
      </button>

      {directsOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {conversations.length === 0 ? (
            expanded ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-[11px]">
                No contacts yet
              </div>
            ) : null
          ) : (
            conversations.map((conv) => {
              const isActive = conv.relationship_id === activeId;
              const palette = getPalette(conv.counterparty_name);
              return (
                <button
                  key={conv.relationship_id}
                  onClick={() => handleSelectConversation(conv.relationship_id)}
                  title={!expanded ? (conv.counterparty_nickname || conv.counterparty_name) : undefined}
                  className={`flex items-center gap-2.5 py-1.5 w-full text-left transition-colors relative ${
                    expanded ? 'px-3' : 'px-0 justify-center'
                  } ${
                    isActive
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-extrabold"
                    style={{ background: palette.bg, color: palette.text }}
                  >
                    {conv.counterparty_name.charAt(0).toUpperCase()}
                  </div>
                  {expanded && (
                    <span className="flex-1 text-[12px] font-semibold truncate">
                      {conv.counterparty_nickname || conv.counterparty_name}
                    </span>
                  )}
                  {conv.unread_count > 0 && expanded && (
                    <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                  {conv.unread_count > 0 && !expanded && (
                    <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-destructive" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );

  /* ── Mobile: hamburger trigger + drawer overlay ── */
  if (isMobile) {
    return (
      <>
        {/* Floating trigger */}
        {!mobileOpen && !activeId && (
          <button
            onClick={() => setMobileOpen(true)}
            className="fixed top-16 left-3 z-50 bg-card border border-border rounded-lg p-2 shadow-lg"
          >
            <Menu size={20} className="text-foreground" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </button>
        )}

        {/* Drawer */}
        {mobileOpen && (
          <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
            <div className="fixed inset-y-0 left-0 z-50 w-[260px] bg-card border-r border-border flex flex-col overflow-hidden animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conversations</span>
                <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                  <X size={16} />
                </button>
              </div>
              {sidebarContent(true)}
            </div>
          </>
        )}
      </>
    );
  }

  /* ── Desktop / Tablet ── */
  return (
    <>
      {/* Full sidebar on lg+, icon-only on md */}
      <div className="hidden md:flex lg:hidden flex-col h-full w-[52px] flex-shrink-0 border-r border-border bg-card overflow-hidden">
        {sidebarContent(false)}
      </div>
      <div className="hidden lg:flex flex-col h-full w-[220px] flex-shrink-0 border-r border-border bg-card overflow-hidden">
        {sidebarContent(true)}
      </div>
    </>
  );
}
