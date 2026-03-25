import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '@/hooks/useRelationshipMessages';
import { ArrowLeft, Send, Search, MessageCircle, ChevronDown, Smile, Reply, Copy, Trash2, X } from 'lucide-react';

// ── Reply encoding helpers ─────────────────────────────────────────────────
const REPLY_SEP = '||~||';
const REPLY_END = '||/REPLY||\n';

function encodeReply(replyId: string, senderName: string, preview: string, text: string): string {
  const safe = preview.slice(0, 120).replace(/\|\|/g, '|');
  return `||REPLY||${replyId}${REPLY_SEP}${senderName}${REPLY_SEP}${safe}${REPLY_END}${text}`;
}

function parseMsg(content: string): { isReply: boolean; replyId?: string; replySender?: string; replyPreview?: string; text: string } {
  if (!content.startsWith('||REPLY||')) return { isReply: false, text: content };
  const endIdx = content.indexOf(REPLY_END);
  if (endIdx === -1) return { isReply: false, text: content };
  const meta = content.slice(9, endIdx).split(REPLY_SEP);
  return { isReply: true, replyId: meta[0], replySender: meta[1], replyPreview: meta[2], text: content.slice(endIdx + REPLY_END.length) };
}

// ── Link renderer ─────────────────────────────────────────────────────────
function renderLinks(text: string) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRe).map((part, i) =>
    urlRe.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', opacity: 0.85 }} onClick={e => e.stopPropagation()}>{part}</a>
      : part
  );
}

