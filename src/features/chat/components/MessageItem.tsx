/**
 * MessageItem
 *
 * BUG 3 FIX: Exposes onReact / onDeleteForMe via a hover action bar.
 *            Previously all callbacks in ChatWorkspacePage were () => {} stubs.
 *
 * BUG 4 FIX: Read receipt uses read_at (set by receiver via fn_chat_mark_read)
 *            instead of the never-populated status === 'read' string.
 *            The real-time UPDATE subscription (Bug 1 fix) propagates read_at live.
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Check, CheckCheck, Shield, Eye, Lock, Zap, LayoutGrid,
  PlusCircle, Search, RefreshCcw, Trash2, SmilePlus,
} from 'lucide-react';
import { parseMsg } from '../lib/message-codec';
import { useMemo, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '🔥'];

interface MessageProps {
  message: {
    id: string;
    content: string;
    sender_id: string;
    /** ROOT CAUSE FIX: os_messages uses sender_merchant_id, not sender_id.
     *  Both are accepted; isMe checks whichever is non-empty. */
    sender_merchant_id?: string;
    created_at: string;
    type?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    status?: string;
    expires_at?: string;
    read_at?: string | null;        // BUG 4: counterparty read timestamp
  };
  currentUserId: string;
  // BUG 3: optional action callbacks
  onReact?: (messageId: string, emoji: string) => void;
  onDeleteForMe?: (messageId: string) => void;
  reactions?: Record<string, string[]>; // emoji → userIds
}

// BUG 4 FIX: derive status from read_at, not from a status field that is never 'read'
function ReadStatusIcon({ status, readAt }: { status?: string; readAt?: string | null }) {
  if (status === 'sending') return <RefreshCcw size={10} className="opacity-40 animate-spin" />;
  if (status === 'failed')  return <span className="text-destructive text-[9px] font-bold">!</span>;
  if (readAt)               return <CheckCheck size={12} className="text-primary" />;
  return <Check size={12} className="opacity-40" />;
}

