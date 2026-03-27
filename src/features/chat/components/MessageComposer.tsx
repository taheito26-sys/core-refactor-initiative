import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { 
  Send, 
  Mic, 
  Smile, 
  Paperclip, 
  Timer, 
  Eye,
  Clock,
  LayoutGrid
} from 'lucide-react';

interface Props {
  onSend: (payload: { content: string; type: 'text' }) => void;
  onTyping: () => void;
  sending: boolean;
  replyTo?: any;
  onCancelReply?: () => void;
}

export function MessageComposer({ onSend, onTyping, sending, replyTo, onCancelReply }: Props) {
  const [content, setContent] = useState('');
  const [showOptions, setShowOptions] = useState(false);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || sending) return;
    onSend({ content: content.trim(), type: 'text' });
    setContent('');
  };

  return (
    <div className="p-3 bg-white space-y-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 group">
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="p-2 text-slate-400 hover:text-blue-600 transition-all" title="Audio Message">
            <Mic size={18} />
          </button>
        </div>

        <div className="flex-1 relative flex items-center bg-slate-50 border border-slate-100 rounded-full px-4 min-h-[40px] transition-all focus-within:border-blue-200 focus-within:bg-white focus-within:shadow-sm">
          <input
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              onTyping();
            }}
            placeholder="Type a message..."
            className="flex-1 bg-transparent border-none focus:outline-none text-[13px] py-1.5 text-slate-700 placeholder:text-slate-400 placeholder:font-medium"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <div className="flex items-center gap-1.5 pr-1 opacity-60 group-focus-within:opacity-100 transition-opacity">
            <button type="button" className="text-slate-400 hover:text-blue-600"><Eye size={16} title="One-time view" /></button>
            <button type="button" className="text-slate-400 hover:text-blue-600"><Clock size={16} title="24h Timer" /></button>
            <button type="button" className="text-slate-400 hover:text-blue-600"><Smile size={16} /></button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
           <button type="button" className="p-2 text-slate-400 hover:text-blue-600">
             <LayoutGrid size={18} />
           </button>
           <button
             type="submit"
             disabled={!content.trim() || sending}
             className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-200 hover:bg-blue-600 transition-all disabled:opacity-50 disabled:shadow-none"
           >
             <Send size={16} className={cn(sending && "animate-pulse")} />
           </button>
        </div>
      </form>
    </div>
  );
}
