import { useState, useRef, useEffect, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useRelationshipMessages, useSendMessage } from '@/hooks/useRelationshipMessages';
import { Send, Smile } from 'lucide-react';

interface Props {
  relationshipId: string;
}

export function ChatTab({ relationshipId }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const { data: messages, isLoading } = useRelationshipMessages(relationshipId);
  const sendMessage = useSendMessage();
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await sendMessage.mutateAsync({ relationship_id: relationshipId, content: text.trim() });
      setText('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err: any) {
      console.error('Send failed:', err);
    }
  }, [text, relationshipId, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Group consecutive messages from same sender
  const groupedMessages = (() => {
    if (!messages?.length) return [];
    const groups: { senderId: string; isOwn: boolean; msgs: typeof messages }[] = [];
    for (const m of messages) {
      const isOwn = m.sender_id === userId;
      const last = groups[groups.length - 1];
      if (last && last.senderId === m.sender_id) {
        last.msgs.push(m);
      } else {
        groups.push({ senderId: m.sender_id, isOwn, msgs: [m] });
      }
    }
    return groups;
  })();

  return (
    <div ref={containerRef} className="flex flex-col h-full" style={{ minHeight: 400, maxHeight: 'calc(100vh - 200px)' }}>
      {/* ── Messages area: flex-1 overflow-y-auto ── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        ) : !messages?.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageCircleIcon className="h-12 w-12 opacity-20" />
            <p className="text-sm font-medium">{t('noMessagesChat')}</p>
            <p className="text-[11px] opacity-60">{t('typeMessageChat')}</p>
          </div>
        ) : (
          <>
            {groupedMessages.map((group, gi) => (
              <div key={gi} className={`flex flex-col ${group.isOwn ? 'items-end' : 'items-start'} gap-[2px] mb-2`}>
                {group.msgs.map((m, mi) => {
                  const isFirst = mi === 0;
                  const isLast = mi === group.msgs.length - 1;
                  const ownRadius = `${isFirst ? '18px' : '4px'} 4px 4px ${isLast ? '18px' : '4px'}`;
                  const otherRadius = `4px ${isFirst ? '18px' : '4px'} ${isLast ? '18px' : '4px'} 4px`;

                  return (
                    <div
                      key={m.id}
                      className={`max-w-[75%] px-3 py-[6px] text-[13px] leading-relaxed ${
                        group.isOwn
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                      style={{
                        borderRadius: group.isOwn ? ownRadius : otherRadius,
                      }}
                    >
                      <div className="break-words whitespace-pre-wrap">{m.content}</div>
                      {isLast && (
                        <div className={`text-[9px] mt-1 flex items-center gap-1 ${
                          group.isOwn ? 'justify-end opacity-70' : 'opacity-50'
                        }`}>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {group.isOwn && <span>{m.read_at ? '✓✓' : '✓'}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── Fixed input bar: always pinned at bottom ── */}
      <div className="shrink-0 border-t border-border/50 bg-background px-3 py-2 flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('typeMessageChat')}
            onKeyDown={handleKeyDown}
            className="w-full bg-muted/50 border border-border/50 rounded-full px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={sendMessage.isPending || !text.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90 transition-all"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MessageCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}