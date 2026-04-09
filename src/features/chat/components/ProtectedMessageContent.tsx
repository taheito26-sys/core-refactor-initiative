import { useEffect, useState } from 'react';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markMessageViewed } from '../api/chat';
import type { ChatMessage } from '../types';
import { LinkifiedText } from './LinkifiedText';

const VIEW_ONCE_WINDOW_SECONDS = 8;

interface Props {
  message: ChatMessage;
  isMe: boolean;
  viewerId: string;
}

export function ProtectedMessageContent({ message, isMe, viewerId }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(VIEW_ONCE_WINDOW_SECONDS);

  const openedByAnyone = message.viewed_by.length > 0;
  const viewedByMe = message.viewed_by.includes(viewerId);
  const consumed = isMe ? openedByAnyone : viewedByMe;

  useEffect(() => {
    setRevealed(false);
    setSecondsLeft(VIEW_ONCE_WINDOW_SECONDS);
  }, [message.id]);

  useEffect(() => {
    if (!revealed || !message.view_once || isMe) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setRevealed(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [revealed, message.view_once, isMe]);

  const handleReveal = async () => {
    if (isMe || revealed || viewedByMe) return;

    setSecondsLeft(VIEW_ONCE_WINDOW_SECONDS);
    setRevealed(true);
    await markMessageViewed(message.id).catch(() => {});
  };

  if (message.view_once && consumed && !revealed) {
    return (
      <div className="flex items-center gap-2 py-1 text-[12px] italic text-muted-foreground/70">
        <EyeOff className="h-3.5 w-3.5 shrink-0" />
        <span>{isMe ? 'Opened once' : 'Opened once · content removed'}</span>
      </div>
    );
  }

  if (message.view_once && !isMe && !revealed) {
    return (
      <button
        type="button"
        onClick={handleReveal}
        className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-left text-primary transition-colors hover:bg-primary/15 active:scale-[0.98]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Shield className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide">One-time message</span>
          <span className="block text-[10px] text-muted-foreground">Tap once to reveal</span>
        </span>
      </button>
    );
  }

  return (
    <div className="relative">
      {message.view_once && (
        <span className="absolute right-1 top-1 z-10 inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
          <Eye className="h-2.5 w-2.5" />
          {isMe ? '1 view' : `${secondsLeft}s`}
        </span>
      )}

      <div className={cn(message.view_once && 'pr-14')}>
        <LinkifiedText text={message.content} />
      </div>
    </div>
  );
}
