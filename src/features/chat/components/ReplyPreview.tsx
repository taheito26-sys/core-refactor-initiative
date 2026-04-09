// ─── ReplyPreview — Shows quoted reply in composer ───────────────────────
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '../types';
import { resolveMessageSenderLabel } from '../lib/identity';

interface Props {
  message: ChatMessage;
  onClear: () => void;
}

export function ReplyPreview({ message, onClear }: Props) {
  const senderName = resolveMessageSenderLabel(message.sender_id, message.sender_name);
  const preview = message.content.length > 100 ? message.content.slice(0, 100) + '…' : message.content;

  return (
    <div className="flex items-start gap-2 px-3 pt-2 pb-1 border-t border-border/30 bg-card animate-in slide-in-from-bottom-1 duration-100">
      <div className={cn(
        'flex-1 px-3 py-2 rounded-lg border-l-[3px] border-primary bg-primary/5 min-w-0',
      )}>
        <p className="text-[11px] font-bold text-primary leading-tight truncate">{senderName}</p>
        <p className="text-[12px] text-muted-foreground/70 truncate mt-0.5">{preview}</p>
      </div>
      <button
        onClick={onClear}
        className="h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors shrink-0 mt-0.5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
