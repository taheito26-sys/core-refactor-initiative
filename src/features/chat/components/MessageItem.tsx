import { useMemo } from 'react';
import { TrackerActionMenu } from '@/features/chat/components/TrackerActionMenu';

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
}: Props) {
  const grouped = useMemo(() => {
    const map: Record<string, number> = {};
    reactions.forEach((r) => {
      map[r] = (map[r] || 0) + 1;
    });
    return map;
  }, [reactions]);

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-1`}>
      <div className={`max-w-[78%] rounded-xl border px-3 py-2 ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'}`}>
        <div className="text-sm whitespace-pre-wrap break-words">{message.body || message.content || '(deleted)'}</div>
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
            <TrackerActionMenu onCreateOrder={onCreateOrder ?? (() => {})} onCreateTask={onCreateTask ?? (() => {})} />
        </div>
      </div>
    </div>
  );
}
