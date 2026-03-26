import { useMemo, useState, useEffect } from 'react';
import { TrackerActionMenu } from '@/features/chat/components/TrackerActionMenu';
import { ShieldAlert, Flame, RefreshCw } from 'lucide-react';
import { MOCK_IDENTITIES } from '@/lib/os-store';

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
}: Props) {
  const [vanished, setVanished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);

  const content = message.body || message.content || '(deleted)';
  const isVanish = content.startsWith('||VANISH||');
  const displayContent = isVanish ? content.replace('||VANISH||', '') : content;

  const isCopyable = message.permissions?.copyable !== false;
  const isForwardable = message.permissions?.forwardable !== false;

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

  const grouped = useMemo(() => {
    const map: Record<string, number> = {};
    reactions.forEach((r) => {
      map[r] = (map[r] || 0) + 1;
    });
    return map;
  }, [reactions]);

  if (vanished) return null;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-1`}>
      <div 
        className={`max-w-[78%] rounded-xl border px-3 py-2 ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'} relative`}
        style={{
          userSelect: !isCopyable ? 'none' : 'auto',
          WebkitUserSelect: !isCopyable ? 'none' : 'auto',
        }}
      >
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
          {displayContent}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {Object.entries(grouped).map(([emoji, count]) => (
            <button
              key={emoji}
              onClick={() => onReact(emoji, true)}
              className="rounded-full border px-2 py-0.5 text-[11px]"
            >
              {emoji} {count}
            </button>
          ))}
            <button className="text-[11px] rounded border px-1.5" onClick={() => onReact?.('👍')}>+👍</button>
            <button className="text-[11px] rounded border px-1.5" onClick={() => onReact?.('❤️')}>+❤️</button>
            <button className="text-[11px] rounded border px-1.5" onClick={onPinToggle}>{pinned ? 'Unpin' : 'Pin'}</button>
            {!isOwn && <button className="text-[11px] rounded border px-1.5" onClick={onMarkRead}>Mark Read</button>}
            <button className="text-[11px] rounded border px-1.5" onClick={onDeleteForMe}>Delete for me</button>
            {isOwn && <button className="text-[11px] rounded border px-1.5" onClick={onDeleteForEveryone}>Delete for all</button>}
            
            {isForwardable && onConvert && (
              <div className="flex gap-1">
                <button onClick={() => onConvert('task')} className="text-[11px] rounded border px-1.5 flex items-center gap-1 hover:bg-accent">
                  <RefreshCw size={10} /> Extract Task
                </button>
                <button onClick={() => onConvert('order')} className="text-[11px] rounded border px-1.5 flex items-center gap-1 hover:bg-accent">
                  <RefreshCw size={10} /> Gen Order
                </button>
              </div>
            )}

            <TrackerActionMenu onCreateOrder={onCreateOrder ?? (() => {})} onCreateTask={onCreateTask ?? (() => {})} />
        </div>
      </div>
    </div>
  );
}
