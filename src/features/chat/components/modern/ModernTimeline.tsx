import { useEffect, useRef, useState } from 'react';
import { Flame, ShieldAlert, FileText, CheckCircle, RefreshCw, Lock } from 'lucide-react';
import { OsMessage, OsBusinessObject, ChannelIdentity } from '@/lib/os-store';

interface Props {
  messages: (OsMessage | OsBusinessObject)[];
  currentUserId: string;
  counterpartyName: string;
  onAcceptDeal?: (id: string) => void;
  onConvertMessage?: (id: string, type: 'task' | 'order') => void;
  identitiesById?: Record<string, ChannelIdentity>;
}

export function ModernTimeline({ messages, currentUserId, counterpartyName, onAcceptDeal, onConvertMessage, identitiesById }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, overflowY: 'auto', padding: '32px 0', display: 'flex', flexDirection: 'column',
        background: '#ffffff',
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {messages.map((item, i) => {
          
          if (item.type === 'business_object') {
            return (
              <BusinessObjectCard 
                key={item.id} 
                obj={item as OsBusinessObject} 
                onAccept={() => onAcceptDeal?.(item.id)}
              />
            );
          }

          const msg = item as OsMessage;
          const isOwn = msg.sender_id === currentUserId;
          const prev = i > 0 && messages[i - 1].type === 'message' ? messages[i - 1] as OsMessage : null;
          const isFirstInGroup = !prev || prev.sender_id !== msg.sender_id;

          return (
            <ModernMessageItem
              key={msg.id}
              message={msg}
              isOwn={isOwn}
              isFirstInGroup={isFirstInGroup}
              counterpartyName={counterpartyName}
              identitiesById={identitiesById}
              onConvert={(type: any) => onConvertMessage?.(msg.id, type)}
            />
          );
        })}
      </div>
    </div>
  );
}

// Feature 11: Dual Timeline & Feature 18: Snapshots
function BusinessObjectCard({ obj, onAccept }: { obj: OsBusinessObject, onAccept: () => void }) {
  const isLocked = obj.status === 'locked';

  return (
    <div style={{
      margin: '0 24px', padding: 20, borderRadius: 12,
      background: isLocked ? '#f0fdf4' : '#f8fafc',
      border: isLocked ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
      display: 'flex', gap: 16, alignItems: 'flex-start',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 8, background: isLocked ? '#22c55e' : '#3b82f6', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {isLocked ? <Lock size={20} /> : <FileText size={20} />}
      </div>
      
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 15, color: '#0f172a' }}>
            {obj.object_type.toUpperCase().replace('_', ' ')}
          </strong>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, padding: '2px 8px', background: '#e2e8f0', borderRadius: 12 }}>
            {obj.status.toUpperCase()}
          </span>
        </div>
        
        <div style={{ fontSize: 13, color: '#475569', marginTop: 8, fontFamily: 'monospace', background: '#e2e8f0', padding: 8, borderRadius: 4 }}>
          {JSON.stringify(obj.payload)}
        </div>

        {isLocked && obj.state_snapshot_hash && (
          <div style={{ fontSize: 10, color: '#16a34a', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle size={12} />
            IMMUTABLE SNAPSHOT: {obj.state_snapshot_hash}
          </div>
        )}

        {!isLocked && obj.object_type === 'deal_offer' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button 
              onClick={onAccept}
              style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Sign & Accept
            </button>
            <button style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModernMessageItem({ message, isOwn, isFirstInGroup, counterpartyName, onConvert, identitiesById }: any) {
  const [content] = useState(message.content);
  const [vanished, setVanished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);

  const isCopyable = message.permissions?.copyable !== false;
  const isForwardable = message.permissions?.forwardable !== false;

  const isVoice = content.startsWith('||VOICE||');
  const isImage = content.startsWith('||IMAGE||');
  const isVanish = content.startsWith('||VANISH||');

  const timeStr = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    if (isVanish && !vanished) {
      const interval = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) { clearInterval(interval); setVanished(true); return 0; }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isVanish, vanished]);

  const getAvatarColor = (name: string) => {
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = ['#10b981', '#3b82f6', '#ec4899', '#f59e0b', '#8b5cf6'];
    return colors[hash % colors.length];
  };

  const senderName = isOwn ? 'You' : counterpartyName;
  const avatarColor = getAvatarColor(senderName);
  
  // Feature 7: Identity Stitching
  const identity = message.sender_identity_id ? identitiesById?.[message.sender_identity_id] : null;

  if (vanished) return null;

  return (
    <div style={{ display: 'flex', gap: 16, padding: '0 24px', width: '100%', marginTop: !isFirstInGroup ? -16 : 0, position: 'relative' }}>
      <div style={{ width: 40, flexShrink: 0 }}>
        {isFirstInGroup && (
          <div style={{
            width: 40, height: 40, borderRadius: 8, background: avatarColor, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700
          }}>
            {senderName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingTop: isFirstInGroup ? 0 : 4 }}>
        {isFirstInGroup && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{senderName}</span>
            {identity && (
              <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                {identity.provider_type}
              </span>
            )}
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{timeStr}</span>
            {!isCopyable && <span title="Restricted Message"><ShieldAlert size={12} style={{ color: '#ef4444' }} /></span>}
          </div>
        )}

        <div style={{ 
          fontSize: 15, color: '#334155', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          background: isVanish ? '#faf5ff' : 'transparent',
          border: isVanish ? '1px dashed #d8b4fe' : 'none',
          padding: isVanish ? '8px 12px' : 0, borderRadius: 8,
          display: 'inline-block',
          userSelect: !isCopyable ? 'none' : 'auto',
          WebkitUserSelect: !isCopyable ? 'none' : 'auto',
          filter: !isCopyable ? 'drop-shadow(0 0 2px rgba(239, 68, 68, 0.2))' : 'none'
        }}>
          {isVoice ? <div style={{ color: '#3b82f6', fontWeight: 600 }}>🎤 Voice Message Track</div> : 
           isImage ? <img src={content.replace('||IMAGE||', '')} alt="attachment" style={{ maxWidth: 400, borderRadius: 8, border: '1px solid #e2e8f0', pointerEvents: !isCopyable ? 'none' : 'auto' }} /> :
           (
            <>
              <div style={{ pointerEvents: !isCopyable ? 'none' : 'auto' }}>
                {isVanish ? content.replace('||VANISH||', '') : content}
              </div>
              {isVanish && <span style={{ marginLeft: 8, fontSize: 11, color: '#d8b4fe', fontWeight: 700 }}><Flame size={12} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {timeLeft}s</span>}
            </>
          )}
        </div>
        
        {/* Feature 3: Actions row appended softly below the message like Slack attachments */}
        <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center', opacity: (!isOwn && isForwardable) ? 1 : 0.5 }}>
          {!isForwardable && <span style={{ fontSize: 10, color: '#9ca3af' }}>No Forwarding</span>}
          
          {/* Action Convert Hooks */}
          {isForwardable && !isImage && !isVoice && !isVanish && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onConvert('task')} style={{ fontSize: 11, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={10} /> Extract Task
              </button>
              <button onClick={() => onConvert('order')} style={{ fontSize: 11, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={10} /> Generate Order
              </button>
            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}
