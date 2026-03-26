/* ═══════════════════════════════════════════════════════════════
   ConversationSidebar — Rocket.Chat-style left panel
   Features: Search, Unread/Muted filters, last message preview,
   time stamps, responsive (icons on tablet, drawer on mobile)
   ═══════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import {
  MessageSquare, ShieldCheck, Receipt, FileText, Mail,
  ChevronDown, ChevronRight, X, Menu, Search, VolumeX,
} from 'lucide-react';
import { useChatStore, selectTotalUnread } from '@/lib/chat-store';
import type { ConversationSummary } from '@/lib/chat-store';
import { getPalette, parseMsg, fmtListTime } from '../lib/message-codec';
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
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<'all' | 'unread' | 'muted'>('all');
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const totalUnread = useChatStore(selectTotalUnread);
  const isMobile = useIsMobile();

  const approvalCount = 2; // placeholder

  // Filter conversations
  const filteredConvs = useMemo(() => {
    let list = conversations;
    const q = search.toLowerCase().trim();
    if (q) list = list.filter(c =>
      c.counterparty_name.toLowerCase().includes(q) ||
      c.counterparty_nickname.toLowerCase().includes(q)
    );
    if (folder === 'unread') list = list.filter(c => c.unread_count > 0);
    if (folder === 'muted') list = list.filter(c => c.is_muted);
    return list;
  }, [conversations, search, folder]);

  const handleSelectConversation = (id: string) => {
    setActive(id);
    if (isMobile) setMobileOpen(false);
  };

  /* ── Sidebar content (shared between desktop and mobile drawer) ── */
  const sidebarContent = (expanded: boolean) => (
    <>
      {/* Search */}
      {expanded && (
        <div className="px-3 pt-2 pb-1">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-accent/30 border border-border rounded text-[11px] pl-7 pr-2 py-1.5 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Folder tabs */}
      {expanded && (
        <div className="flex gap-0 px-3 pb-1">
          {(['all', 'unread', 'muted'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFolder(f)}
              className={`px-2.5 py-1 text-[10px] font-bold capitalize transition-colors rounded-sm ${
                folder === f
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'unread'
                ? `Unread${conversations.filter(c => c.unread_count > 0).length ? ` (${conversations.filter(c => c.unread_count > 0).length})` : ''}`
                : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Channels */}
      <button
        onClick={() => setChannelsOpen(!channelsOpen)}
        className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
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
                className={`flex items-center gap-2.5 py-1.5 text-[12px] font-semibold transition-colors w-full text-left relative ${
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
        className="flex items-center gap-2 px-3 py-2 mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors w-full text-left"
      >
        {expanded && (directsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        <Mail size={12} />
        {expanded && <span>Directs</span>}
      </button>

      {directsOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredConvs.length === 0 ? (
            expanded ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-[11px]">
                {folder === 'unread' ? 'No unread messages' : folder === 'muted' ? 'No muted chats' : search ? 'No results' : 'No contacts yet'}
              </div>
            ) : null
          ) : (
            filteredConvs.map((conv) => {
              const isActive = conv.relationship_id === activeId;
              const palette = getPalette(conv.counterparty_name);
              const lastParsed = conv.last_message ? parseMsg(conv.last_message) : null;
              const lastPreview = lastParsed
                ? (lastParsed.isVoice ? '🎤 Voice message' : lastParsed.isPoll ? '📊 Poll' : lastParsed.text)
                : '';
              const hasUnread = conv.unread_count > 0;
              return (
                <button
                  key={conv.relationship_id}
                  onClick={() => handleSelectConversation(conv.relationship_id)}
                  title={!expanded ? (conv.counterparty_nickname || conv.counterparty_name) : undefined}
                  className={`flex items-center gap-2.5 py-2 w-full text-left transition-colors relative ${
                    expanded ? 'px-3' : 'px-0 justify-center'
                  } ${
                    isActive
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-extrabold"
                    style={{ background: palette.bg, color: palette.text }}
                  >
                    {conv.counterparty_name.charAt(0).toUpperCase()}
                  </div>
                  {expanded && (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-[12px] font-semibold truncate ${hasUnread ? 'text-foreground' : ''}`}>
                          {conv.counterparty_nickname || conv.counterparty_name}
                        </span>
                        {conv.last_message_at && (
                          <span className={`text-[9px] flex-shrink-0 ml-1 ${hasUnread ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                            {fmtListTime(conv.last_message_at)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-muted-foreground truncate flex-1">
                          {conv.is_muted && <VolumeX className="inline w-2.5 h-2.5 mr-0.5 opacity-50" />}
                          {conv.last_sender_id === currentUserId && <span className="text-primary font-semibold">You: </span>}
                          {lastPreview || <span className="italic opacity-50">No messages yet</span>}
                        </span>
                        {hasUnread && (
                          <span className="bg-destructive text-destructive-foreground text-[9px] font-extrabold rounded px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0 ml-1">
                            {conv.unread_count > 99 ? '99+' : conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
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
        {mobileOpen && (
          <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
            <div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-card border-r border-border flex flex-col overflow-hidden animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Messages</span>
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
      <div className="hidden md:flex lg:hidden flex-col h-full w-[52px] flex-shrink-0 border-r border-border bg-card overflow-hidden">
        {sidebarContent(false)}
      </div>
      <div className="hidden lg:flex flex-col h-full w-[240px] flex-shrink-0 border-r border-border bg-card overflow-hidden">
        {sidebarContent(true)}
      </div>
    </>
  );
}
