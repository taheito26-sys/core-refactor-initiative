import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '@/hooks/useRelationshipMessages';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Search, MessageCircle, ChevronDown, Smile, Reply, Copy,
  Trash2, X, Pin, Star, Forward, Edit3, Lock, Volume2, VolumeX, Clock,
  CheckSquare, Megaphone, Filter, AtSign, Phone, MoreVertical, Image,
  Mic, MicOff, StopCircle, BookmarkCheck, Eye, Shield
} from 'lucide-react';
import { parseMsg, encodeVoice, encodeReply, encodeForward, encodeEdited, encodeScheduled, encodePoll, fmtDateSeparator as fmtDateSep, fmtMsgTime } from '@/features/chat/lib/message-codec';


// ─── Link renderer ─────────────────────────────────────────────────────────
function renderLinks(text: string) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRe).map((part, i) =>
    urlRe.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', opacity: 0.85 }} onClick={e => e.stopPropagation()}>{part}</a>
      : part
  );
}

// ─── Party palette ─────────────────────────────────────────────────────────
const PALETTES = [
  { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#0891b2,#0e7490)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#059669,#047857)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#d97706,#b45309)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#db2777,#be185d)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', text: '#fff' },
];
function getPalette(name: string | null | undefined) {
  const safeName = name || 'Anonymous';
  return PALETTES[safeName.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTES.length];
}

// ─── Formatters ────────────────────────────────────────────────────────────
function fmtListTime(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Avatar({ name, size = 48 }: { name: string | null | undefined; size?: number }) {
  const safeName = name || 'Anonymous';
  const initials = safeName.split(/[\s_]+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  const p = getPalette(safeName);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: p.bg, color: p.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
      {initials}
    </div>
  );
}

const TickPending = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const TickDelivered = () => (
  <svg width="16" height="10" viewBox="0 0 18 11" fill="none" style={{ opacity: 0.5 }}>
    <path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/>
    <path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="currentColor"/>
  </svg>
);
const TickRead = () => (
  <svg width="16" height="10" viewBox="0 0 18 11" fill="none">
    <path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="#22c55e"/>
    <path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="#22c55e"/>
  </svg>
);

const QUICK_EMOJIS = ['👍','🙏','✅','💯','🔥','😊','👀','⏳','💰','🤝','😂','❤️','💪','🎯','🚀','⚡','🎉','💎'];
const REACTION_EMOJIS = ['❤️','👍','😂','😮','😢','😡','🙏','💯'];

// ─── LS helpers ─────────────────────────────────────────────────────────────
function lsGet<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Message { id: string; relationship_id: string; sender_id: string; content: string; read_at: string | null; created_at: string; expires_at?: string | null }
interface OptMsg extends Message { _pending: true }
interface ConvSummary { relationship_id: string; counterparty_name: string; counterparty_nickname: string; last_message: string; last_message_at: string; last_sender_id: string; unread_count: number }
interface CtxMenu { msgId: string; x: number; y: number; isOwn: boolean; text: string; raw: string }
interface Props { relationships: Array<{ id: string; counterparty_name: string; counterparty_nickname: string; merchant_a_id: string; merchant_b_id: string }>; fullPage?: boolean }

// ─── Poll vote component ────────────────────────────────────────────────────
function PollBubble({ msgId, question, options, isOwn }: { msgId: string; question: string; options: string[]; isOwn: boolean }) {
  const [votes, setVotes] = useState<Record<string, number>>(() => lsGet(`cpoll_${msgId}`, {}));
  const [myVote, setMyVote] = useState<string | null>(() => lsGet(`cmyvote_${msgId}`, null));
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  const vote = (opt: string) => {
    if (myVote) return;
    const newVotes = { ...votes, [opt]: (votes[opt] || 0) + 1 };
    setVotes(newVotes); setMyVote(opt);
    lsSet(`cpoll_${msgId}`, newVotes); lsSet(`cmyvote_${msgId}`, opt);
  };
  return (
    <div className="chat-poll-bubble">
      <div className="chat-poll-question">📊 {question}</div>
      {options.map(opt => {
        const count = votes[opt] || 0;
        const pct = total > 0 ? Math.round(count / total * 100) : 0;
        const isWinner = myVote && count === Math.max(...Object.values(votes));
        return (
          <button key={opt} className={`chat-poll-option ${myVote === opt ? 'voted' : ''} ${myVote && isWinner ? 'winner' : ''}`} onClick={() => vote(opt)} disabled={!!myVote}>
            <div className="chat-poll-bar" style={{ width: `${pct}%` }} />
            <span className="chat-poll-label">{opt}</span>
            {myVote && <span className="chat-poll-pct">{pct}%</span>}
          </button>
        );
      })}
      {myVote && <div className="chat-poll-total">{total} vote{total !== 1 ? 's' : ''}</div>}
    </div>
  );
}

// ─── Voice Note Player ────────────────────────────────────────────────────
function VoicePlayer({ base64, duration, isOwn }: { base64: string; duration: number; isOwn: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState(false);

  // Build the object URL once from base64
  const srcUrl = useMemo(() => {
    if (!base64) return '';
    try {
      const byteChars = atob(base64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: 'audio/webm;codecs=opus' });
      return URL.createObjectURL(blob);
    } catch { return ''; }
  }, [base64]);

  useEffect(() => {
    return () => { if (srcUrl) URL.revokeObjectURL(srcUrl); };
  }, [srcUrl]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => setAudioError(true)); setPlaying(true); }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const displayDur = playing || currentTime > 0 ? fmtTime(currentTime) : fmtTime(duration);

  return (
    <div className={`chat-voice-player ${isOwn ? 'own' : 'other'}`}>
      <audio
        ref={audioRef}
        src={srcUrl}
        onCanPlay={() => setAudioReady(true)}
        onError={() => setAudioError(true)}
        onTimeUpdate={e => {
          const a = e.currentTarget;
          const dur = a.duration || duration || 1;
          setProgress((a.currentTime / dur) * 100);
          setCurrentTime(a.currentTime);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
        preload="metadata"
      />
      {audioError ? (
        <span style={{ fontSize: 10, opacity: 0.5 }}>⚠ Audio unavailable</span>
      ) : (
        <>
          <button
            className="chat-voice-play-btn"
            onClick={togglePlay}
            disabled={!audioReady}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <div className="chat-voice-body">
            <div className="chat-voice-waveform" onClick={e => {
              const a = audioRef.current;
              if (!a || !a.duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              a.currentTime = pct * a.duration;
            }}>
              {/* Fake waveform bars */}
              {Array.from({ length: 28 }).map((_, i) => {
                const h = 20 + Math.sin(i * 1.3) * 12 + Math.cos(i * 0.7) * 8;
                const filled = (i / 28) * 100 <= progress;
                return (
                  <div key={i} className="chat-voice-bar" style={{
                    height: `${Math.max(6, h)}px`,
                    background: filled
                      ? (isOwn ? '#fff' : 'rgba(139,92,246,0.9)')
                      : (isOwn ? 'rgba(255,255,255,0.3)' : 'rgba(139,92,246,0.25)'),
                  }} />
                );
              })}
            </div>
            <div className="chat-voice-time">{displayDur}</div>
          </div>
          <div className="chat-voice-mic-icon">🎤</div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export function UnifiedChatInbox({ relationships, fullPage }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();

  // ── Core state ───────────────────────────────────────────────────────────
  const [activeRelId, setActiveRelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; preview: string } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [optimistic, setOptimistic] = useState<OptMsg[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);

  // ── New feature state ────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [msgSearch, setMsgSearch] = useState('');
  const [showPollCreate, setShowPollCreate] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [inboxFolder, setInboxFolder] = useState<'all' | 'unread' | 'muted'>('all');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [showStarred, setShowStarred] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // ── Persisted state (localStorage) ──────────────────────────────────────
  const [mutedRels, setMutedRels] = useState<string[]>(() => lsGet('cmute', []));
  const [pinnedMsgs, setPinnedMsgs] = useState<Record<string, string>>(() => lsGet('cpin', {}));
  const [starredMsgs, setStarredMsgs] = useState<Record<string, string[]>>(() => lsGet('cstar', {}));
  const [disappearing, setDisappearing] = useState<Record<string, '24h' | '7d' | 'off'>>(() => lsGet('cdis', {}));
  const [secretChats, setSecretChats] = useState<string[]>(() => lsGet('csecret', []));
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>(() => lsGet('creact', {}));

  // ── Refs ─────────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const typingChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const relIds = useMemo(() => relationships.map(r => r.id), [relationships]);

  // ── Fetch messages ────────────────────────────────────────────────────────
  const { data: allMessages = [], isLoading } = useQuery({
    queryKey: ['unified-chat', relIds],
    queryFn: async () => {
      if (!relIds.length) return [];
      const { data, error } = await supabase
        .from('merchant_messages').select('*').in('relationship_id', relIds).order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as Message[];
    },
    enabled: relIds.length > 0,
    staleTime: 10_000,
  });

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!relIds.length) return;
    const ch = supabase.channel('uchat-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [relIds, queryClient]);

  // ── Typing presence ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRelId || !userId) return;
    const ch = supabase.channel(`typing:${activeRelId}`, { config: { presence: { key: userId } } })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, Array<{ typing?: boolean }>>;
        setTypingUsers(Object.entries(state).filter(([uid, arr]) => uid !== userId && arr[0]?.typing).map(([uid]) => uid));
      }).subscribe();
    typingChRef.current = ch;
    return () => { supabase.removeChannel(ch); typingChRef.current = null; setTypingUsers([]); };
  }, [activeRelId, userId]);

  const signalTyping = useCallback(async () => {
    if (!typingChRef.current) return;
    await typingChRef.current.track({ typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => typingChRef.current?.track({ typing: false }), 1800);
  }, []);

  // ── Mark read ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRelId || !userId || !allMessages.length) return;
    const unread = allMessages.filter(m => m.relationship_id === activeRelId && m.sender_id !== userId && !m.read_at);
    if (unread.length) Promise.all(unread.map(m => supabase.from('merchant_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id))).then(() => queryClient.invalidateQueries({ queryKey: ['unified-chat'] }));
  }, [activeRelId, allMessages, userId, queryClient]);

  // ── Conversations ──────────────────────────────────────────────────────────
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
    }).sort((a, b) => (!a.last_message_at ? 1 : !b.last_message_at ? -1 : new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())),
    [allMessages, relationships, userId]
  );

  const filteredConvs = useMemo(() => {
    let list = conversations;
    const q = search.toLowerCase().trim();
    if (q) list = list.filter(c => c.counterparty_name.toLowerCase().includes(q) || c.counterparty_nickname.toLowerCase().includes(q));
    if (inboxFolder === 'unread') list = list.filter(c => c.unread_count > 0);
    if (inboxFolder === 'muted') list = list.filter(c => mutedRels.includes(c.relationship_id));
    return list;
  }, [conversations, search, inboxFolder, mutedRels]);

  const totalUnread = useMemo(() => conversations.filter(c => !mutedRels.includes(c.relationship_id)).reduce((s, c) => s + c.unread_count, 0), [conversations, mutedRels]);

  // ── Active conversation ────────────────────────────────────────────────────
  const serverMsgs = useMemo(() => activeRelId ? allMessages.filter(m => m.relationship_id === activeRelId) : [], [allMessages, activeRelId]);

  // Apply disappearing filter
  const visibleServerMsgs = useMemo(() => {
    if (!activeRelId) return serverMsgs;
    const dis = disappearing[activeRelId] || 'off';
    if (dis === 'off') return serverMsgs;
    const ms = dis === '24h' ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
    const cutoff = Date.now() - ms;
    return serverMsgs.filter(m => new Date(m.created_at).getTime() > cutoff);
  }, [serverMsgs, activeRelId, disappearing]);

  const activeMessages: (Message | OptMsg)[] = useMemo(() => {
    const serverIds = new Set(visibleServerMsgs.map(m => m.id));
    return [...visibleServerMsgs, ...optimistic.filter(m => m.relationship_id === activeRelId && !serverIds.has(m.id))];
  }, [visibleServerMsgs, optimistic, activeRelId]);

  const filteredActiveMessages = useMemo(() => {
    if (!msgSearch.trim()) return activeMessages;
    const q = msgSearch.toLowerCase();
    return activeMessages.filter(m => m.content.toLowerCase().includes(q));
  }, [activeMessages, msgSearch]);

  const activeRel = useMemo(() => relationships.find(r => r.id === activeRelId), [relationships, activeRelId]);
  const otherPalette = useMemo(() => activeRel ? getPalette(activeRel.counterparty_name) : PALETTES[0], [activeRel]);

  const starredInActive = useMemo(() => {
    if (!activeRelId) return [];
    const ids = new Set(starredMsgs[activeRelId] || []);
    return activeMessages.filter(m => ids.has(m.id));
  }, [activeMessages, activeRelId, starredMsgs]);

  const pinnedMsg = useMemo(() => {
    if (!activeRelId || !pinnedMsgs[activeRelId]) return null;
    return activeMessages.find(m => m.id === pinnedMsgs[activeRelId]) || null;
  }, [activeMessages, activeRelId, pinnedMsgs]);

  const grouped = useMemo(() => {
    const g: { date: string; messages: typeof filteredActiveMessages }[] = [];
    for (const m of filteredActiveMessages) {
      const dk = new Date(m.created_at).toDateString();
      const last = g[g.length - 1];
      if (last && last.date === dk) last.messages.push(m);
      else g.push({ date: dk, messages: [m] });
    }
    return g;
  }, [filteredActiveMessages]);

  // ── Auto scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAtBottom && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages, isAtBottom]);

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 60);
  }, []);

  // ── LS helpers ────────────────────────────────────────────────────────────
  const toggleMute = (relId: string) => { const next = mutedRels.includes(relId) ? mutedRels.filter(x => x !== relId) : [...mutedRels, relId]; setMutedRels(next); lsSet('cmute', next); };
  const toggleSecret = (relId: string) => { const next = secretChats.includes(relId) ? secretChats.filter(x => x !== relId) : [...secretChats, relId]; setSecretChats(next); lsSet('csecret', next); };
  const setDisappearTimer = (relId: string, val: '24h' | '7d' | 'off') => { const next = { ...disappearing, [relId]: val }; setDisappearing(next); lsSet('cdis', next); };
  const togglePin = (relId: string, msgId: string) => { const cur = pinnedMsgs[relId]; const next = cur === msgId ? { ...pinnedMsgs } : { ...pinnedMsgs, [relId]: msgId }; if (cur === msgId) delete next[relId]; setPinnedMsgs(next); lsSet('cpin', next); };
  const toggleStar = (relId: string, msgId: string) => { const cur = starredMsgs[relId] || []; const next = cur.includes(msgId) ? cur.filter(x => x !== msgId) : [...cur, msgId]; const all = { ...starredMsgs, [relId]: next }; setStarredMsgs(all); lsSet('cstar', all); };
  const addReaction = (relId: string, msgId: string, emoji: string) => {
    const relR = reactions[relId] || {};
    const cur = relR[msgId] || [];
    const next = cur.includes(emoji) ? cur.filter(e => e !== emoji) : [...cur, emoji];
    const newR = { ...reactions, [relId]: { ...relR, [msgId]: next } };
    setReactions(newR); lsSet('creact', newR); setReactionTarget(null);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (overrideContent?: string) => {
    const trimmed = (overrideContent ?? text).trim();
    if (!trimmed || !activeRelId) return;
    const content = replyTo ? encodeReply(replyTo.id, replyTo.sender, replyTo.preview, trimmed) : trimmed;
    const tempId = `opt_${Date.now()}`;
    setOptimistic(p => [...p, { id: tempId, relationship_id: activeRelId, sender_id: userId!, content, read_at: null, created_at: new Date().toISOString(), _pending: true }]);
    if (!overrideContent) setText('');
    setReplyTo(null); setShowEmoji(false);
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

  const handleScheduleSend = async () => {
    if (!scheduleTime || !text.trim() || !activeRelId) return;
    const content = encodeScheduled(scheduleTime, text.trim());
    await sendMessage.mutateAsync({ relationship_id: activeRelId, content });
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setText(''); setScheduleTime(''); setShowSchedule(false);
  };

  const handleEdit = async () => {
    if (!editingId || !editText.trim()) return;
    const edited = encodeEdited(editText.trim(), new Date().toISOString());
    await supabase.from('merchant_messages').update({ content: edited }).eq('id', editingId);
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setEditingId(null); setEditText('');
  };

  const handleForward = async (targetRelId: string) => {
    if (!forwardMsg) return;
    const p = parseMsg(forwardMsg.content);
    const srcName = forwardMsg.sender_id === userId ? 'You' : (activeRel?.counterparty_name || 'Unknown');
    const content = encodeForward(srcName, p.text, '');
    await sendMessage.mutateAsync({ relationship_id: targetRelId, content: content.replace('\n', '') });
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setForwardMsg(null);
  };

  const handleSendPoll = async () => {
    if (!pollQuestion.trim() || pollOpts.filter(o => o.trim()).length < 2 || !activeRelId) return;
    const content = encodePoll(pollQuestion.trim(), pollOpts.filter(o => o.trim()));
    await sendMessage.mutateAsync({ relationship_id: activeRelId, content });
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setShowPollCreate(false); setPollQuestion(''); setPollOpts(['', '']);
  };

  const handleBroadcast = async () => {
    if (!broadcastText.trim()) return;
    await Promise.all(relationships.map(r => sendMessage.mutateAsync({ relationship_id: r.id, content: broadcastText.trim() })));
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setBroadcastText(''); setShowBroadcast(false);
  };

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (!file) return;
      setText(p => p + `[📎 Image: ${file.name || 'pasted'}]`);
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      recordingTimeRef.current = 0;
      streamRef.current = stream;
      // Prefer opus/webm for compression; fall back to whatever browser supports
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };

      // IMPORTANT: attach onstop BEFORE mr.start() so the event is never missed
      mr.onstop = async () => {
        const durationSec = recordingTimeRef.current || 1;
        const blobMime = mr.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: blobMime });
        // Convert to base64 for storage in the message content
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = reader.result as string;
          // dataUrl = "data:audio/webm;base64,AAAA..."
          const base64 = dataUrl.split(',')[1];
          if (!base64 || !activeRelId) return;
          const content = encodeVoice(durationSec, base64);
          // Send directly (bypass text state)
          const tempId = `opt_${Date.now()}`;
          setOptimistic(p => [...p, { id: tempId, relationship_id: activeRelId, sender_id: userId!, content, read_at: null, created_at: new Date().toISOString(), _pending: true }]);
          try {
            await sendMessage.mutateAsync({ relationship_id: activeRelId, content });
            setOptimistic(p => p.filter(m => m.id !== tempId));
            queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
          } catch { setOptimistic(p => p.filter(m => m.id !== tempId)); }
        };
        reader.readAsDataURL(blob);
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
      };

      mr.start(100); // collect every 100ms — onstop is already wired above
      mediaRecorderRef.current = mr;
      setIsRecording(true); setRecordingTime(0);
      recordingTimer.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(t => t + 1);
      }, 1000);
    } catch (err: any) {
      toast.error('Microphone access denied. Please allow microphone permissions.');
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    // Clear timer and update UI immediately
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    setIsRecording(false);
    // Stop all tracks to release microphone
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    // Calling mr.stop() triggers the pre-attached onstop handler (which processes & sends audio)
    mr.stop();
  };

  const scrollToMsg = (msgId: string) => {
    const el = msgRefs.current[msgId];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(255,255,255,0.12)'; setTimeout(() => { if (el) el.style.background = ''; }, 1200); }
  };

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { setReplyTo(null); setShowEmoji(false); }
  }, [handleSend]);

  const onTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    signalTyping();
  }, [signalTyping]);

  const openCtx = useCallback((e: React.MouseEvent, msg: Message | OptMsg, isOwn: boolean) => {
    e.preventDefault(); setCtx({ msgId: msg.id, x: e.clientX, y: e.clientY, isOwn, text: parseMsg(msg.content).text, raw: msg.content }); setShowEmoji(false);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctx]);

  const openConv = (relId: string) => { setActiveRelId(relId); setText(''); setReplyTo(null); setIsAtBottom(true); setShowMsgSearch(false); setMsgSearch(''); setShowChatInfo(false); setShowStarred(false); };
  const closeConv = () => { setActiveRelId(null); setText(''); setReplyTo(null); setShowChatInfo(false); setShowStarred(false); setShowMsgSearch(false); };

  const isSecret = activeRelId ? secretChats.includes(activeRelId) : false;
  const isMuted = activeRelId ? mutedRels.includes(activeRelId) : false;
  const disTimer = activeRelId ? (disappearing[activeRelId] || 'off') : 'off';

  if (isLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}><div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" /></div>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSENGER VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (activeRelId && activeRel) {
    return (
      <div className={`chat-messenger-view ${isSecret ? 'secret' : ''} ${fullPage ? 'full-page' : ''}`}>

        {/* Header */}
        <div className={`chat-messenger-header ${isSecret ? 'secret' : ''}`}>
          <button onClick={closeConv} className="chat-back-btn"><ArrowLeft className="h-5 w-5" /></button>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar name={activeRel.counterparty_name} size={38} />
            <span className="chat-online-dot" />
          </div>
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setShowChatInfo(p => !p)}>
            <div className="chat-header-name">
              {isSecret && <Lock style={{ width: 12, height: 12, display: 'inline', marginRight: 4, color: '#22c55e' }} />}
              {activeRel.counterparty_name}
            </div>
            <div className="chat-header-status">
              {typingUsers.length > 0 ? <span style={{ color: '#22c55e' }}>typing…</span> : <span style={{ color: '#22c55e' }}>● Online</span>}
              {disTimer !== 'off' && <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.7 }}>⏱ {disTimer}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="chat-icon-btn" onClick={() => setShowMsgSearch(p => !p)} title="Search"><Search style={{ width: 16, height: 16 }} /></button>
            <button className="chat-icon-btn" onClick={() => setShowStarred(p => !p)} title="Starred"><Star style={{ width: 16, height: 16 }} /></button>
            <button className="chat-icon-btn" onClick={() => setShowChatInfo(p => !p)} title="Info"><MoreVertical style={{ width: 16, height: 16 }} /></button>
          </div>
        </div>

        {/* Pinned message banner */}
        {pinnedMsg && !showStarred && (
          <div className="chat-pinned-banner" onClick={() => scrollToMsg(pinnedMsg.id)}>
            <Pin style={{ width: 12, height: 12, flexShrink: 0, color: 'var(--brand)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--brand)', fontWeight: 700, marginBottom: 1 }}>Pinned Message</div>
              <div style={{ fontSize: 11, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parseMsg(pinnedMsg.content).text}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); togglePin(activeRelId, pinnedMsg.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4 }}><X style={{ width: 12, height: 12 }} /></button>
          </div>
        )}

        {/* In-chat search */}
        {showMsgSearch && (
          <div className="chat-msg-search-bar">
            <Search style={{ width: 14, height: 14, opacity: 0.4, flexShrink: 0 }} />
            <input autoFocus value={msgSearch} onChange={e => setMsgSearch(e.target.value)} placeholder="Search messages…" className="chat-msg-search-input" />
            {msgSearch && <button onClick={() => setMsgSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}><X style={{ width: 12, height: 12 }} /></button>}
          </div>
        )}

        {/* Chat info panel */}
        {showChatInfo && (
          <div className="chat-info-panel">
            <div className="chat-info-section">
              <div className="chat-info-title">🔒 Privacy & Security</div>
              <div className="chat-info-row">
                <span>Secret Chat (E2E)</span>
                <button className={`chat-toggle ${isSecret ? 'on' : ''}`} onClick={() => toggleSecret(activeRelId)}>{isSecret ? '🔒 On' : '🔓 Off'}</button>
              </div>
              <div className="chat-info-row">
                <span>Disappearing Messages</span>
                <select value={disTimer} onChange={e => setDisappearTimer(activeRelId, e.target.value as any)} className="chat-select">
                  <option value="off">Off</option>
                  <option value="24h">24 Hours</option>
                  <option value="7d">7 Days</option>
                </select>
              </div>
            </div>
            <div className="chat-info-section">
              <div className="chat-info-title">🔔 Notifications</div>
              <div className="chat-info-row">
                <span>Mute Notifications</span>
                <button className={`chat-toggle ${isMuted ? 'on' : ''}`} onClick={() => toggleMute(activeRelId)}>{isMuted ? '🔇 Muted' : '🔔 On'}</button>
              </div>
            </div>
            <div className="chat-info-section">
              <div className="chat-info-title">⭐ Starred Messages ({(starredMsgs[activeRelId] || []).length})</div>
              <button className="chat-info-btn" onClick={() => { setShowStarred(true); setShowChatInfo(false); }}>View Starred Messages</button>
            </div>
          </div>
        )}

        {/* Starred messages panel */}
        {showStarred && (
          <div className="chat-starred-panel">
            <div className="chat-starred-header">
              <BookmarkCheck style={{ width: 14, height: 14, color: '#f59e0b' }} />
              <span>Starred Messages ({starredInActive.length})</span>
              <button onClick={() => setShowStarred(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X style={{ width: 14, height: 14 }} /></button>
            </div>
            {starredInActive.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>No starred messages</div>
            ) : (
              starredInActive.map(m => {
                const p = parseMsg(m.content);
                return (
                  <div key={m.id} className="chat-starred-item" onClick={() => { setShowStarred(false); setTimeout(() => scrollToMsg(m.id), 100); }}>
                    <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 2 }}>{fmtMsgTime(m.created_at)}</div>
                    <div style={{ fontSize: 12 }}>{p.text.slice(0, 100)}{p.text.length > 100 ? '…' : ''}</div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="chat-messenger-messages" onScroll={onScroll}>
          {activeMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon"><MessageCircle /></div>
              <p>No messages yet</p>
              <span>{isSecret ? '🔒 This is a secret chat. Messages are end-to-end encrypted.' : 'Send a message to start the conversation'}</span>
            </div>
          ) : grouped.map(group => (
            <div key={group.date}>
              <div className="chat-date-separator"><span>{fmtDateSep(group.messages[0].created_at)}</span></div>
              {group.messages.map((m, idx) => {
                const isOwn = m.sender_id === userId;
                const isPending = (m as OptMsg)._pending === true;
                const isFirst = group.messages[idx - 1]?.sender_id !== m.sender_id;
                const isLast = group.messages[idx + 1]?.sender_id !== m.sender_id;
                const parsed = parseMsg(m.content);
                const isStarred = (starredMsgs[activeRelId] || []).includes(m.id);
                const msgReactions = (reactions[activeRelId] || {})[m.id] || [];
                const isEditing = editingId === m.id;

                const reactionCounts: Record<string, number> = {};
                msgReactions.forEach(e => { reactionCounts[e] = (reactionCounts[e] || 0) + 1; });

                if (parsed.isScheduled) {
                  return (
                    <div key={m.id} ref={el => { msgRefs.current[m.id] = el; }} className={`chat-bubble-row ${isOwn ? 'own' : 'other'}`} style={{ marginTop: 6 }}>
                      <div className="chat-bubble own" style={{ background: 'rgba(100,116,139,0.3)', border: '1px dashed rgba(255,255,255,0.2)' }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4 }}>⏰ Scheduled{parsed.schedAt ? ` · ${new Date(parsed.schedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                        <div className="chat-bubble-content">{renderLinks(parsed.text)}</div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} ref={el => { msgRefs.current[m.id] = el; }} className={`chat-bubble-row ${isOwn ? 'own' : 'other'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}`} style={{ marginTop: isFirst ? 10 : 2, alignItems: 'flex-end', gap: 5, transition: 'background 0.4s' }} onContextMenu={e => openCtx(e, m, isOwn)}>
                    {!isOwn && <div style={{ width: 28, flexShrink: 0, alignSelf: 'flex-end' }}>{isLast ? <Avatar name={activeRel.counterparty_name} size={28} /> : null}</div>}
                    {!isPending && isOwn && <button className="chat-hover-action" title="Reply" onClick={() => setReplyTo({ id: m.id, sender: 'You', preview: parsed.isVoice ? '🎤 Voice note' : parsed.text })}><Reply style={{ width: 12, height: 12 }} /></button>}

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start', gap: 2 }}>
                      {/* Bubble */}
                      {isEditing ? (
                        <div className="chat-edit-mode">
                          <textarea ref={editInputRef} value={editText} onChange={e => setEditText(e.target.value)} className="chat-edit-input" rows={2} autoFocus onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); } if (e.key === 'Escape') { setEditingId(null); } }} />
                          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <button className="chat-edit-save" onClick={handleEdit}>Save</button>
                            <button className="chat-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className={`chat-bubble ${isOwn ? 'own' : 'other'} ${isStarred ? 'starred' : ''}`} style={!isOwn ? { background: otherPalette.bg, color: otherPalette.text } : undefined}>
                          {parsed.isFwd && (
                            <div className="chat-fwd-banner">
                              <Forward style={{ width: 10, height: 10 }} />
                              <span>Forwarded from {parsed.fwdSender}</span>
                            </div>
                          )}
                          {parsed.isReply && (
                            <div className="chat-reply-quote" style={{ borderLeftColor: isOwn ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }} onClick={() => parsed.replyId && scrollToMsg(parsed.replyId)}>
                              <div className="chat-reply-quote-sender">{parsed.replySender}</div>
                              <div className="chat-reply-quote-text">{parsed.replyPreview}</div>
                            </div>
                          )}
                          {parsed.isVoice ? (
                            <VoicePlayer base64={parsed.voiceBase64!} duration={parsed.voiceDuration!} isOwn={isOwn} />
                          ) : parsed.isPoll ? (
                            <PollBubble msgId={m.id} question={parsed.pollQuestion!} options={parsed.pollOptions!} isOwn={isOwn} />
                          ) : (
                            <div className="chat-bubble-content">
                               {!!m.expires_at && !isOwn && parsed.isViewed ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.5 }}>
                                     <Eye style={{ width: 12, height: 12 }} />
                                     <span style={{ fontStyle: 'italic', fontSize: 11 }}>Message viewed</span>
                                  </div>
                               ) : !!m.expires_at && !isOwn && !parsed.isViewed ? (
                                  <button
                                     style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'inherit', cursor: 'pointer' }}
                                     onClick={async () => {
                                        const viewed = `${m.content}||VIEWED||${new Date().toISOString()}||/VIEWED||`;
                                        await supabase.from('merchant_messages').update({ content: viewed }).eq('id', m.id);
                                        queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
                                     }}
                                  >
                                     <Shield style={{ width: 12, height: 12 }} />
                                     <span style={{ fontWeight: 700, fontSize: 11 }}>Reveal one-time message</span>
                                  </button>
                               ) : renderLinks(parsed.text)}
                            </div>
                          )}
                          <div className="chat-bubble-meta">
                            {isStarred && <Star style={{ width: 9, height: 9, color: '#f59e0b' }} />}
                            {parsed.isEdited && <span style={{ fontSize: 8, opacity: 0.55 }}>edited</span>}
                            <span>{fmtMsgTime(m.created_at)}</span>
                            {isOwn && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{isPending ? <TickPending /> : m.read_at ? <TickRead /> : <TickDelivered />}</span>}
                          </div>
                        </div>
                      )}

                      {/* Reactions */}
                      {Object.keys(reactionCounts).length > 0 && (
                        <div className="chat-reaction-bar">
                          {Object.entries(reactionCounts).map(([emoji, count]) => (
                            <button key={emoji} className="chat-reaction-chip" onClick={() => addReaction(activeRelId, m.id, emoji)}>
                              {emoji} {count > 1 && <span>{count}</span>}
                            </button>
                          ))}
                          <button className="chat-reaction-add" onClick={e => { e.stopPropagation(); setReactionTarget(m.id === reactionTarget ? null : m.id); }}>+</button>
                        </div>
                      )}

                      {/* Reaction picker popup */}
                      {reactionTarget === m.id && (
                        <div className="chat-reaction-popup" onClick={e => e.stopPropagation()}>
                          {REACTION_EMOJIS.map(e => (
                            <button key={e} className="chat-reaction-popup-btn" onClick={() => addReaction(activeRelId, m.id, e)}>{e}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isPending && !isOwn && <button className="chat-hover-action" title="Reply" onClick={() => setReplyTo({ id: m.id, sender: activeRel.counterparty_name, preview: parsed.isVoice ? '🎤 Voice note' : parsed.text })}><Reply style={{ width: 12, height: 12 }} /></button>}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Typing */}
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

        {/* Poll creator */}
        {showPollCreate && (
          <div className="chat-poll-creator">
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>📊 Create Poll</span>
              <button onClick={() => setShowPollCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}><X style={{ width: 14, height: 14 }} /></button>
            </div>
            <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Question…" className="chat-poll-input" />
            {pollOpts.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input value={opt} onChange={e => { const n = [...pollOpts]; n[i] = e.target.value; setPollOpts(n); }} placeholder={`Option ${i + 1}`} className="chat-poll-input" style={{ flex: 1 }} />
                {pollOpts.length > 2 && <button onClick={() => setPollOpts(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4 }}><X style={{ width: 12, height: 12 }} /></button>}
              </div>
            ))}
            {pollOpts.length < 6 && <button onClick={() => setPollOpts(p => [...p, ''])} style={{ marginTop: 6, fontSize: 11, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add option</button>}
            <button onClick={handleSendPoll} className="chat-poll-send-btn">Send Poll</button>
          </div>
        )}

        {/* Schedule panel */}
        {showSchedule && (
          <div className="chat-schedule-panel">
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>⏰ Schedule Message</span>
              <button onClick={() => setShowSchedule(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}><X style={{ width: 14, height: 14 }} /></button>
            </div>
            <input type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="chat-poll-input" />
            <button onClick={handleScheduleSend} disabled={!scheduleTime || !text.trim()} className="chat-poll-send-btn" style={{ marginTop: 8 }}>Schedule Send</button>
          </div>
        )}

        {/* Input bar — always visible */}
        <div className="chat-messenger-input">
          <button className="chat-emoji-toggle" onClick={() => setShowEmoji(p => !p)} type="button" title="Emoji"><Smile style={{ width: 20, height: 20 }} /></button>
          <div className="chat-input-wrap">
            <textarea ref={inputRef} value={text} onChange={onTextChange} onKeyDown={onKey} onPaste={handlePaste} placeholder={isRecording ? `🔴 Recording… ${recordingTime}s` : 'Type a message…'} rows={1} className="chat-input-field" disabled={isRecording} />
          </div>
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
            <button className="chat-icon-btn" onClick={() => setShowPollCreate(p => !p)} title="Create Poll"><CheckSquare style={{ width: 16, height: 16 }} /></button>
            <button className="chat-icon-btn" onClick={() => setShowSchedule(p => !p)} title="Schedule"><Clock style={{ width: 16, height: 16 }} /></button>
            {isRecording ? (
              <button className="chat-send-btn" style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }} onClick={stopRecording}><StopCircle className="h-5 w-5" /></button>
            ) : text.trim() ? (
              <button onClick={() => handleSend()} disabled={sendMessage.isPending} className="chat-send-btn" type="button"><Send className="h-5 w-5" /></button>
            ) : (
              <button className="chat-send-btn" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={startRecording} title="Voice note"><Mic className="h-5 w-5" /></button>
            )}
          </div>
        </div>

        {/* Context menu */}
        {ctx && (
          <div className="chat-context-menu" style={{ top: ctx.y, left: Math.min(ctx.x, window.innerWidth - 180) }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { navigator.clipboard?.writeText(ctx.text); setCtx(null); }}><Copy style={{ width: 13, height: 13 }} /> Copy</button>
            <button onClick={() => { const msg = activeMessages.find(m => m.id === ctx.msgId); if (msg) setReplyTo({ id: msg.id, sender: ctx.isOwn ? 'You' : activeRel.counterparty_name, preview: parseMsg(msg.content).text }); setCtx(null); }}><Reply style={{ width: 13, height: 13 }} /> Reply</button>
            <button onClick={() => { const msg = activeMessages.find(m => m.id === ctx.msgId); if (msg) setForwardMsg(msg as Message); setCtx(null); }}><Forward style={{ width: 13, height: 13 }} /> Forward</button>
            <button onClick={() => { togglePin(activeRelId, ctx.msgId); setCtx(null); }}><Pin style={{ width: 13, height: 13 }} /> {pinnedMsgs[activeRelId] === ctx.msgId ? 'Unpin' : 'Pin'}</button>
            <button onClick={() => { toggleStar(activeRelId, ctx.msgId); setCtx(null); }}><Star style={{ width: 13, height: 13 }} /> {(starredMsgs[activeRelId] || []).includes(ctx.msgId) ? 'Unstar' : 'Star'}</button>
            <button onClick={() => { setReactionTarget(ctx.msgId); setCtx(null); }}><Smile style={{ width: 13, height: 13 }} /> React</button>
            {ctx.isOwn && <button onClick={() => { const msg = activeMessages.find(m => m.id === ctx.msgId); if (msg) { setEditingId(ctx.msgId); setEditText(parseMsg(msg.content).text); } setCtx(null); }}><Edit3 style={{ width: 13, height: 13 }} /> Edit</button>}
            {ctx.isOwn && <button style={{ color: '#ef4444' }} onClick={async () => { await supabase.from('merchant_messages').delete().eq('id', ctx.msgId); queryClient.invalidateQueries({ queryKey: ['unified-chat'] }); setCtx(null); }}><Trash2 style={{ width: 13, height: 13 }} /> Delete</button>}
          </div>
        )}

        {/* Forward modal */}
        {forwardMsg && (
          <div className="chat-modal-overlay" onClick={() => setForwardMsg(null)}>
            <div className="chat-modal" onClick={e => e.stopPropagation()}>
              <div className="chat-modal-header">
                <Forward style={{ width: 16, height: 16 }} /> Forward Message
                <button onClick={() => setForwardMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X style={{ width: 14, height: 14 }} /></button>
              </div>
              <div style={{ padding: 12, fontSize: 11, opacity: 0.6, borderBottom: '1px solid rgba(255,255,255,0.06)', fontStyle: 'italic' }}>"{parseMsg(forwardMsg.content).text.slice(0, 80)}…"</div>
              <div style={{ padding: '8px 0' }}>
                {relationships.filter(r => r.id !== activeRelId).map(r => (
                  <button key={r.id} className="chat-forward-item" onClick={() => handleForward(r.id)}>
                    <Avatar name={r.counterparty_name} size={32} />
                    <span style={{ fontSize: 13 }}>{r.counterparty_name}</span>
                  </button>
                ))}
                {relationships.filter(r => r.id !== activeRelId).length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>No other contacts</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INBOX LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className={`chat-inbox-view ${fullPage ? 'full-page' : ''}`}>
      <div className="chat-inbox-header">
        <h2 style={{ fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          💬 {t('allConversations') || 'Messages'}
          {totalUnread > 0 && <span className="chat-unread-total">{totalUnread}</span>}
        </h2>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="chat-icon-btn" onClick={() => setShowBroadcast(true)} title="Broadcast"><Megaphone style={{ width: 16, height: 16 }} /></button>
          <button className="chat-icon-btn" title="Filter"><Filter style={{ width: 16, height: 16 }} /></button>
        </div>
      </div>

      {/* Folder tabs */}
      <div className="chat-folder-tabs">
        {(['all', 'unread', 'muted'] as const).map(f => (
          <button key={f} className={`chat-folder-tab ${inboxFolder === f ? 'active' : ''}`} onClick={() => setInboxFolder(f)}>
            {f === 'all' ? 'All' : f === 'unread' ? `Unread${conversations.filter(c => c.unread_count > 0).length ? ` (${conversations.filter(c => c.unread_count > 0).length})` : ''}` : 'Muted'}
          </button>
        ))}
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
            <p>{inboxFolder === 'unread' ? 'No unread messages' : inboxFolder === 'muted' ? 'No muted chats' : 'No conversations yet'}</p>
            <span>Open a merchant relationship to start chatting</span>
          </div>
        ) : filteredConvs.map(c => {
          const hasUnread = c.unread_count > 0 && !mutedRels.includes(c.relationship_id);
          const lastText = c.last_message ? parseMsg(c.last_message).text : '';
          const isSecretConv = secretChats.includes(c.relationship_id);
          const isMutedConv = mutedRels.includes(c.relationship_id);
          return (
            <button key={c.relationship_id} onClick={() => openConv(c.relationship_id)} className={`chat-conversation-item ${hasUnread ? 'unread' : ''}`}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Avatar name={c.counterparty_name} size={50} />
                {isSecretConv && <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 10 }}>🔒</span>}
              </div>
              <div className="chat-conversation-info">
                <div className="chat-conversation-top">
                  <span className="chat-conversation-name">{c.counterparty_name}</span>
                  <span className={`chat-conversation-time ${hasUnread ? 'unread' : ''}`}>{c.last_message_at ? fmtListTime(c.last_message_at) : ''}</span>
                </div>
                <div className="chat-conversation-bottom">
                  <span className="chat-conversation-preview">
                    {isMutedConv && <VolumeX style={{ width: 10, height: 10, display: 'inline', marginRight: 3, opacity: 0.4 }} />}
                    {c.last_sender_id === userId && <span className="chat-you-prefix">You: </span>}
                    {lastText || <span style={{ fontStyle: 'italic', opacity: 0.4 }}>No messages</span>}
                  </span>
                  {hasUnread && <span className="chat-unread-badge">{c.unread_count}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Broadcast modal */}
      {showBroadcast && (
        <div className="chat-modal-overlay" onClick={() => setShowBroadcast(false)}>
          <div className="chat-modal" onClick={e => e.stopPropagation()}>
            <div className="chat-modal-header">
              <Megaphone style={{ width: 16, height: 16 }} /> Broadcast Message
              <button onClick={() => setShowBroadcast(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X style={{ width: 14, height: 14 }} /></button>
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>Send to all {relationships.length} contacts</div>
              <textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)} placeholder="Type broadcast message…" className="chat-broadcast-input" rows={3} />
              <button onClick={handleBroadcast} disabled={!broadcastText.trim()} className="chat-poll-send-btn" style={{ marginTop: 8 }}>
                <Send style={{ width: 13, height: 13 }} /> Send to All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
