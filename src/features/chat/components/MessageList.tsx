// ─── MessageList — WhatsApp-identical design ──────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { formatDistanceToNow, format, isToday, isYesterday, differenceInSeconds } from 'date-fns';
import { MoreHorizontal, Reply, Edit2, Trash2, Eye, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/lib/chat-store';
import type { ChatMessage, ChatRoomType, ReactionSummary } from '../types';
import { SecureWatermark } from './SecureWatermark';
import { AttachmentPreview } from './AttachmentPreview';
import { getAttachment, getSignedUrl } from '../api/chat';

interface Props {
  messages:  ChatMessage[];
  meId:      string;
  isLoading: boolean;
  roomType:  ChatRoomType;
  onReact:   (msgId: string, emoji: string, remove?: boolean) => void;
  onEdit:    (msgId: string, content: string) => void;
  onDelete:  (msgId: string, forEveryone?: boolean) => void;
}

const EMOJI_QUICK = ['👍','❤️','😂','😮','😢','🙏'];

function groupByDay(messages: ChatMessage[]) {
  const groups: { label: string; messages: ChatMessage[] }[] = [];
  let current: { label: string; messages: ChatMessage[] } | null = null;
  for (const m of messages) {
    const d = new Date(m.created_at);
    const label = isToday(d) ? 'TODAY' : isYesterday(d) ? 'YESTERDAY' : format(d, 'dd/MM/yyyy');
    if (!current || current.label !== label) {
      current = { label, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
}

// ── WhatsApp-style tick marks ──────────────────────────────────────────────
function ReceiptTicks({ status, isOptimistic }: { status?: string; isOptimistic?: boolean }) {
  if (isOptimistic) {
    // Pending: single grey clock
    return <Clock className="h-3 w-3 text-muted-foreground/40 ml-1 shrink-0" />;
  }
  if (status === 'read') {
    // Blue double ticks
    return <CheckCheck className="h-3.5 w-3.5 text-blue-500 ml-1 shrink-0" />;
  }
  if (status === 'delivered') {
    // Grey double ticks
    return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground/50 ml-1 shrink-0" />;
  }
  // Sent: single grey tick
  return <Check className="h-3.5 w-3.5 text-muted-foreground/50 ml-1 shrink-0" />;
}

export function MessageList({ messages, meId, isLoading, roomType, onReact, onEdit, onDelete }: Props) {
  const bottomRef        = useRef<HTMLDivElement>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const highlightId      = useChatStore((s) => s.highlightMessageId);
  const clearHighlight   = useChatStore((s) => s.clearHighlight);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const watermarkEnabled = roomType === 'merchant_private' || roomType === 'merchant_client';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(clearHighlight, 3000);
    return () => clearTimeout(t);
  }, [highlightId, clearHighlight]);

  const startEdit = useCallback((m: ChatMessage) => {
    setEditingId(m.id);
    setEditContent(m.content);
  }, []);

  const submitEdit = useCallback(() => {
    if (editingId && editContent.trim()) {
      onEdit(editingId, editContent.trim());
    }
    setEditingId(null);
    setEditContent('');
  }, [editingId, editContent, onEdit]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  const filtered = messages.filter((m) => {
    if (m.deleted_for_sender && m.sender_id === meId) return false;
    if (m.expires_at && new Date(m.expires_at) < new Date()) return false;
    return true;
  });
  const groups = groupByDay(filtered);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 relative"
      style={{
        backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'0.5\' fill=\'%23888\' opacity=\'0.08\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'url(%23p)\'/%3E%3C/svg%3E")',
      }}
    >
      {watermarkEnabled && <SecureWatermark enabled={watermarkEnabled} />}

      {groups.map((group) => (
        <div key={group.label} className="mb-4">
          {/* Day chip — WhatsApp style */}
          <div className="flex justify-center mb-3">
            <span className="px-3 py-1 rounded-lg bg-muted/80 text-[11px] font-medium text-muted-foreground shadow-sm">
              {group.label}
            </span>
          </div>

          <div className="space-y-0.5">
            {group.messages.map((m, idx) => {
              const isMe = m.sender_id === meId;
              const isHighlighted = m.id === highlightId;
              const isDeleted = m.is_deleted;
              const isOptimistic = (m as { _optimistic?: boolean })._optimistic;
              const isFailed = (m as { _failed?: boolean })._failed;
              // Consecutive same-sender grouping
              const prevMsg = idx > 0 ? group.messages[idx - 1] : null;
              const isSameSender = prevMsg?.sender_id === m.sender_id;
              const showTail = !isSameSender;

              if (m.type === 'system' || m.type === 'call_summary') {
                return (
                  <div key={m.id} className="flex justify-center py-1">
                    <span className="px-3 py-1 rounded-lg bg-muted/60 text-[11px] text-muted-foreground italic">
                      {m.content}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={cn(
                    'flex group',
                    isMe ? 'justify-end' : 'justify-start',
                    !isSameSender ? 'mt-2' : 'mt-0.5',
                  )}
                  onMouseEnter={() => setHovered(m.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className={cn(
                      'relative max-w-[85%] sm:max-w-[65%]',
                      isHighlighted && 'animate-pulse',
                    )}
                  >
                    {/* Bubble */}
                    <div
                      className={cn(
                        'relative px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-sm',
                        isMe
                          ? 'bg-[hsl(var(--wa-out-bubble,120,25%,95%))] dark:bg-[hsl(var(--wa-out-bubble-dark,163,55%,15%))] text-foreground'
                          : 'bg-card text-foreground',
                        // Rounded corners with WhatsApp-style tail
                        showTail
                          ? isMe
                            ? 'rounded-tl-lg rounded-bl-lg rounded-br-lg rounded-tr-[4px]'
                            : 'rounded-tr-lg rounded-br-lg rounded-bl-lg rounded-tl-[4px]'
                          : 'rounded-lg',
                        isDeleted && 'opacity-50 italic',
                        isFailed && 'opacity-60 ring-1 ring-destructive/30',
                        isHighlighted && 'ring-2 ring-primary/40',
                      )}
                    >
                      {/* Sender name for group chats */}
                      {!isMe && showTail && (
                        <p className="text-[12.5px] font-semibold text-primary mb-0.5 leading-tight">
                          {m.sender_name ?? m.sender_id.slice(0, 8)}
                        </p>
                      )}

                      {/* Reply preview */}
                      {m.metadata?.reply_preview && (
                        <div className={cn(
                          'flex items-start gap-2 px-2.5 py-1.5 rounded-md mb-1 border-l-[3px] text-xs',
                          isMe
                            ? 'bg-background/30 border-primary/50'
                            : 'bg-muted/50 border-muted-foreground/40',
                        )}>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-primary leading-tight">
                              {m.metadata.reply_preview.sender_name}
                            </p>
                            <p className="text-muted-foreground/70 truncate text-[12px]">
                              {m.metadata.reply_preview.content}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Message content */}
                      {isDeleted ? (
                        <span className="text-[13px] text-muted-foreground italic flex items-center gap-1">
                          <span className="opacity-60">🚫</span> This message was deleted
                        </span>
                      ) : editingId === m.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                              if (e.key === 'Escape') { setEditingId(null); }
                            }}
                            className="bg-transparent border-b border-primary/50 focus:outline-none text-sm w-full min-w-[120px]"
                            autoFocus
                          />
                          <div className="flex gap-2 text-[11px]">
                            <button onClick={submitEdit} className="text-primary font-medium">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-muted-foreground">Cancel</button>
                          </div>
                        </div>
                      ) : m.type === 'voice_note' ? (
                        <VoiceNotePlayer message={m} isMe={isMe} />
                      ) : (m.type === 'image' || m.type === 'file') ? (
                        <AttachmentPreview message={m} isMe={isMe} />
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{m.content}</span>
                      )}

                      {/* Bottom row: edited + view-once + disappearing + time + ticks */}
                      <div className={cn(
                        'flex items-center gap-1 mt-0.5 float-right ml-3 -mb-0.5',
                        isDeleted && 'hidden',
                      )}>
                        {m.is_edited && (
                          <span className="text-[10px] text-muted-foreground/50 italic">edited</span>
                        )}
                        {m.view_once && (
                          <Eye className="h-3 w-3 text-muted-foreground/50" />
                        )}
                        {m.expires_at && (
                          <DisappearingBadge expiresAt={m.expires_at} />
                        )}
                        <span className="text-[10.5px] text-muted-foreground/50 leading-none">
                          {format(new Date(m.created_at), 'HH:mm')}
                        </span>
                        {isMe && <ReceiptTicks status={m.receipt_status} isOptimistic={isOptimistic} />}
                        {isFailed && <span className="text-[10px] text-destructive font-medium">!</span>}
                      </div>

                      {/* Clear float */}
                      <div className="clear-both" />
                    </div>

                    {/* Reactions */}
                    {m.reactions && m.reactions.length > 0 && (
                      <ReactionBar
                        reactions={m.reactions.reduce((acc, r) => {
                          const ex = acc.find((x) => x.emoji === r.emoji);
                          if (ex) { ex.count++; if (r.user_id === meId) ex.reacted_by_me = true; ex.user_ids.push(r.user_id); }
                          else acc.push({ emoji: r.emoji, count: 1, reacted_by_me: r.user_id === meId, user_ids: [r.user_id] });
                          return acc;
                        }, [] as ReactionSummary[])}
                        onReact={(emoji) => {
                          const myReaction = m.reactions?.find((r) => r.user_id === meId && r.emoji === emoji);
                          onReact(m.id, emoji, !!myReaction);
                        }}
                        isMe={isMe}
                      />
                    )}
                  </div>

                  {/* Hover action toolbar */}
                  {hovered === m.id && !isDeleted && (
                    <MessageActions
                      message={m}
                      isMe={isMe}
                      onReact={(emoji) => onReact(m.id, emoji)}
                      onEdit={() => startEdit(m)}
                      onDelete={(fe) => onDelete(m.id, fe)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ── VoiceNotePlayer — WhatsApp style ───────────────────────────────────────
function VoiceNotePlayer({ message, isMe }: { message: ChatMessage; isMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationMs = message.metadata?.duration_ms as number | undefined;

  useEffect(() => {
    let cancelled = false;
    const fetchUrl = async () => {
      setLoadingAudio(true);
      try {
        if (message.attachment?.storage_path) {
          const url = await getSignedUrl(message.attachment.storage_path);
          if (!cancelled) setAudioUrl(url);
        } else {
          const att = await getAttachment(message.id);
          if (!cancelled && att?.signed_url) setAudioUrl(att.signed_url);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoadingAudio(false);
    };
    fetchUrl();
    return () => { cancelled = true; };
  }, [message.id, message.attachment?.storage_path]);

  const toggle = useCallback(async () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { await audioRef.current.play(); setPlaying(true); }
  }, [playing]);

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const pct = audioRef.current.duration
      ? (audioRef.current.currentTime / audioRef.current.duration) * 100
      : 0;
    setProgress(pct);
  }, []);

  const totalSec = durationMs ? Math.round(durationMs / 1000) : 0;
  const currentSec = audioRef.current?.currentTime
    ? Math.round(audioRef.current.currentTime)
    : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] py-1">
      {/* Play button */}
      <button
        onClick={toggle}
        disabled={loadingAudio || !audioUrl}
        className={cn(
          'h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-colors',
          isMe ? 'bg-primary/20 text-primary' : 'bg-primary/15 text-primary',
          (loadingAudio || !audioUrl) && 'opacity-40',
        )}
      >
        {loadingAudio
          ? <span className="h-3.5 w-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          : <span className="text-sm ml-0.5">{playing ? '⏸' : '▶'}</span>}
      </button>

      <div className="flex-1 flex flex-col gap-0.5">
        {/* Progress bar */}
        <div className="h-1 rounded-full bg-muted-foreground/15 relative overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/60 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Duration */}
        <div className="flex justify-between">
          <span className="text-[10px] text-muted-foreground/50">
            {playing ? `${Math.floor(currentSec / 60)}:${(currentSec % 60).toString().padStart(2, '0')}` : `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`}
          </span>
        </div>
      </div>

      {/* Mic icon */}
      <div className={cn(
        'h-6 w-6 rounded-full flex items-center justify-center text-[10px] shrink-0',
        isMe ? 'bg-primary/15' : 'bg-muted',
      )}>
        🎙
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => { setPlaying(false); setProgress(0); }}
        />
      )}
    </div>
  );
}

// ── Disappearing badge ─────────────────────────────────────────────────────
function DisappearingBadge({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, differenceInSeconds(new Date(expiresAt), new Date())),
  );

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const secs = Math.max(0, differenceInSeconds(new Date(expiresAt), new Date()));
      setRemaining(secs);
      if (secs <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, remaining]);

  if (remaining <= 0) return null;

  const fmt = (s: number) => {
    if (s >= 86400) return `${Math.floor(s / 86400)}d`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h`;
    if (s >= 60) return `${Math.floor(s / 60)}m`;
    return `${s}s`;
  };

  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500">
      <Clock className="h-2.5 w-2.5" />
      {fmt(remaining)}
    </span>
  );
}

// ── Reaction bar ───────────────────────────────────────────────────────────
function ReactionBar({ reactions, onReact, isMe }: { reactions: ReactionSummary[]; onReact: (e: string) => void; isMe: boolean }) {
  return (
    <div className={cn('flex flex-wrap gap-0.5 -mt-1.5 relative z-10', isMe ? 'justify-end' : 'justify-start')}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onReact(r.emoji)}
          className={cn(
            'flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs shadow-sm border transition-colors',
            r.reacted_by_me
              ? 'bg-primary/15 border-primary/30'
              : 'bg-card border-border/40',
          )}
        >
          <span>{r.emoji}</span>
          {r.count > 1 && <span className="text-[9px] font-bold text-muted-foreground">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Message actions (hover menu) ───────────────────────────────────────────
function MessageActions({
  message, isMe, onReact, onEdit, onDelete,
}: {
  message: ChatMessage;
  isMe: boolean;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: (forEveryone?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn(
      'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-start mt-1 mx-1',
      isMe ? 'flex-row-reverse' : 'flex-row',
    )}>
      {EMOJI_QUICK.slice(0, 4).map((e) => (
        <button
          key={e}
          onClick={() => onReact(e)}
          className="text-sm hover:scale-125 transition-transform p-0.5"
        >
          {e}
        </button>
      ))}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 rounded-full hover:bg-muted text-muted-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className={cn(
            'absolute bottom-full mb-1 z-50 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[150px]',
            isMe ? 'right-0' : 'left-0',
          )}>
            {isMe && (
              <button
                onClick={() => { setOpen(false); onEdit(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
              >
                <Edit2 className="h-3 w-3" /> Edit
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onDelete(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Delete for me
            </button>
            {isMe && (
              <button
                onClick={() => { setOpen(false); onDelete(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-destructive hover:bg-muted transition-colors"
              >
                <Trash2 className="h-3 w-3" /> Delete for everyone
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