// ── Party colour palette ──────────────────────────────────────────────────
const PALETTES = [
  { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#0891b2,#0e7490)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#059669,#047857)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#d97706,#b45309)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#db2777,#be185d)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', text: '#fff' },
];
function getPalette(name: string) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTES.length;
  return PALETTES[idx];
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtListTime(s: string) {
  const d = new Date(s), diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtMsgTime(s: string) { return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDateSep(s: string) {
  const d = new Date(s), diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── Avatar ────────────────────────────────────────────────────────────────
function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name.split(/[\s_]+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  const p = getPalette(name);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: p.bg, color: p.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
      {initials}
    </div>
  );
}

// ── Tick icons ────────────────────────────────────────────────────────────
const TickPending = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const TickSent = () => (
  <svg width="14" height="10" viewBox="0 0 16 11" fill="none" style={{ opacity: 0.5 }}>
    <path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/>
  </svg>
);
const TickRead = () => (
  <svg width="16" height="10" viewBox="0 0 18 11" fill="none">
    <path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="#22c55e"/>
    <path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="#22c55e"/>
  </svg>
);
const TickDelivered = () => (
  <svg width="16" height="10" viewBox="0 0 18 11" fill="none" style={{ opacity: 0.5 }}>
    <path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/>
    <path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="currentColor"/>
  </svg>
);

const QUICK_EMOJIS = ['👍','🙏','✅','💯','🔥','😊','👀','⏳','💰','🤝','😂','❤️','💪','🎯'];

// ── Types ─────────────────────────────────────────────────────────────────
interface ConvSummary {
  relationship_id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  unread_count: number;
}
interface Props {
  relationships: Array<{ id: string; counterparty_name: string; counterparty_nickname: string; merchant_a_id: string; merchant_b_id: string }>;
}
interface OptMsg { id: string; relationship_id: string; sender_id: string; content: string; read_at: null; created_at: string; _pending: true }
interface CtxMenu { msgId: string; x: number; y: number; isOwn: boolean; text: string }

// ═════════════════════════════════════════════════════════════════════════════
export function UnifiedChatInbox({ relationships }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();

  const [activeRelId, setActiveRelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; preview: string } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [optimistic, setOptimistic] = useState<OptMsg[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const relIds = useMemo(() => relationships.map(r => r.id), [relationships]);

  // ── Fetch messages ────────────────────────────────────────────────────
  const { data: allMessages = [], isLoading } = useQuery({
    queryKey: ['unified-chat', relIds],
    queryFn: async () => {
      if (!relIds.length) return [];
      const { data, error } = await supabase
        .from('merchant_messages').select('*').in('relationship_id', relIds).order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: relIds.length > 0,
  });

  // ── Realtime ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!relIds.length) return;
    const ch = supabase.channel('uchat-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [relIds, queryClient]);

  // ── Typing presence ───────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRelId || !userId) return;
    const ch = supabase.channel(`typing:${activeRelId}`, { config: { presence: { key: userId } } })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, Array<{ typing?: boolean }>>;
        const typers = Object.entries(state)
          .filter(([uid, arr]) => uid !== userId && arr[0]?.typing)
          .map(([uid]) => uid);
        setTypingUsers(typers);
      }).subscribe();
    typingChRef.current = ch;
    return () => { supabase.removeChannel(ch); typingChRef.current = null; setTypingUsers([]); };
  }, [activeRelId, userId]);

  const signalTyping = useCallback(async () => {
    if (!typingChRef.current) return;
    await typingChRef.current.track({ typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(async () => { await typingChRef.current?.track({ typing: false }); }, 1800);
  }, []);

  // ── Conversations ─────────────────────────────────────────────────────
  const conversations: ConvSummary[] = useMemo(() =>
    relationships.map(rel => {
      const msgs = allMessages.filter(m => m.relationship_id === rel.id);
      const last = msgs[msgs.length - 1];
      return {
        relationship_id: rel.id,
        counterparty_name: rel.counterparty_name,
        counterparty_nickname: rel.counterparty_nickname,
        last_message: last?.content || '',
        last_message_at: last?.created_at || '',
        last_sender_id: last?.sender_id || '',
        unread_count: msgs.filter(m => m.sender_id !== userId && !m.read_at).length,
      };
    }).sort((a, b) => {
      if (!a.last_message_at) return 1;
      if (!b.last_message_at) return -1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    }),
    [allMessages, relationships, userId]
  );

  const filteredConvs = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter(c => c.counterparty_name.toLowerCase().includes(q) || c.counterparty_nickname.toLowerCase().includes(q));
  }, [conversations, search]);

  const totalUnread = useMemo(() => conversations.reduce((s, c) => s + c.unread_count, 0), [conversations]);

  // ── Active conversation ────────────────────────────────────────────────
  const serverMsgs = useMemo(() => activeRelId ? allMessages.filter(m => m.relationship_id === activeRelId) : [], [allMessages, activeRelId]);
  const activeMessages = useMemo(() => {
    const serverIds = new Set(serverMsgs.map(m => m.id));
    return [...serverMsgs, ...optimistic.filter(m => m.relationship_id === activeRelId && !serverIds.has(m.id))];
  }, [serverMsgs, optimistic, activeRelId]);

  const activeRel = useMemo(() => relationships.find(r => r.id === activeRelId), [relationships, activeRelId]);
  const otherPalette = useMemo(() => activeRel ? getPalette(activeRel.counterparty_name) : PALETTES[0], [activeRel]);

  // ── Auto scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isAtBottom && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages, isAtBottom]);

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 60);
  }, []);

  // ── Mark read ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRelId || !userId || !allMessages.length) return;
    const unread = allMessages.filter(m => m.relationship_id === activeRelId && m.sender_id !== userId && !m.read_at);
    if (unread.length > 0) {
      Promise.all(unread.map(m => supabase.from('merchant_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id)))
        .then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
    }
  }, [activeRelId, allMessages, userId, queryClient]);

  // ── Send ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !activeRelId) return;
    const content = replyTo ? encodeReply(replyTo.id, replyTo.sender, replyTo.preview, trimmed) : trimmed;
    const tempId = `opt_${Date.now()}`;
    setOptimistic(p => [...p, { id: tempId, relationship_id: activeRelId, sender_id: userId!, content, read_at: null, created_at: new Date().toISOString(), _pending: true }]);
    setText('');
    setReplyTo(null);
    setShowEmoji(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (typingTimer.current) clearTimeout(typingTimer.current);
    await typingChRef.current?.track({ typing: false });
    try {
      await sendMessage.mutateAsync({ relationship_id: activeRelId, content });
      setOptimistic(p => p.filter(m => m.id !== tempId));
      queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    } catch { setOptimistic(p => p.filter(m => m.id !== tempId)); }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [text, activeRelId, replyTo, sendMessage, queryClient, userId]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') setReplyTo(null);
  }, [handleSend]);

  const onTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    signalTyping();
  }, [signalTyping]);

  // ── Context menu ──────────────────────────────────────────────────────
  const openCtx = useCallback((e: React.MouseEvent, msg: typeof activeMessages[0], isOwn: boolean) => {
    e.preventDefault();
    setCtx({ msgId: msg.id, x: e.clientX, y: e.clientY, isOwn, text: parseMsg(msg.content).text });
    setShowEmoji(false);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctx]);

  // ── Group by date ─────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const g: { date: string; messages: typeof activeMessages }[] = [];
    for (const m of activeMessages) {
      const dk = new Date(m.created_at).toDateString();
      const last = g[g.length - 1];
      if (last && last.date === dk) last.messages.push(m);
      else g.push({ date: dk, messages: [m] });
    }
    return g;
  }, [activeMessages]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}>
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MESSENGER VIEW
  // ═══════════════════════════════════════════════════════════════════════
  if (activeRelId && activeRel) {
    return (
      <div className="chat-messenger-view">

        {/* Header */}
        <div className="chat-messenger-header">
          <button onClick={() => { setActiveRelId(null); setText(''); setReplyTo(null); }} className="chat-back-btn">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar name={activeRel.counterparty_name} size={38} />
            <span className="chat-online-dot" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="chat-header-name">{activeRel.counterparty_name}</div>
            <div className="chat-header-status">
              {typingUsers.length > 0 ? <span style={{ color: '#22c55e' }}>typing…</span> : <span style={{ color: '#22c55e' }}>● Online</span>}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="chat-messenger-messages" onScroll={onScroll}>
          {activeMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon"><MessageCircle /></div>
              <p>No messages yet</p>
              <span>Send a message to start the conversation</span>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.date}>
                <div className="chat-date-separator"><span>{fmtDateSep(group.messages[0].created_at)}</span></div>
                {group.messages.map((m, idx) => {
                  const isOwn = m.sender_id === userId;
                  const isPending = (m as any)._pending === true;
                  const isFirst = group.messages[idx - 1]?.sender_id !== m.sender_id;
                  const isLast = group.messages[idx + 1]?.sender_id !== m.sender_id;
                  const parsed = parseMsg(m.content);

                  return (
                    <div
                      key={m.id}
                      className={`chat-bubble-row ${isOwn ? 'own' : 'other'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}`}
                      style={{ marginTop: isFirst ? 10 : 2, alignItems: 'flex-end', gap: 5 }}
                      onContextMenu={e => openCtx(e, m, isOwn)}
                    >
                      {/* Other's avatar — only on last bubble in a sequence */}
                      {!isOwn && (
                        <div style={{ width: 28, flexShrink: 0, alignSelf: 'flex-end' }}>
                          {isLast ? <Avatar name={activeRel.counterparty_name} size={28} /> : null}
                        </div>
                      )}

                      {/* Reply action (shows on hover) */}
                      {!isPending && isOwn && (
                        <button className="chat-hover-action" title="Reply"
                          onClick={() => setReplyTo({ id: m.id, sender: 'You', preview: parsed.text })}>
                          <Reply style={{ width: 12, height: 12 }} />
                        </button>
                      )}

                      {/* Bubble */}
                      <div
                        className={`chat-bubble ${isOwn ? 'own' : 'other'}`}
                        style={!isOwn ? { background: otherPalette.bg, color: otherPalette.text } : undefined}
                      >
                        {parsed.isReply && (
                          <div className="chat-reply-quote" style={{ borderLeftColor: isOwn ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)' }}>
                            <div className="chat-reply-quote-sender">{parsed.replySender}</div>
                            <div className="chat-reply-quote-text">{parsed.replyPreview}</div>
                          </div>
                        )}
                        <div className="chat-bubble-content">{renderLinks(parsed.text)}</div>
                        <div className="chat-bubble-meta">
                          <span>{fmtMsgTime(m.created_at)}</span>
                          {isOwn && (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {isPending ? <TickPending /> : m.read_at ? <TickRead /> : <TickDelivered />}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Reply action for incoming */}
                      {!isPending && !isOwn && (
                        <button className="chat-hover-action" title="Reply"
                          onClick={() => setReplyTo({ id: m.id, sender: activeRel.counterparty_name, preview: parsed.text })}>
                          <Reply style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {/* Typing dots */}
          {typingUsers.length > 0 && (
            <div className="chat-bubble-row other" style={{ marginTop: 8, alignItems: 'flex-end', gap: 5 }}>
              <div style={{ width: 28, flexShrink: 0 }}><Avatar name={activeRel.counterparty_name} size={28} /></div>
              <div className="chat-bubble other chat-typing-bubble" style={{ background: otherPalette.bg }}>
                <span className="chat-typing-dot" /><span className="chat-typing-dot" /><span className="chat-typing-dot" />
              </div>
            </div>
          )}
        </div>

        {/* Scroll to bottom */}
        {!isAtBottom && (
          <button className="chat-scroll-btn" onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; setIsAtBottom(true); }}>
            <ChevronDown style={{ width: 18, height: 18 }} />
          </button>
        )}

        {/* Reply bar */}
        {replyTo && (
          <div className="chat-reply-bar">
            <Reply style={{ width: 14, height: 14, opacity: 0.5, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-reply-bar-sender">Replying to {replyTo.sender}</div>
              <div className="chat-reply-bar-text">{replyTo.preview.slice(0, 80)}{replyTo.preview.length > 80 ? '…' : ''}</div>
            </div>
            <button className="chat-reply-bar-close" onClick={() => setReplyTo(null)}><X style={{ width: 14, height: 14 }} /></button>
          </div>
        )}

        {/* Emoji picker */}
        {showEmoji && (
          <div className="chat-emoji-picker">
            {QUICK_EMOJIS.map(e => (
              <button key={e} className="chat-emoji-btn" onClick={() => { setText(p => p + e); setShowEmoji(false); inputRef.current?.focus(); }}>{e}</button>
            ))}
          </div>
        )}

        {/* Input bar — always visible, never hidden */}
        <div className="chat-messenger-input">
          <button className="chat-emoji-toggle" onClick={() => setShowEmoji(p => !p)} type="button" title="Emoji">
            <Smile style={{ width: 20, height: 20 }} />
          </button>
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              value={text}
              onChange={onTextChange}
              onKeyDown={onKey}
              placeholder="Type a message…"
              rows={1}
              className="chat-input-field"
            />
          </div>
          <button onClick={handleSend} disabled={sendMessage.isPending || !text.trim()} className="chat-send-btn" type="button">
            <Send className="h-5 w-5" />
          </button>
        </div>

        {/* Context menu */}
        {ctx && (
          <div className="chat-context-menu" style={{ top: ctx.y, left: Math.min(ctx.x, window.innerWidth - 170) }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { navigator.clipboard?.writeText(ctx.text); setCtx(null); }}>
              <Copy style={{ width: 13, height: 13 }} /> Copy text
            </button>
            <button onClick={() => {
              const msg = activeMessages.find(m => m.id === ctx.msgId);
              if (msg) { const p = parseMsg(msg.content); setReplyTo({ id: msg.id, sender: ctx.isOwn ? 'You' : activeRel.counterparty_name, preview: p.text }); }
              setCtx(null);
            }}>
              <Reply style={{ width: 13, height: 13 }} /> Reply
            </button>
            {ctx.isOwn && (
              <button style={{ color: '#ef4444' }} onClick={async () => {
                await supabase.from('merchant_messages').delete().eq('id', ctx.msgId);
                queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
                setCtx(null);
              }}>
                <Trash2 style={{ width: 13, height: 13 }} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INBOX LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="chat-inbox-view">
      <div className="chat-inbox-header">
        <h2 style={{ fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          💬 {t('allConversations') || 'Chats'}
          {totalUnread > 0 && <span className="chat-unread-total">{totalUnread}</span>}
        </h2>
      </div>
      <div className="chat-inbox-search">
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, opacity: 0.4 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" className="chat-search-input" />
        </div>
      </div>
      <div className="chat-conversation-list">
        {filteredConvs.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon"><MessageCircle /></div>
            <p>No conversations yet</p>
            <span>Open a merchant relationship to start chatting</span>
          </div>
        ) : (
          filteredConvs.map(c => {
            const hasUnread = c.unread_count > 0;
            const lastText = c.last_message ? parseMsg(c.last_message).text : '';
            return (
              <button key={c.relationship_id} onClick={() => { setActiveRelId(c.relationship_id); setText(''); setReplyTo(null); setIsAtBottom(true); }} className={`chat-conversation-item ${hasUnread ? 'unread' : ''}`}>
                <Avatar name={c.counterparty_name} size={50} />
                <div className="chat-conversation-info">
                  <div className="chat-conversation-top">
                    <span className="chat-conversation-name">{c.counterparty_name}</span>
                    <span className={`chat-conversation-time ${hasUnread ? 'unread' : ''}`}>{c.last_message_at ? fmtListTime(c.last_message_at) : ''}</span>
                  </div>
                  <div className="chat-conversation-bottom">
                    <span className="chat-conversation-preview">
                      {c.last_sender_id === userId && <span className="chat-you-prefix">You: </span>}
                      {lastText || <span style={{ fontStyle: 'italic', opacity: 0.4 }}>No messages</span>}
                    </span>
                    {hasUnread && <span className="chat-unread-badge">{c.unread_count}</span>}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
