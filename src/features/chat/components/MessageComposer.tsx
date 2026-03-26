import { useState } from 'react';

interface Props {
  sending?: boolean;
  onSend: ((payload: { body: string; messageType?: string; bodyJson?: Record<string, unknown> }) => void) | ((content: string) => void);
  onTyping?: (typing: boolean) => void;
  onSchedule?: (body: string, runAt: string) => void;
  replyTo?: any;
  onCancelReply?: () => void;
  onOpenApp?: (app: 'calculator' | 'order') => void;
}

export function MessageComposer({ sending, onSend, onTyping, onSchedule }: Props) {
  const [body, setBody] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');

  const submit = () => {
    const text = body.trim();
    if (!text) return;

    if (scheduleAt && onSchedule) {
      onSchedule(text, scheduleAt);
      setBody('');
      setScheduleAt('');
      onTyping?.(false);
      return;
    }

    if (typeof onSend === 'function' && onSend.length <= 1) {
      // Backward compatible call-site support.
      (onSend as any)({ body: text, messageType: 'text' });
    }
    setBody('');
    onTyping?.(false);
  };

  return (
    <div className="border-t border-border p-3 bg-background/80">
      <div className="flex gap-2 mb-2">
        <input
          type="datetime-local"
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={scheduleAt}
          onChange={(e) => setScheduleAt(e.target.value)}
          title="Schedule message"
        />
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
          className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
