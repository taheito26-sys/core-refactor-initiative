import { useState } from 'react';
import { Sparkles, Pocket, Flame, SendHorizontal } from 'lucide-react';

interface Props {
  sending?: boolean;
  onSend: ((payload: { body: string; messageType?: string; bodyJson?: Record<string, unknown> }) => void) | ((content: string) => void);
  onTyping?: (typing: boolean) => void;
  onSchedule?: (body: string, runAt: string) => void;
  replyTo?: any;
  onCancelReply?: () => void;
  onOpenApp?: (app: 'calculator' | 'order') => void;
}

export function MessageComposer({ sending, onSend, onTyping, onSchedule, onOpenApp }: Props) {
  const [body, setBody] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [isVanish, setIsVanish] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const generateAIDraft = () => {
    setAiLoading(true);
    setTimeout(() => {
      setBody(prev => prev + " [AI Suggestion: Proceed with the Alpha deal at current USDT rates.]");
      setAiLoading(false);
    }, 800);
  };

  const submit = () => {
    const rawText = body.trim();
    if (!rawText) return;

    const text = isVanish ? `||VANISH||${rawText}` : rawText;

    if (scheduleAt && onSchedule) {
      onSchedule(text, scheduleAt);
      setBody('');
      setScheduleAt('');
      onTyping?.(false);
      return;
    }

    if (typeof onSend === 'function') {
      (onSend as any)({ body: text, message_type: 'text' });
    }
    setBody('');
    setIsVanish(false);
    onTyping?.(false);
  };

  return (
    <div className="border-t border-border p-3 bg-background/80">
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-2">
          <input
            type="datetime-local"
            className="rounded-md border border-input bg-background px-2 py-1 text-[10px] h-7"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            title="Schedule message"
          />
          <button 
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border transition ${isVanish ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-background hover:bg-accent'}`}
            onClick={() => setIsVanish(!isVanish)}
          >
            <Flame size={12} className={isVanish ? 'animate-pulse' : ''} />
            VANISH {isVanish ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
          <span>{body.length} CH</span>
          {scheduleAt && <span className="text-primary tracking-widest animate-pulse">SCHEDULED</span>}
        </div>
      </div>
      
      <div className="flex items-center gap-2 mb-3">
        <button 
          onClick={generateAIDraft}
          disabled={aiLoading}
          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-[10px] font-bold hover:bg-indigo-100 transition shadow-sm"
        >
          <Sparkles size={12} className={aiLoading ? 'animate-spin' : ''} />
          {aiLoading ? 'Thinking...' : 'AI Assist'}
        </button>
        <button 
          onClick={() => onOpenApp?.('calculator')}
          className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-bold hover:bg-amber-100 transition shadow-sm"
        >
          <Pocket size={12} />
          Mini App
        </button>
      </div>
      <div className="flex gap-2">
        <textarea
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[42px] max-h-28"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            onTyping?.(e.target.value.trim().length > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type message"
        />
        <button
          disabled={sending || !body.trim()}
          onClick={submit}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50 flex items-center gap-2 font-bold shadow-lg"
        >
          <SendHorizontal size={16} />
          SEND
        </button>
      </div>
    </div>
  );
}
