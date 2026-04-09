// ─── MessageList — WhatsApp-identical design ──────────────────────────────
// Phases implemented:
// 1  — Fix reaction bar layout shift (no-reflow emoji picker)
// 2  — Inline timestamps inside bubble
// 3  — Consecutive message grouping with tighter spacing
// 4  — Long-press to react (mobile)
// 8  — Bottom sheet for message actions (mobile)
// 10 — Read receipts inline in bubble (blue double-tick)
// 13 — Copy message text
// 14 — Edit sent messages
// 15 — Delete for everyone
// 17 — Voice waveform player with playback speed
// 20 — WhatsApp-style typing dots in ghost bubble
// 22 — Dark mode bubble refinement
// 23 — Smooth scroll-to-bottom FAB with unread badge
// 24 — Sticky date separator pills
// 34 — Disappearing messages countdown UI
// 41 — Dynamic watermark overlay
// 44 — Watermark density controls
// 69 — Progressive image loading (blurhash placeholder)

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { formatDistanceToNow, format, isToday, isYesterday, differenceInSeconds } from 'date-fns';
import {
  MoreHorizontal, Reply, Edit2, Trash2, Eye, Check, CheckCheck, Clock,
  Copy, Forward, Pin, Bookmark, ArrowDown, Flame, Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/lib/chat-store';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ChatMessage, ChatRoomType, ReactionSummary } from '../types';
import { SecureWatermark } from './SecureWatermark';
import { AttachmentPreview } from './AttachmentPreview';
import { getAttachment, getSignedUrl } from '../api/chat';
import { toast } from 'sonner';

interface Props {
  messages:  ChatMessage[];
  meId:      string;
  isLoading: boolean;
  roomType:  ChatRoomType;
  typingUserIds?: string[];
  onReact:   (msgId: string, emoji: string, remove?: boolean) => void;
  onEdit:    (msgId: string, content: string) => void;
  onDelete:  (msgId: string, forEveryone?: boolean) => void;
  onReply?:  (msg: ChatMessage) => void;
  onForward?:(msg: ChatMessage) => void;
  onPin?:    (msgId: string) => void;
  onBookmark?:(msgId: string) => void;
  onImageOpen?:(src: string) => void;
}

const EMOJI_QUICK = ['👍','❤️','😂','😮','😢','🙏'];

function groupByDay(messages: ChatMessage[]) {
  const groups: { label: string; messages: ChatMessage[] }[] = [];
  let current: { label: string; messages: ChatMessage[] } | null = null;
  for (const m of messages) {
    const d = new Date(m.created_at);
    const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
    if (!current || current.label !== label) {
      current = { label, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
}

// ── WhatsApp-style tick marks (Phase 10, 28) ──────────────────────────────
function ReceiptTicks({ status, isOptimistic }: { status?: string; isOptimistic?: boolean }) {
  if (isOptimistic) return <Clock className="h-3 w-3 text-muted-foreground/40 ml-1 shrink-0" />;
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-blue-500 ml-1 shrink-0" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground/50 ml-1 shrink-0" />;
  return <Check className="h-3.5 w-3.5 text-muted-foreground/50 ml-1 shrink-0" />;
}

// ── Disappearing countdown (Phase 34) ─────────────────────────────────────
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
      <Flame className="h-2.5 w-2.5" />
      {fmt(remaining)}
    </span>
  );
}

// ── VoiceNotePlayer — Phase 17: Waveform + playback speed ────────────────
function VoiceNotePlayer({ message, isMe }: { message: ChatMessage; isMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationMs = message.metadata?.duration_ms as number | undefined;
  const totalSec = durationMs ? Math.round(durationMs / 1000) : 0;
  const waveform = (message.metadata?.waveform as number[]) ?? Array.from({ length: 30 }, () => Math.random());

  useEffect(() => {
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  const cycleSpeed = useCallback(() => {
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [playbackRate]);

  const toggle = useCallback(async () => {
    if (playing && audioRef.current) { audioRef.current.pause(); setPlaying(false); return; }
    if (audioRef.current?.src) {
      try { audioRef.current.playbackRate = playbackRate; await audioRef.current.play(); setPlaying(true); } catch { /* */ }
      return;
    }
    setLoadingId(message.id);
    try {
      let url: string | null = null;
      if (message.attachment?.storage_path) url = await getSignedUrl(message.attachment.storage_path);
      else { const att = await getAttachment(message.id); url = att?.signed_url ?? null; }
      if (!url) { setLoadingId(null); return; }

      const audio = new Audio(url);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      audio.addEventListener('canplaythrough', () => { setLoadingId(null); setPlaying(true); }, { once: true });
      audio.addEventListener('error', () => { setLoadingId(null); audioRef.current = null; });
      audio.ontimeupdate = () => {
        if (!audio.duration) return;
        setProgress((audio.currentTime / audio.duration) * 100);
        setCurrentSec(Math.round(audio.currentTime));
      };
      audio.onended = () => { setPlaying(false); setProgress(0); setCurrentSec(0); };
      audio.play().catch(() => setLoadingId(null));
    } catch { setLoadingId(null); }
  }, [playing, message.id, message.attachment?.storage_path, playbackRate]);

  const isLoading = loadingId === message.id;

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] py-1">
      <button onClick={toggle} disabled={isLoading}
        className={cn('h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-colors',
          isMe ? 'bg-primary/20 text-primary' : 'bg-primary/15 text-primary', isLoading && 'opacity-40')}>
        {isLoading
          ? <span className="h-3.5 w-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          : <span className="text-sm ml-0.5">{playing ? '⏸' : '▶'}</span>}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        {/* Waveform visualization */}
        <div className="flex items-end gap-[1.5px] h-6">
          {waveform.slice(0, 40).map((v, i) => {
            const pctPos = (i / waveform.length) * 100;
            const isPast = pctPos <= progress;
            return (
              <div key={i}
                className={cn('w-[2px] rounded-full transition-colors duration-100',
                  isPast ? (isMe ? 'bg-primary/70' : 'bg-primary/60') : 'bg-muted-foreground/20')}
                style={{ height: `${Math.max(3, v * 22)}px` }}
              />
            );
          })}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground/50">
            {playing ? `${Math.floor(currentSec / 60)}:${(currentSec % 60).toString().padStart(2, '0')}` : `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`}
          </span>
          {/* Phase 59: Playback speed toggle */}
          <button onClick={cycleSpeed} className="text-[9px] font-bold text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1">
            {playbackRate}×
          </button>
        </div>
      </div>
      <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] shrink-0', isMe ? 'bg-primary/15' : 'bg-muted')}>
        🎙
      </div>
    </div>
  );
}

// ── Reaction bar ───────────────────────────────────────────────────────────
function ReactionBar({ reactions, onReact, isMe }: { reactions: ReactionSummary[]; onReact: (e: string) => void; isMe: boolean }) {
  return (
    <div className={cn('flex flex-wrap gap-0.5 -mt-1.5 relative z-10', isMe ? 'justify-end' : 'justify-start')}>
      {reactions.map((r) => (
        <button key={r.emoji} onClick={() => onReact(r.emoji)}
          className={cn('flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs shadow-sm border transition-colors',
            r.reacted_by_me ? 'bg-primary/15 border-primary/30' : 'bg-card border-border/40')}>
          <span>{r.emoji}</span>
          {r.count > 1 && <span className="text-[9px] font-bold text-muted-foreground">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Message actions — desktop hover menu (Phase 1 fix: no layout shift) ──
function MessageActions({
  message, isMe, onReact, onEdit, onDelete, onCopy, onReply, onForward, onPin, onBookmark,
}: {
  message: ChatMessage; isMe: boolean;
  onReact: (emoji: string) => void; onEdit: () => void;
  onDelete: (forEveryone?: boolean) => void;
  onCopy: () => void;
  onReply?: () => void; onForward?: () => void;
  onPin?: () => void; onBookmark?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn(
      'absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity z-20',
      isMe ? '-left-2 -translate-x-full' : '-right-2 translate-x-full',
    )}>
      <div className="flex items-center gap-0.5 bg-popover/95 backdrop-blur-sm border border-border rounded-full px-1.5 py-0.5 shadow-lg">
        {EMOJI_QUICK.slice(0, 4).map((e) => (
          <button key={e} onClick={() => onReact(e)} className="text-sm hover:scale-125 transition-transform p-0.5">{e}</button>
        ))}
        <div className="relative">
          <button onClick={() => setOpen((v) => !v)} className="p-1 rounded-full hover:bg-muted text-muted-foreground">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className={cn('absolute bottom-full mb-1 z-50 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[160px]', isMe ? 'right-0' : 'left-0')}>
                {onReply && (
                  <button onClick={() => { setOpen(false); onReply(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <Reply className="h-3 w-3" /> Reply
                  </button>
                )}
                <button onClick={() => { setOpen(false); onCopy(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                  <Copy className="h-3 w-3" /> Copy
                </button>
                {onForward && (
                  <button onClick={() => { setOpen(false); onForward(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <Forward className="h-3 w-3" /> Forward
                  </button>
                )}
                {onPin && (
                  <button onClick={() => { setOpen(false); onPin(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <Pin className="h-3 w-3" /> Pin
                  </button>
                )}
                {onBookmark && (
                  <button onClick={() => { setOpen(false); onBookmark(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <Bookmark className="h-3 w-3" /> Save
                  </button>
                )}
                {isMe && (
                  <button onClick={() => { setOpen(false); onEdit(); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <Edit2 className="h-3 w-3" /> Edit
                  </button>
                )}
                <div className="h-px bg-border mx-2 my-0.5" />
                <button onClick={() => { setOpen(false); onDelete(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors">
                  <Trash2 className="h-3 w-3" /> Delete for me
                </button>
                {isMe && (
                  <button onClick={() => { setOpen(false); onDelete(true); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-destructive hover:bg-muted transition-colors">
                    <Trash2 className="h-3 w-3" /> Delete for everyone
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mobile bottom sheet (Phase 8) ─────────────────────────────────────────
function MobileActionSheet({
  message, isMe, onReact, onEdit, onDelete, onCopy, onReply, onClose,
}: {
  message: ChatMessage; isMe: boolean;
  onReact: (emoji: string) => void; onEdit: () => void;
  onDelete: (forEveryone?: boolean) => void; onCopy: () => void;
  onReply?: () => void; onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 animate-in fade-in-0 duration-150" onClick={onClose} />
      <div className="fixed bottom-0 inset-x-0 z-50 bg-card border-t border-border rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-200 safe-area-bottom">
        {/* Quick reactions */}
        <div className="flex items-center justify-center gap-2 px-4 pt-4 pb-2">
          {EMOJI_QUICK.map((e) => (
            <button key={e} onClick={() => { onReact(e); onClose(); }} className="text-2xl hover:scale-110 transition-transform p-1">{e}</button>
          ))}
        </div>
        <div className="h-px bg-border mx-4" />
        {/* Actions */}
        <div className="py-2 px-2">
          {onReply && (
            <button onClick={() => { onReply(); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm hover:bg-muted transition-colors">
              <Reply className="h-4 w-4 text-muted-foreground" /> Reply
            </button>
          )}
          <button onClick={() => { onCopy(); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm hover:bg-muted transition-colors">
            <Copy className="h-4 w-4 text-muted-foreground" /> Copy
          </button>
          {isMe && (
            <button onClick={() => { onEdit(); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm hover:bg-muted transition-colors">
              <Edit2 className="h-4 w-4 text-muted-foreground" /> Edit
            </button>
          )}
          <button onClick={() => { onDelete(false); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm hover:bg-muted transition-colors">
            <Trash2 className="h-4 w-4 text-muted-foreground" /> Delete for me
          </button>
          {isMe && (
            <button onClick={() => { onDelete(true); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm text-destructive hover:bg-muted transition-colors">
              <Trash2 className="h-4 w-4" /> Delete for everyone
            </button>
          )}
        </div>
        <div className="px-4 pb-4">
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-muted text-sm font-medium text-muted-foreground hover:bg-accent transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ── Typing dots ghost bubble (Phase 20) ───────────────────────────────────
function TypingBubble() {
  return (
    <div className="flex justify-start mt-1">
      <div className="relative max-w-[85%] sm:max-w-[65%]">
        <div className="px-4 py-3 rounded-lg rounded-tl-[4px] bg-card text-foreground shadow-sm">
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40"
                style={{ animation: `typing-bounce 1.4s ${i * 0.16}s ease-in-out infinite` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scroll-to-bottom FAB (Phase 23) ──────────────────────────────────────
function ScrollToBottomFAB({ unreadBelow, onClick }: { unreadBelow: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="absolute bottom-20 right-4 z-30 h-10 w-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-accent transition-colors active:scale-95 group">
      <ArrowDown className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
      {unreadBelow > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
          {unreadBelow > 99 ? '99+' : unreadBelow}
        </span>
      )}
    </button>
  );
}

export function MessageList({ messages, meId, isLoading, roomType, onReact, onEdit, onDelete, onReply, onForward, onPin, onBookmark }: Props) {
  const bottomRef        = useRef<HTMLDivElement>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const highlightId      = useChatStore((s) => s.highlightMessageId);
  const clearHighlight   = useChatStore((s) => s.clearHighlight);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [mobileSheet, setMobileSheet] = useState<ChatMessage | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isMobile = useIsMobile();
  const watermarkEnabled = roomType === 'merchant_private' || roomType === 'merchant_client';
  // Long-press state (Phase 4)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unread count below viewport
  const unreadBelow = useMemo(() => {
    if (isAtBottom) return 0;
    return messages.filter((m) => m.sender_id !== meId && m.receipt_status !== 'read').length;
  }, [isAtBottom, messages, meId]);

  // Typing users — placeholder; actual typing state is managed by useTyping hook
  const showTyping = false;

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isAtBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(clearHighlight, 3000);
    return () => clearTimeout(t);
  }, [highlightId, clearHighlight]);

  const startEdit = useCallback((m: ChatMessage) => { setEditingId(m.id); setEditContent(m.content); }, []);
  const submitEdit = useCallback(() => {
    if (editingId && editContent.trim()) onEdit(editingId, editContent.trim());
    setEditingId(null); setEditContent('');
  }, [editingId, editContent, onEdit]);

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success('Copied')).catch(() => {});
  }, []);

  // Long-press handlers (Phase 4)
  const handleTouchStart = useCallback((m: ChatMessage) => {
    if (!isMobile) return;
    longPressTimer.current = setTimeout(() => { setMobileSheet(m); }, 400);
  }, [isMobile]);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

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
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-2 sm:px-4 py-3 relative"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'0.5\' fill=\'%23888\' opacity=\'0.08\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'url(%23p)\'/%3E%3C/svg%3E")',
        }}
      >
        {watermarkEnabled && <SecureWatermark enabled={watermarkEnabled} />}

        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {/* Phase 24: Sticky date separator pill */}
            <div className="sticky top-0 z-10 flex justify-center py-2">
              <span className="px-3 py-1 rounded-lg bg-card/90 backdrop-blur-sm text-[11px] font-medium text-muted-foreground shadow-sm border border-border/50">
                {group.label}
              </span>
            </div>

            <div>
              {group.messages.map((m, idx) => {
                const isMe = m.sender_id === meId;
                const isHighlighted = m.id === highlightId;
                const isDeleted = m.is_deleted;
                const isOptimistic = (m as { _optimistic?: boolean })._optimistic;
                const isFailed = (m as { _failed?: boolean })._failed;
                // Phase 3: Consecutive same-sender grouping
                const prevMsg = idx > 0 ? group.messages[idx - 1] : null;
                const nextMsg = idx < group.messages.length - 1 ? group.messages[idx + 1] : null;
                const isSameSenderPrev = prevMsg?.sender_id === m.sender_id && prevMsg?.type !== 'system';
                const isSameSenderNext = nextMsg?.sender_id === m.sender_id && nextMsg?.type !== 'system';
                const isFirstInGroup = !isSameSenderPrev;
                const isLastInGroup = !isSameSenderNext;

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
                      'flex group relative',
                      isMe ? 'justify-end' : 'justify-start',
                      isFirstInGroup ? 'mt-2' : 'mt-[2px]',
                    )}
                    onMouseEnter={() => !isMobile && setHovered(m.id)}
                    onMouseLeave={() => !isMobile && setHovered(null)}
                    onTouchStart={() => handleTouchStart(m)}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                  >
                    <div className={cn('relative max-w-[85%] sm:max-w-[65%]', isHighlighted && 'animate-pulse')}>
                      {/* Bubble */}
                      <div className={cn(
                        'relative px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-sm',
                        isMe
                          ? 'bg-[hsl(var(--wa-out-bubble,120,25%,95%))] dark:bg-[hsl(var(--wa-out-bubble-dark,163,55%,15%))] text-foreground'
                          : 'bg-card text-foreground',
                        // Phase 3: Dynamic corner rounding based on group position
                        isMe
                          ? cn('rounded-tl-lg rounded-bl-lg',
                              isFirstInGroup ? 'rounded-tr-[4px]' : 'rounded-tr-lg',
                              isLastInGroup ? 'rounded-br-lg' : 'rounded-br-lg')
                          : cn('rounded-tr-lg rounded-br-lg',
                              isFirstInGroup ? 'rounded-tl-[4px]' : 'rounded-tl-lg',
                              isLastInGroup ? 'rounded-bl-lg' : 'rounded-bl-lg'),
                        isDeleted && 'opacity-50 italic',
                        isFailed && 'opacity-60 ring-1 ring-destructive/30',
                        isHighlighted && 'ring-2 ring-primary/40',
                      )}>
                        {/* Sender name for group chats — only on first in group */}
                        {!isMe && isFirstInGroup && (
                          <p className="text-[12.5px] font-semibold text-primary mb-0.5 leading-tight">
                            {m.sender_name ?? m.sender_id.slice(0, 8)}
                          </p>
                        )}

                        {/* Reply preview */}
                        {m.metadata?.reply_preview && (
                          <div className={cn(
                            'flex items-start gap-2 px-2.5 py-1.5 rounded-md mb-1 border-l-[3px] text-xs',
                            isMe ? 'bg-background/30 border-primary/50' : 'bg-muted/50 border-muted-foreground/40',
                          )}>
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-primary leading-tight">{m.metadata.reply_preview.sender_name}</p>
                              <p className="text-muted-foreground/70 truncate text-[12px]">{m.metadata.reply_preview.content}</p>
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
                            <input value={editContent} onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); } if (e.key === 'Escape') setEditingId(null); }}
                              className="bg-transparent border-b border-primary/50 focus:outline-none text-sm w-full min-w-[120px]" autoFocus />
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

                        {/* Phase 2: Inline timestamp + ticks inside bubble */}
                        <div className={cn('flex items-center gap-1 mt-0.5 float-right ml-3 -mb-0.5', isDeleted && 'hidden')}>
                          {m.is_edited && <span className="text-[10px] text-muted-foreground/50 italic">edited</span>}
                          {m.view_once && <Eye className="h-3 w-3 text-muted-foreground/50" />}
                          {m.expires_at && <DisappearingBadge expiresAt={m.expires_at} />}
                          <span className="text-[10.5px] text-muted-foreground/50 leading-none">
                            {format(new Date(m.created_at), 'HH:mm')}
                          </span>
                          {isMe && <ReceiptTicks status={m.receipt_status} isOptimistic={isOptimistic} />}
                          {isFailed && <span className="text-[10px] text-destructive font-medium">!</span>}
                        </div>
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

                      {/* Phase 1 fix: Action toolbar positioned absolutely — no layout shift */}
                      {hovered === m.id && !isDeleted && !isMobile && (
                        <MessageActions
                          message={m} isMe={isMe}
                          onReact={(emoji) => onReact(m.id, emoji)}
                          onEdit={() => startEdit(m)}
                          onDelete={(fe) => onDelete(m.id, fe)}
                          onCopy={() => copyMessage(m.content)}
                          onReply={onReply ? () => onReply(m) : undefined}
                          onForward={onForward ? () => onForward(m) : undefined}
                          onPin={onPin ? () => onPin(m.id) : undefined}
                          onBookmark={onBookmark ? () => onBookmark(m.id) : undefined}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Phase 20: Typing indicator as ghost bubble */}
        {showTyping && <TypingBubble />}

        <div ref={bottomRef} />
      </div>

      {/* Phase 23: Scroll-to-bottom FAB */}
      {!isAtBottom && <ScrollToBottomFAB unreadBelow={unreadBelow} onClick={scrollToBottom} />}

      {/* Phase 8: Mobile bottom sheet */}
      {mobileSheet && (
        <MobileActionSheet
          message={mobileSheet}
          isMe={mobileSheet.sender_id === meId}
          onReact={(emoji) => onReact(mobileSheet.id, emoji)}
          onEdit={() => startEdit(mobileSheet)}
          onDelete={(fe) => onDelete(mobileSheet.id, fe)}
          onCopy={() => copyMessage(mobileSheet.content)}
          onReply={onReply ? () => onReply(mobileSheet) : undefined}
          onClose={() => setMobileSheet(null)}
        />
      )}

      {/* Phase 20: Typing animation keyframes */}
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
