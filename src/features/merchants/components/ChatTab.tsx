import { useState, useRef, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useRelationshipMessages, useSendMessage } from '@/hooks/useRelationshipMessages';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
}

export function ChatTab({ relationshipId }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const { data: messages, isLoading } = useRelationshipMessages(relationshipId);
  const sendMessage = useSendMessage();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim()) return;
    try {
      await sendMessage.mutateAsync({ relationship_id: relationshipId, content: text.trim() });
      setText('');
    } catch (err: any) {
      console.error('Send failed:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {isLoading ? (
          <div className="empty"><div className="empty-t">{t('loading') || '...'}</div></div>
        ) : !messages?.length ? (
          <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty-t">{t('noMessagesChat')}</div>
          </div>
        ) : (
          messages.map(m => {
            const isOwn = m.sender_id === userId;
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: isOwn ? 'flex-end' : 'flex-start',
                  padding: '0 8px',
                }}
              >
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: isOwn ? 'var(--brand3)' : 'var(--panel2)',
                    border: isOwn ? '1px solid var(--brand)' : '1px solid var(--line)',
                    fontSize: 11,
                  }}
                >
                  <div>{m.content}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, textAlign: isOwn ? 'right' : 'left' }}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {m.read_at && ' ✓✓'}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '8px 0',
        borderTop: '1px solid var(--line)',
      }}>
        <div className="inputBox" style={{ flex: 1, padding: '6px 10px' }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('typeMessageChat')}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
        </div>
        <button className="btn" onClick={handleSend} disabled={sendMessage.isPending || !text.trim()}>
          {t('sendMessage')}
        </button>
      </div>
    </div>
  );
}