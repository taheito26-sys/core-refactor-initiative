// ─── MessageList ──────────────────────────────────────────────────────────
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
    const label = isToday(d)
      ? 'Today'
      : isYesterday(d)
      ? 'Yesterday'
      : format(d, 'EEEE, MMM d');

    if (!current || current.label !== label) {
      current = { label, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
}

function receiptIcon(status?: string) {
  if (status === 'read')      return <CheckCheck className="h-3 w-3 text-blue-400" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-muted-foreground/50" />;
  return <Check className="h-3 w-3 text-muted-foreground/30" />;
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

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Scroll to highlighted message
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

  const groups = groupByDay(
    messages.filter((m) => {
      if (m.deleted_for_sender && m.sender_id === meId) return false;
      if (m.expires_at && new Date(m.expires_at) < new Date()) return false;
      return true;
    }),
  );

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-6 relative">
      {watermarkEnabled && <SecureWatermark enabled={watermarkEnabled} />}

      {groups.map((group) => (
        <div key={group.label}>
          {/* Day divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">
              {group.label}
            </span>
            <div className="h-px flex-1 bg-border/30" />
          </div>

          <div className="space-y-1">
            {group.messages.map((m) => {
              const isMe = m.sender_id === meId;
              const isHighlighted = m.id === highlightId;
              const isDeleted = m.is_deleted;
              const isOptimistic = (m as {_optimistic?: boolean})._optimistic;
              const isFailed = (m as {_failed?: boolean})._failed;

              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={cn(
                    'flex group',
                    isMe ? 'justify-end' : 'justify-start',
                    isHighlighted && 'ring-1 ring-primary/30 rounded-xl',
                  )}
                  onMouseEnter={() => setHovered(m.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div className={cn('max-w-[72%] flex flex-col', isMe && 'items-end')}>
                    {/* Sender name (not me, not direct) */}
                    {!isMe && (
                      <span className="text-[10px] font-semibold text-muted-foreground/70 mb-0.5 ml-1">
                        {m.sender_name ?? m.sender_id.slice(0, 8)}
                      </span>
                    )}

                    {/* Reply preview */}
                    {m.metadata?.reply_preview && (
                      <div className={cn(
                        'flex items-start gap-2 px-3 py-1.5 rounded-lg mb-1 border-l-2 text-xs',
                        isMe
                          ? 'bg-primary/5 border-primary/30 text-right'
                          : 'bg-muted/60 border-muted-foreground/30',
                      )}>
                        <div className="min-w-0">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wide">
                            {m.metadata.reply_preview.sender_name}
                          </p>
                          <p className="text-muted-foreground/70 truncate text-[11px]">
                            {m.metadata.reply_preview.content}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Bubble */}
                    <div
                      className={cn(
                        'relative px-3.5 py-2 rounded-2xl text-sm leading-relaxed transition-all',
                        isMe
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-card border border-border/50 text-foreground rounded-bl-sm',
                        isDeleted && 'opacity-50 italic',
                        isFailed && 'opacity-60 border-destructive/50',
                        isHighlighted && 'ring-2 ring-primary/40',
                      )}
                    >
                      {isDeleted ? (
                        <span className="text-xs text-muted-foreground">Message deleted</span>
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
                          <div className="flex gap-1.5 text-[10px]">
                            <button onClick={submitEdit} className="text-primary-foreground/80 hover:text-primary-foreground">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-primary-foreground/50 hover:text-primary-foreground/70">Cancel</button>
                          </div>
                        </div>
                      ) : m.type === 'voice_note' ? (
                        <VoiceNotePlayer message={m} isMe={isMe} />
                      ) : (m.type === 'image' || m.type === 'file') ? (
                        <AttachmentPreview message={m} isMe={isMe} />
                      ) : m.type === 'system' || m.type === 'call_summary' ? (
                        <SystemMessageBubble message={m} />
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{m.content}</span>
                      )}

                      {/* Edited badge */}
                      {m.is_edited && !isDeleted && (
                        <span className={cn(
                          'text-[9px] ml-1.5 opacity-60',
                          isMe ? 'text-primary-foreground' : 'text-muted-foreground',
                        )}>
                          edited
                        </span>
                      )}

                      {/* View once badge */}
                      {m.view_once && !isDeleted && (
                        <span className="ml-1.5">
                          <Eye className="h-3 w-3 inline opacity-70" />
                        </span>
                      )}

                      {/* Disappearing countdown */}
                      {m.expires_at && !isDeleted && (
                        <DisappearingBadge expiresAt={m.expires_at} isMe={isMe} />
                      )}
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
                      />
                    )}

                    {/* Time + receipt */}
                    <div className={cn('flex items-center gap-1 mt-0.5 px-1', isMe && 'flex-row-reverse')}>
                      <span className="text-[9px] text-muted-foreground/40">
                        {format(new Date(m.created_at), 'HH:mm')}
                      </span>
                      {isMe && receiptIcon(m.receipt_status)}
                      {isFailed && <span className="text-[9px] text-destructive">Failed to send</span>}
                    </div>
                  </div>

                  {/* Action toolbar (hover) */}
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

function VoiceNotePlayer({ message, isMe }: { message: ChatMessage; isMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveform = message.metadata?.waveform as number[] | undefined;
  const durationMs = message.metadata?.duration_ms as number | undefined;

  // Fetch attachment audio URL on mount
  useEffect(() => {
    let cancelled = false;
    if (message.attachment?.storage_path) {
      setLoadingAudio(true);
      getSignedUrl(message.attachment.storage_path)
        .then((url) => { if (!cancelled) setAudioUrl(url); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoadingAudio(false); });
    } else {
      // Fetch attachment by message ID
      setLoadingAudio(true);
      getAttachment(message.id)
        .then((att) => {
          if (cancelled || !att) return;
          setAudioUrl(att.signed_url ?? null);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoadingAudio(false); });
    }
    return () => { cancelled = true; };
  }, [message.id, message.attachment?.storage_path]);

  const toggle = useCallback(async () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { await audioRef.current.play(); setPlaying(true); }
  }, [playing]);

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <button
        onClick={toggle}
        disabled={loadingAudio || !audioUrl}
        className={cn(
          'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
          isMe ? 'bg-primary-foreground/20' : 'bg-primary/20',
          (loadingAudio || !audioUrl) && 'opacity-50',
        )}
      >
        {loadingAudio
          ? <span className="h-3 w-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          : <span className="text-xs">{playing ? '⏸' : '▶'}</span>}
      </button>
      {/* Waveform bars */}
      <div className="flex items-end gap-0.5 h-6 flex-1">
        {(waveform ?? Array.from({ length: 24 }, () => Math.random())).map((v, i) => (
          <div
            key={i}
            style={{ height: `${Math.max(8, (v as number) * 24)}px` }}
            className={cn(
              'w-0.5 rounded-full shrink-0',
              playing && i < 12 ? 'bg-primary' : isMe ? 'bg-primary-foreground/40' : 'bg-primary/40',
            )}
          />
        ))}
      </div>
      <span className={cn('text-[9px] shrink-0', isMe ? 'text-primary-foreground/60' : 'text-muted-foreground/60')}>
        {durationMs ? `${Math.round(durationMs / 1000)}s` : '—'}
      </span>
      {/* Audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

function DisappearingBadge({ expiresAt, isMe }: { expiresAt: string; isMe: boolean }) {
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

  const formatTime = (s: number) => {
    if (s >= 86400) return `${Math.floor(s / 86400)}d`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 ml-1.5 text-[9px]',
      isMe ? 'text-primary-foreground/60' : 'text-amber-500',
    )}>
      <Clock className="h-2.5 w-2.5" />
      {formatTime(remaining)}
    </span>
  );
}

function SystemMessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-center justify-center py-1 px-3 rounded-full bg-muted/50 text-[11px] text-muted-foreground italic">
      {message.content}
    </div>
  );
}

function ReactionBar({ reactions, onReact }: { reactions: ReactionSummary[]; onReact: (e: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onReact(r.emoji)}
          className={cn(
            'flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors',
            r.reacted_by_me
              ? 'bg-primary/15 border-primary/30 text-primary'
              : 'bg-muted border-border/30 text-muted-foreground hover:bg-muted/80',
          )}
        >
          <span>{r.emoji}</span>
          {r.count > 1 && <span className="text-[9px] font-bold">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}

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
      'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-center mx-1',
      isMe ? 'flex-row-reverse' : 'flex-row',
    )}>
      {EMOJI_QUICK.map((e) => (
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
            'absolute bottom-full mb-1 z-50 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[140px]',
            isMe ? 'right-0' : 'left-0',
          )}>
            {isMe && (
              <button
                onClick={() => { setOpen(false); onEdit(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted"
              >
                <Edit2 className="h-3 w-3" /> Edit
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onDelete(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted"
            >
              <Trash2 className="h-3 w-3" /> Delete for me
            </button>
            {isMe && (
              <button
                onClick={() => { setOpen(false); onDelete(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-destructive hover:bg-muted"
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
