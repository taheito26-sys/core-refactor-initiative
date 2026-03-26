/* ═══════════════════════════════════════════════════════════════
   MessageItem — Rocket.Chat-style message bubble
   Full features: reply, forward, pin, star, edit, delete,
   reactions, context menu, voice, polls, scheduled messages
   ═══════════════════════════════════════════════════════════════ */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Check, CheckCheck, Reply, Copy, Forward, Pin, Star, Edit3, Trash2, Smile, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@/lib/chat-store';
import { parseMsg, splitLinks, fmtMsgTime, getPalette, encodeEdited, encodeForward } from '../lib/message-codec';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🙏'];

function lsGet<T>(key: string, def: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return def; } }
function lsSet(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)); }

interface Props {
  message: ChatMessage;
  isOwn: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  currentUserId: string;
  counterpartyName: string;
  isHighlighted: boolean;
  onReply: (msg: ChatMessage) => void;
  onScrollToMessage?: (id: string) => void;
  onForward?: (msg: ChatMessage) => void;
  relationshipId?: string;
}

export function MessageItem({
  message, isOwn, isFirstInGroup, isLastInGroup,
  currentUserId, counterpartyName, isHighlighted,
  onReply, onScrollToMessage, onForward, relationshipId,
}: Props) {
  const queryClient = useQueryClient();
  const [showCtx, setShowCtx] = useState(false);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(() => parseMsg(message.content), [message.content]);
  const palette = getPalette(counterpartyName);

  const isPending = !!message._pending;
  const isRead = !!message.read_at;
  const senderName = isOwn ? 'You' : counterpartyName;

  // Persisted star/pin/reactions
  const relId = relationshipId || '';
  const [starred, setStarred] = useState<string[]>(() => lsGet(`cstar_${relId}`, []));
  const [reactions, setReactions] = useState<Record<string, string[]>>(() => lsGet(`creact_${relId}`, {}));
  const isStarred = starred.includes(message.id);
  const msgReactions = reactions[message.id] || [];
  const reactionCounts: Record<string, number> = {};
  msgReactions.forEach((e) => { reactionCounts[e] = (reactionCounts[e] || 0) + 1; });

  const toggleStar = () => {
    const next = isStarred ? starred.filter((s) => s !== message.id) : [...starred, message.id];
    setStarred(next);
    lsSet(`cstar_${relId}`, next);
  };

  const addReaction = (emoji: string) => {
    const cur = reactions[message.id] || [];
    const next = cur.includes(emoji) ? cur.filter((e) => e !== emoji) : [...cur, emoji];
    const all = { ...reactions, [message.id]: next };
    setReactions(all);
    lsSet(`creact_${relId}`, all);
    setShowReactionPicker(false);
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;
    const edited = encodeEdited(editText.trim(), new Date().toISOString());
    await supabase.from('merchant_messages').update({ content: edited, edited_at: new Date().toISOString() }).eq('id', message.id);
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setIsEditing(false);
    setEditText('');
  };

  const handleDelete = async () => {
    await supabase.from('merchant_messages').delete().eq('id', message.id);
    queryClient.invalidateQueries({ queryKey: ['unified-chat'] });
    setShowCtx(false);
  };

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxPos({ x: e.clientX, y: e.clientY });
    setShowCtx(true);
  };

  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus();
  }, [isEditing]);

  // ── Voice player ─────────────────────────────────────────────
  const VoicePlayer = () => {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const srcUrl = useMemo(() => {
      if (!parsed.voiceBase64) return '';
      try {
        const bin = atob(parsed.voiceBase64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([arr], { type: 'audio/webm' }));
      } catch { return ''; }
    }, []);

    useEffect(() => () => { if (srcUrl) URL.revokeObjectURL(srcUrl); }, [srcUrl]);

    const toggle = () => {
      if (!audioRef.current) {
        const a = new Audio(srcUrl);
        audioRef.current = a;
        a.ontimeupdate = () => setProgress((a.currentTime / a.duration) * 100 || 0);
        a.onended = () => { setPlaying(false); setProgress(0); };
      }
      if (playing) audioRef.current.pause();
      else audioRef.current.play();
      setPlaying(!playing);
    };

    return (
      <div className="flex items-center gap-2 min-w-[180px]">
        <button onClick={toggle} className="w-8 h-8 rounded-full border-none cursor-pointer bg-primary/20 text-primary flex items-center justify-center text-sm">
          {playing ? '⏸' : '▶'}
        </button>
        <div className="flex-1">
          <div className="h-1 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded transition-[width] duration-100" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            {parsed.voiceDuration ? `${Math.floor(parsed.voiceDuration / 60)}:${String(parsed.voiceDuration % 60).padStart(2, '0')}` : '0:00'}
          </div>
        </div>
      </div>
    );
  };

  // ── Poll ──────────────────────────────────────────────────────
  const PollBubble = () => {
    const [votes, setVotes] = useState<Record<string, string[]>>(() => {
      try { return JSON.parse(localStorage.getItem(`poll_${message.id}`) || '{}'); } catch { return {}; }
    });
    const hasVoted = Object.values(votes).some((arr) => arr.includes(currentUserId));
    const totalVotes = Object.values(votes).reduce((s, a) => s + a.length, 0);
    const vote = (opt: string) => {
      if (hasVoted) return;
      const next = { ...votes, [opt]: [...(votes[opt] || []), currentUserId] };
      setVotes(next);
      localStorage.setItem(`poll_${message.id}`, JSON.stringify(next));
    };
    return (
      <div>
        <div className="text-xs font-bold mb-1.5">📊 {parsed.pollQuestion}</div>
        {(parsed.pollOptions || []).map((opt) => {
          const count = (votes[opt] || []).length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          return (
            <div key={opt} onClick={() => vote(opt)} className="px-2 py-1 mb-0.5 rounded border border-border bg-primary/5 relative overflow-hidden text-[11px] cursor-pointer">
              {hasVoted && <div className="absolute left-0 top-0 bottom-0 bg-primary/15 transition-[width] duration-300" style={{ width: `${pct}%` }} />}
              <span className="relative z-10">{opt}</span>
              {hasVoted && <span className="relative z-10 float-right font-bold">{pct}%</span>}
            </div>
          );
        })}
        {hasVoted && <div className="text-[9px] text-muted-foreground mt-1">{totalVotes} votes</div>}
      </div>
    );
  };

  // ── Text with links ──────────────────────────────────────────
  const TextContent = ({ text }: { text: string }) => (
    <>
      {splitLinks(text).map((part, i) =>
        part.type === 'link' ? (
          <a key={i} href={part.value} target="_blank" rel="noopener noreferrer" className="text-primary underline opacity-85" onClick={(e) => e.stopPropagation()}>
            {part.value}
          </a>
        ) : (<span key={i}>{part.value}</span>)
      )}
    </>
  );

  // ── Scheduled message ────────────────────────────────────────
  if (parsed.isScheduled) {
    return (
      <div data-msg-id={message.id} className={`relative px-4 pt-2 ${isHighlighted ? 'msg-highlight' : ''}`}>
        <div className="rounded-md px-3 py-2 max-w-[75%] ml-auto bg-muted/30 border border-dashed border-border">
          <div className="text-[9px] text-muted-foreground mb-1">
            ⏰ Scheduled{parsed.schedAt ? ` · ${new Date(parsed.schedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
          <div className="text-[12px] leading-relaxed text-foreground break-words">
            <TextContent text={parsed.text} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-msg-id={message.id}
      className={`relative px-4 ${isFirstInGroup ? 'pt-2' : 'pt-0.5'} ${isHighlighted ? 'msg-highlight' : ''} group/msg`}
      onContextMenu={openContextMenu}
    >
      {/* Bubble */}
      {isEditing ? (
        <div className="max-w-[75%] ml-auto">
          <textarea
            ref={editRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); } if (e.key === 'Escape') setIsEditing(false); }}
            className="w-full bg-accent/30 border border-primary/30 rounded text-[12px] p-2 text-foreground outline-none resize-none"
            rows={2}
          />
          <div className="flex gap-2 mt-1">
            <button onClick={handleEdit} className="text-[10px] font-bold text-primary hover:underline">Save</button>
            <button onClick={() => setIsEditing(false)} className="text-[10px] text-muted-foreground hover:underline">Cancel</button>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-md px-3 py-2 max-w-[75%] ${
            isOwn
              ? 'bg-amber-400/20 border border-amber-400/30 ml-auto'
              : 'bg-card border border-border'
          } ${isStarred ? 'ring-1 ring-amber-400/40' : ''}`}
        >
          {/* Sender name */}
          {isFirstInGroup && (
            <div className="text-[11px] font-extrabold mb-0.5">
              <span className={isOwn ? 'text-primary' : 'text-sky-400'}>{senderName}</span>
              {isStarred && <Star size={9} className="inline ml-1 text-amber-400" />}
            </div>
          )}

          {/* Forward banner */}
          {parsed.isFwd && (
            <div className="text-[9px] text-muted-foreground mb-1 italic flex items-center gap-1">
              <Forward size={9} /> Forwarded from {parsed.fwdSender}
            </div>
          )}

          {/* Reply quote */}
          {parsed.isReply && parsed.replyPreview && (
            <div onClick={() => parsed.replyId && onScrollToMessage?.(parsed.replyId)} className="border-l-2 border-primary pl-2 mb-1 cursor-pointer">
              <div className="text-[9px] font-bold text-primary">{parsed.replySender}</div>
              <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{parsed.replyPreview}</div>
            </div>
          )}

          {/* Content */}
          {parsed.isVoice ? <VoicePlayer /> :
           parsed.isPoll ? <PollBubble /> :
           parsed.isSystemEvent ? (
            <div className="text-[11px] text-muted-foreground italic text-center">ℹ️ {parsed.systemEventFields?.join(' · ') || 'System event'}</div>
          ) : (
            <div className="text-[12px] leading-relaxed text-foreground break-words"><TextContent text={parsed.text} /></div>
          )}

          {/* Meta */}
          <div className="flex items-center justify-end gap-1 mt-1">
            {parsed.isEdited && <span className="text-[8px] text-muted-foreground italic">edited</span>}
            <span className="text-[9px] text-muted-foreground">{fmtMsgTime(message.created_at)}</span>
            {isOwn && (isPending ? <span className="text-[9px] text-muted-foreground">○</span> : isRead ? <CheckCheck size={12} className="text-primary" /> : <Check size={12} className="text-muted-foreground" />)}
          </div>
        </div>
      )}

      {/* Reactions display */}
      {Object.keys(reactionCounts).length > 0 && (
        <div className={`flex gap-1 mt-0.5 flex-wrap ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {Object.entries(reactionCounts).map(([emoji, count]) => (
            <button key={emoji} onClick={() => addReaction(emoji)} className="text-[11px] bg-accent/40 border border-border rounded-full px-1.5 py-0.5 hover:bg-accent/60 transition-colors cursor-pointer">
              {emoji} {count > 1 && <span className="text-[9px] font-bold">{count}</span>}
            </button>
          ))}
          <button onClick={() => setShowReactionPicker(true)} className="text-[11px] bg-accent/20 border border-border rounded-full px-1.5 py-0.5 hover:bg-accent/40 transition-colors cursor-pointer text-muted-foreground">+</button>
        </div>
      )}

      {/* Reaction picker popup */}
      {showReactionPicker && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setShowReactionPicker(false)} />
          <div className={`absolute z-[999] bg-popover border border-border rounded-lg p-2 shadow-lg flex gap-1 ${isOwn ? 'right-4' : 'left-4'}`} style={{ top: -8 }}>
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => addReaction(e)} className="text-base hover:scale-125 transition-transform cursor-pointer bg-transparent border-none p-0.5">{e}</button>
            ))}
          </div>
        </>
      )}

      {/* Hover quick-reply button */}
      {!isPending && !isEditing && (
        <button
          onClick={() => onReply(message)}
          className={`absolute top-1 opacity-0 group-hover/msg:opacity-100 transition-opacity bg-card border border-border rounded p-1 shadow-sm cursor-pointer text-muted-foreground hover:text-foreground ${
            isOwn ? 'left-2' : 'right-2'
          }`}
          title="Reply"
        >
          <Reply size={11} />
        </button>
      )}

      {/* Context menu */}
      {showCtx && (
        <>
          <div className="fixed inset-0 z-[999]" onClick={() => setShowCtx(false)} />
          <div
            className="fixed z-[1000] bg-popover border border-border rounded-lg p-1 shadow-lg flex flex-col min-w-[140px]"
            style={{ top: Math.min(ctxPos.y, window.innerHeight - 250), left: Math.min(ctxPos.x, window.innerWidth - 160) }}
          >
            <CtxBtn icon={<Reply size={12} />} label="Reply" onClick={() => { setShowCtx(false); onReply(message); }} />
            <CtxBtn icon={<Copy size={12} />} label="Copy" onClick={() => { navigator.clipboard.writeText(parsed.text); setShowCtx(false); }} />
            {onForward && <CtxBtn icon={<Forward size={12} />} label="Forward" onClick={() => { setShowCtx(false); onForward(message); }} />}
            <CtxBtn icon={<Pin size={12} />} label="Pin" onClick={() => { setShowCtx(false); /* pin handled at page level */ }} />
            <CtxBtn icon={<Star size={12} />} label={isStarred ? 'Unstar' : 'Star'} onClick={() => { toggleStar(); setShowCtx(false); }} />
            <CtxBtn icon={<Smile size={12} />} label="React" onClick={() => { setShowCtx(false); setShowReactionPicker(true); }} />
            {isOwn && (
              <CtxBtn icon={<Edit3 size={12} />} label="Edit" onClick={() => { setIsEditing(true); setEditText(parsed.text); setShowCtx(false); }} />
            )}
            {isOwn && (
              <CtxBtn icon={<Trash2 size={12} />} label="Delete" className="text-destructive" onClick={handleDelete} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CtxBtn({ icon, label, onClick, className }: { icon: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-2.5 py-1.5 border-none bg-transparent cursor-pointer text-[11px] rounded w-full text-left hover:bg-accent/30 transition-colors ${className || 'text-foreground'}`}>
      {icon} {label}
    </button>
  );
}