export function MessageItem({ message, currentUserId, onReact, onDeleteForMe, reactions = {} }: MessageProps) {
  // ROOT CAUSE FIX: os_messages stores sender as sender_merchant_id, not sender_id.
  // Accept either field so the bubble renders on the correct side.
  const effectiveSenderId = message.sender_merchant_id || message.sender_id;
  const isMe     = effectiveSenderId === currentUserId;
  const isSystem = message.type === 'system';
  const parsed   = useMemo(() => parseMsg(message.content), [message.content]);
  const navigate = useNavigate();

  const [showOneTime,  setShowOneTime]  = useState(false);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOneTime = !!message.expires_at && !message.metadata?.timer;
  const isViewed  = parsed.isViewed || (message.metadata?.viewed === true);

  const handleReveal = async () => {
    if (isMe || isViewed) return;
    setShowOneTime(true);
    try {
      const viewedContent = `${message.content}||VIEWED||${new Date().toISOString()}||/VIEWED||`;
      await supabase.from('os_messages').update({ content: viewedContent }).eq('id', message.id);
    } catch {
      // non-critical — local reveal already shown
    }
  };

  const onEnter = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowEmojiBar(true); };
  const onLeave = () => { hideTimer.current = setTimeout(() => setShowEmojiBar(false), 250); };

  // ── System message ────────────────────────────────────────────────────────
  if (isSystem) {
    // BUG B FIX: codec sets parsed.text = '' and isSystemEvent = true when it
    // parses ||SYS_CALL||Call ended||/SYS_CALL|| — we must read systemEventFields
    // for the human-readable label.  Previously fell back to message.content
    // which produced the raw codec string (||SYS_CALL||Call ended||/SYS_CALL||).
    const systemLabel = parsed.isSystemEvent
      ? (parsed.systemEventFields?.[0] ?? parsed.text)
      : (parsed.text || message.content);

    // Map known event types to friendlier labels
    const CALL_LABELS: Record<string, string> = {
      'Call started':  '📞 Call started',
      'Call accepted': '✅ Call accepted',
      'Call ended':    '📵 Call ended',
      'call_started':  '📞 Call started',
      'call_accepted': '✅ Call accepted',
      'call_ended':    '📵 Call ended',
      'call_failed':   '❌ Call failed',
      'call_rejected': '🚫 Call rejected',
      'call_missed':   '📵 Missed call',
    };

    const display = CALL_LABELS[systemLabel] ?? systemLabel;

    return (
      <div className="flex justify-center my-4">
        <span className="bg-muted/50 text-muted-foreground text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] border border-border/50">
          {display}
        </span>
      </div>
    );
  }

  if (parsed.isAiSummary) {
    return (
      <div className="mx-6 my-4 p-4 rounded-2xl bg-violet-50/50 border border-violet-100 shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-violet-600">
          <Zap size={14} className="fill-current" />
          <span className="text-[10px] font-black uppercase tracking-widest">AI Protocol Summary</span>
        </div>
        <p className="text-[13px] text-slate-700 leading-relaxed italic">{parsed.text}</p>
      </div>
    );
  }

  if (parsed.isAppOutput) {
    return (
      <div className="mx-6 my-4 p-4 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-xl">
        <div className="flex items-center gap-2 mb-3 text-slate-400">
          <LayoutGrid size={14} />
          <span className="text-[10px] font-black uppercase tracking-widest">{parsed.appName || 'MiniApp'} Output</span>
        </div>
        <div className="font-mono text-[12px] bg-black/40 p-3 rounded-lg border border-white/5">{parsed.text}</div>
      </div>
    );
  }

  if (parsed.isAction) {
    const action = parsed.actionType;
    return (
      <div className={cn('flex w-full mb-4 px-4', isMe ? 'justify-end' : 'justify-start')}>
        <div className={cn('flex flex-col max-w-[85%] md:max-w-[70%]', isMe ? 'items-end' : 'items-start')}>
          <div className="bg-card border border-border rounded-[22px] p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <Zap size={12} className="text-primary" />
              Protocol Action Required
            </div>
            {action === 'create_order' && (
              <button onClick={() => navigate('/trading/orders?new=true')}
                className="flex items-center gap-3 w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/10 hover:scale-[1.02] transition-all active:scale-95">
                <PlusCircle size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">Create New Order</span>
              </button>
            )}
            {action === 'check_stock' && (
              <button onClick={() => navigate('/trading/stock')}
                className="flex items-center gap-3 w-full px-4 py-3 bg-accent text-accent-foreground rounded-xl shadow-sm hover:scale-[1.02] transition-all active:scale-95">
                <Search size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">Check Inventory</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Standard bubble ────────────────────────────────────────────────────────

  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  return (
    <div
      className={cn('flex w-full mb-1 px-4 group/msg', isMe ? 'justify-end' : 'justify-start')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={cn('flex flex-col max-w-[85%] md:max-w-[70%]', isMe ? 'items-end' : 'items-start')}>

        {/* Timestamp */}
        <div className="flex items-center gap-2 mb-1 px-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <span className="text-[8px] font-black text-muted-foreground uppercase tracking-tighter">
            {format(new Date(message.created_at), 'HH:mm')}
          </span>
        </div>

        <div className="relative flex items-end gap-2">

          {/* BUG 3 FIX: hover action bar */}
          {showEmojiBar && (onReact || onDeleteForMe) && (
            <div
              className={cn(
                'absolute bottom-full mb-1 flex items-center gap-0.5 bg-popover border border-border rounded-full px-2 py-1 shadow-lg z-10 animate-in fade-in-0 zoom-in-95 duration-100',
                isMe ? 'right-0' : 'left-0',
              )}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              {onReact && QUICK_EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => { onReact(message.id, emoji); setShowEmojiBar(false); }}
                  className="text-base hover:scale-125 transition-transform px-0.5 leading-none" title={emoji}>
                  {emoji}
                </button>
              ))}
              {onReact && onDeleteForMe && <span className="w-px h-4 bg-border mx-1" />}
              {onDeleteForMe && (
                <button onClick={() => { onDeleteForMe(message.id); setShowEmojiBar(false); }}
                  className="p-1 hover:bg-destructive/10 rounded-full transition-colors" title="Delete for me">
                  <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </div>
          )}

          {/* Bubble */}
          <div className={cn(
            'px-4 py-3 rounded-[22px] text-[13px] leading-relaxed shadow-sm border relative overflow-hidden transition-all',
            isMe
              ? 'bg-primary text-primary-foreground rounded-br-none border-primary/50'
              : 'bg-card text-card-foreground rounded-bl-none border-border',
          )}>
            {isOneTime && isViewed && !isMe ? (
              <div className="flex items-center gap-2 py-1 opacity-50 italic text-[11px]">
                <Lock size={12} /> Message viewed and locked
              </div>
            ) : isOneTime && !showOneTime && !isMe && !isViewed ? (
              <button onClick={handleReveal}
                className="flex items-center gap-2 py-1 px-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-all border-none cursor-pointer">
                <Shield size={14} className="text-primary" />
                <span className="font-bold text-[11px] text-primary uppercase tracking-widest">Reveal One-Time View</span>
              </button>
            ) : (
              <div className="whitespace-pre-wrap break-words">{parsed.text || message.content}</div>
            )}

            {isOneTime && !isViewed && (
              <div className="absolute top-0 right-0 p-1 bg-background/10 rounded-bl-lg backdrop-blur-md">
                <Eye size={10} className={isMe ? 'text-primary-foreground' : 'text-primary'} />
              </div>
            )}
          </div>

          {/* BUG 4 FIX: status icon driven by read_at */}
          {isMe && (
            <div className="flex flex-col items-center opacity-40 group-hover/msg:opacity-100 transition-opacity mb-1">
              <ReadStatusIcon status={message.status} readAt={message.read_at} />
            </div>
          )}
        </div>

        {/* Reaction pills */}
        {reactionEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 px-1">
            {reactionEntries.map(([emoji, users]) => (
              <button key={emoji} onClick={() => onReact?.(message.id, emoji)}
                className={cn(
                  'flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                  users.includes(currentUserId)
                    ? 'bg-primary/15 border-primary/30 text-primary'
                    : 'bg-muted/60 border-border text-muted-foreground hover:bg-muted',
                )}>
                {emoji}{users.length > 1 && <span className="font-bold ml-0.5">{users.length}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Hint when no reactions */}
        {showEmojiBar && reactionEntries.length === 0 && onReact && (
          <div className="flex items-center gap-1 mt-1 px-1 opacity-50">
            <SmilePlus size={10} className="text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground">Add reaction</span>
          </div>
        )}
      </div>
    </div>
  );
}
