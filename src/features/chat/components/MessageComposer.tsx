import { useState, useMemo } from 'react';
import { Sparkles, Pocket, Flame, SendHorizontal, X, User } from 'lucide-react';
import { encodeReply } from '@/features/chat/lib/message-codec';

interface Props {
  sending?: boolean;
  onSend: (payload: { body: string; messageType?: string; bodyJson?: Record<string, unknown> }) => void;
  onTyping?: (typing: boolean) => void;
  onSchedule?: (body: string, runAt: string) => void;
  replyTo?: any;
  onCancelReply?: () => void;
  onOpenApp?: (app: 'calculator' | 'order') => void;
}

export function MessageComposer({ sending, onSend, onTyping, onSchedule, onOpenApp, replyTo, onCancelReply }: Props) {
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

    let text = isVanish ? `||VANISH||${rawText}` : rawText;

    if (replyTo) {
      const replyPreview = replyTo.body ? replyTo.body.slice(0, 60) : 'Media';
      text = encodeReply(replyTo.id, replyTo.sender_id || 'Merchant', replyPreview, text);
      onCancelReply?.();
    }

    if (scheduleAt && onSchedule) {
      onSchedule(text, scheduleAt);
      setBody('');
      setScheduleAt('');
      onTyping?.(false);
      return;
    }

    onSend({ body: text, messageType: 'text' });
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
      
      {replyTo && (
        <div className="mx-3 -mt-12 mb-2 p-2 bg-accent/20 border border-border rounded-lg flex items-center gap-3 animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-primary flex items-center gap-1 uppercase">
              <User size={10} /> Replying to merchant
            </p>
            <p className="text-xs truncate opacity-70 italic line-clamp-1">{replyTo.body || 'Media message'}</p>
          </div>
          <button onClick={onCancelReply} className="p-1 hover:bg-accent rounded-full transition">
            <X size={14} />
          </button>
        </div>
      )}

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
        <button 
          onClick={() => setBody(prev => prev + '@')}
          className="flex items-center gap-1.5 px-3 py-1 bg-sky-50 text-sky-700 border border-sky-100 rounded-full text-[10px] font-bold hover:bg-sky-100 transition shadow-sm"
        >
          @ Mention
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
