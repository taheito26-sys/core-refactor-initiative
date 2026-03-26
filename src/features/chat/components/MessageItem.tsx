import { useMemo, useState, useEffect } from 'react';
import { TrackerActionMenu } from '@/features/chat/components/TrackerActionMenu';
import { ShieldAlert, Flame, RefreshCw, MessageCircle } from 'lucide-react';
import { MOCK_IDENTITIES } from '@/lib/os-store';
import { parseMsg, splitLinks } from '@/features/chat/lib/message-codec';

interface Props {
  message: any;
  isOwn: boolean;
  reactions?: string[];
  pinned?: boolean;
  onReact?: (emoji: string, remove?: boolean) => void;
  onPinToggle?: () => void;
  onMarkRead?: () => void;
  onDeleteForMe?: () => void;
  onDeleteForEveryone?: () => void;
  onCreateOrder?: () => void;
  onCreateTask?: () => void;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  currentUserId?: string;
  counterpartyName?: string;
  isHighlighted?: boolean;
  onReply?: () => void;
  onConvert?: (type: 'task' | 'order') => void;
}

export function MessageItem({
  message,
  isOwn,
  reactions = [],
  pinned = false,
  onReact,
  onPinToggle,
  onMarkRead,
  onDeleteForMe,
  onDeleteForEveryone,
  onCreateOrder,
  onCreateTask,
  onConvert,
  onReply,
}: Props) {
  const [vanished, setVanished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);

  const raw = message.body || message.content || '(deleted)';
  const parsed = useMemo(() => parseMsg(raw), [raw]);
  
  const isVanish = raw.startsWith('||VANISH||');
  const displayContent = isVanish ? parsed.text.replace('||VANISH||', '') : parsed.text;

  const isCopyable = message.permissions?.copyable !== false;
  const identity = message.sender_identity_id ? MOCK_IDENTITIES[message.sender_identity_id] : null;

  useEffect(() => {
    if (isVanish && !vanished) {
      const interval = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) { clearInterval(interval); setVanished(true); return 0; }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isVanish, vanished]);

  const groupedReactions = useMemo(() => {
    const map: Record<string, number> = {};
    reactions.forEach((r) => {
      map[r] = (map[r] || 0) + 1;
    });
    return map;
  }, [reactions]);

  if (vanished) return null;

  const renderContent = (text: string) => {
    // 1. Split by mentions
    const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} className="text-sky-500 font-bold hover:underline cursor-pointer">{part}</span>;
      }
      // 2. Split by links
      return splitLinks(part).map((p, j) => 
        p.type === 'link' ? <a key={`${i}-${j}`} href={p.value} target="_blank" rel="noreferrer" className="text-blue-400 underline">{p.value}</a> : p.value
      );
    });
  };

  return (
    <div className={`group flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-1 relative`}>
      <div 
        className={`max-w-[78%] rounded-xl border px-3 py-2 ${isOwn ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-card-foreground shadow-sm'} relative`}
        style={{
          userSelect: !isCopyable ? 'none' : 'auto',
          WebkitUserSelect: !isCopyable ? 'none' : 'auto',
        }}
      >
        {/* Threaded Reply Preview */}
        {parsed.isReply && (
          <div className="mb-2 p-2 bg-black/5 rounded border-l-4 border-primary/50 text-[11px] opacity-80 cursor-pointer hover:bg-black/10 transition">
            <p className="font-bold uppercase tracking-tighter mb-0.5">{parsed.replySender || 'Reply'}</p>
            <p className="truncate line-clamp-1">{parsed.replyPreview}</p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-1">
          {identity && (
            <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">
              {identity.provider_type}
            </span>
          )}
          {!isCopyable && <ShieldAlert size={12} className="text-destructive" />}
          {isVanish && <span className="text-[10px] text-purple-400 font-bold flex items-center gap-1"><Flame size={10} /> {timeLeft}s</span>}
        </div>

        <div className={`text-sm whitespace-pre-wrap break-words ${!isCopyable ? 'pointer-events-none' : ''}`}>
          {renderContent(displayContent)}
        </div>

        {/* Action Menu (Visible on hover or mobile) */}
        <div className="mt-2 flex flex-wrap items-center gap-1 opacity-60 group-hover:opacity-100 transition">
          {Object.entries(groupedReactions).map(([emoji, count]) => (
            <button key={emoji} onClick={() => onReact?.(emoji, true)} className="rounded-full border px-2 py-0.5 text-[11px]">
              {emoji} {count}
            </button>
          ))}
          <button className="text-[11px] rounded border px-1.5" onClick={() => onReact?.('👍')}>+👍</button>
          <button className="text-[11px] rounded border px-1.5" onClick={() => onReact?.('❤️')}>+❤️</button>
          <button className="text-[11px] rounded border px-1.5" onClick={onPinToggle}>{pinned ? 'Unpin' : 'Pin'}</button>
          <button className="text-[11px] rounded border px-1.5 flex items-center gap-1" onClick={onReply}><MessageCircle size={10} /> Reply</button>
          {!isOwn && <button className="text-[11px] rounded border px-1.5" onClick={onMarkRead}>Read</button>}
          
          <TrackerActionMenu onCreateOrder={onCreateOrder ?? (() => {})} onCreateTask={onCreateTask ?? (() => {})} />
          
          {onConvert && (
            <div className="flex gap-1 ml-auto">
              <button onClick={() => onConvert('task')} className="text-[10px] p-1 rounded hover:bg-accent"><RefreshCw size={10} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
