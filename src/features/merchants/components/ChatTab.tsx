import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useRelationshipMessages, useSendMessage } from '@/hooks/useRelationshipMessages';
import { Send, MessageCircle } from 'lucide-react';

interface Props {
  relationshipId: string;
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function ChatTab({ relationshipId }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const { data: messages, isLoading } = useRelationshipMessages(relationshipId);
  const sendMessage = useSendMessage();
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await sendMessage.mutateAsync({ relationship_id: relationshipId, content: text.trim() });
      setText('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
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

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  // Group by date
  const groupedByDate = useMemo(() => {
    if (!messages?.length) return [];
    const groups: { date: string; messages: typeof messages }[] = [];
    for (const m of messages) {
      const dateKey = new Date(m.created_at).toDateString();
      const last = groups[groups.length - 1];
      if (last && last.date === dateKey) {
        last.messages.push(m);
      } else {
        groups.push({ date: dateKey, messages: [m] });
      }
    }
    return groups;
  }, [messages]);

  return (
    <div className="chat-drawer-container">
      {/* ── Messages area ── */}
      <div className="chat-drawer-messages">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        ) : !messages?.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-12">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageCircle className="h-7 w-7 text-primary/40" />
            </div>
            <p className="text-sm font-medium">{t('noMessagesChat') || 'No messages yet'}</p>
            <p className="text-[11px] opacity-60">{t('typeMessageChat') || 'Send a message to start chatting'}</p>
          </div>
        ) : (
          <>
            {groupedByDate.map((group) => (
              <div key={group.date}>
                <div className="chat-date-separator">
                  <span>{dateSeparator(group.messages[0].created_at)}</span>
                </div>
                {group.messages.map((m, idx) => {
                  const isOwn = m.sender_id === userId;
                  const prev = idx > 0 ? group.messages[idx - 1] : null;
                  const next = idx < group.messages.length - 1 ? group.messages[idx + 1] : null;
                  const isFirst = prev?.sender_id !== m.sender_id;
                  const isLast = next?.sender_id !== m.sender_id;

                  return (
                    <div
                      key={m.id}
                      className={`chat-bubble-row ${isOwn ? 'own' : 'other'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}`}
                      style={{ marginTop: isFirst ? 8 : 1 }}
                    >
                      <div className={`chat-bubble ${isOwn ? 'own' : 'other'}`}>
                        <div className="chat-bubble-content">{m.content}</div>
                        <div className="chat-bubble-meta">
                          <span>{formatMessageTime(m.created_at)}</span>
                          {isOwn && (
                            <span className="chat-read-status">
                              {m.read_at ? (
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/><path d="M14.07 0.65L7.98 6.73L6.78 5.53L5.37 6.94L7.98 9.55L15.48 2.05L14.07 0.65Z" fill="currentColor"/></svg>
                              ) : (
                                <svg width="11" height="11" viewBox="0 0 16 11" fill="none"><path d="M11.07 0.65L4.98 6.73L1.68 3.43L0.27 4.84L4.98 9.55L12.48 2.05L11.07 0.65Z" fill="currentColor"/></svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="chat-messenger-input">
        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={t('typeMessageChat') || 'Type a message...'}
            rows={1}
            className="chat-input-field"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={sendMessage.isPending || !text.trim()}
          className="chat-send-btn"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
