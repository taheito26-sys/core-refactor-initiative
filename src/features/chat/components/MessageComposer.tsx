import { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Send, Mic, Smile, Zap, Command, X, StopCircle, Package } from 'lucide-react';

interface Props {
  onSend: (payload: { content: string; type: string; bodyJson?: any }) => void;
  onTyping: () => void;
  sending: boolean;
  compact?: boolean;
}

const COMMANDS = [
  { key: '/order', label: 'Create Order', icon: Zap, desc: 'Quickly draft a new trade' },
  { key: '/stock', label: 'Check Stock', icon: Package, desc: 'View current inventory levels' },
  { key: '/pnl', label: 'Share P&L', icon: Command, desc: 'Post current session performance' },
];

export function MessageComposer({ onSend, onTyping, sending, compact }: Props) {
  const [content, setContent] = useState('');
  const [showCommands, setShowCommands] = useState(false);

  const handleCommand = (cmd: string) => {
    if (cmd === '/order') {
      onSend({ content: '||SYS_ACTION||create_order||/SYS_ACTION||', type: 'text' });
    } else if (cmd === '/stock') {
      onSend({ content: '||SYS_ACTION||check_stock||/SYS_ACTION||', type: 'text' });
    } else if (cmd === '/pnl') {
      onSend({ content: '||AI_SUMMARY|| Current Session ROI: +2.4% | Volume: 45k USDT', type: 'text' });
    }
    setContent('');
    setShowCommands(false);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || sending) return;
    if (content.startsWith('/')) {
      const match = COMMANDS.find(c => content.startsWith(c.key));
      if (match) { handleCommand(match.key); return; }
    }
    onSend({ content: content.trim(), type: 'text' });
    setContent('');
  };

  return (
    <div className={cn("bg-background p-3 border-t border-border relative")}>
      {showCommands && (
        <div className="absolute bottom-full left-4 mb-2 w-64 bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2">
          <div className="p-2 bg-muted/50 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Available Protocols</div>
          {COMMANDS.map(cmd => (
            <button 
              key={cmd.key}
              onClick={() => handleCommand(cmd.key)}
              className="w-full flex items-center gap-3 p-3 hover:bg-accent text-left transition-colors"
            >
              <cmd.icon size={16} className="text-primary" />
              <div>
                <div className="text-xs font-bold">{cmd.key}</div>
                <div className="text-[10px] text-muted-foreground">{cmd.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1 relative flex items-center bg-muted rounded-2xl px-4 min-h-[44px]">
          <input
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setShowCommands(e.target.value === '/');
              onTyping();
            }}
            placeholder="Type a message or / for protocols..."
            className="flex-1 bg-transparent border-none focus:outline-none text-sm py-3"
          />
        </div>
        <button
          type="submit"
          disabled={!content.trim() || sending}
          className="w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-105 transition-all"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}