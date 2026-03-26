import { useState, useEffect } from 'react';
import { Check, CheckCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { ChannelIdentity } from '@/lib/os-store';

export function MessageItem({
  message, isOwn, isFirstInGroup, currentUserId, counterpartyName, onConvert, identitiesById
}: any) {
  
  const [content] = useState(message.content);
  const [vanished, setVanished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);

  const isVoice = content.startsWith('||VOICE||');
  const voiceDuration = isVoice ? content.split(':')[1] || '0:05' : null;
  const isImage = content.startsWith('||IMAGE||');
  const imageUrl = isImage ? content.replace('||IMAGE||', '') : null;
  const isVanish = content.startsWith('||VANISH||');
  const vanishText = isVanish ? content.replace('||VANISH||', '') : null;

  const isRead = !!message.read_at;
  const timeStr = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Validate strict permissions (Feature 15)
  const isCopyable = message.permissions?.copyable !== false;
  const isForwardable = message.permissions?.forwardable !== false;
  const identity = message.sender_identity_id ? (identitiesById?.[message.sender_identity_id] as ChannelIdentity | undefined) : undefined;

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

  // Voice Player rendering skipped for brevity/cleanness here...
  const VoicePlayer = () => <div style={{ fontSize: 13, padding: '4px 8px', background: '#e0e7ff', borderRadius: 4 }}>🎤 Voice Message ({voiceDuration})</div>;

  if (vanished) return null;

  return (
    <div data-msg-id={message.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', position: 'relative', zIndex: 10 }}>
      <div style={{ 
        width: '90%', maxWidth: 700, display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start',
      }}>

        {isFirstInGroup && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1', marginBottom: 4, paddingLeft: 16, paddingRight: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{isOwn ? 'You' : counterpartyName}</span>
            {identity && (
              <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                {identity.provider_type}
              </span>
            )}
          </div>
        )}

        <div style={{
          background: isVanish ? '#faf5ff' : (isOwn ? '#fef4d8' : '#ffffff'),
          border: isVanish ? '1px dashed #d8b4fe' : (isOwn ? '1px solid #fde68a' : '1px solid #e5e7eb'),
          borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', maxWidth: '100%',
          // --- Feature 15 Enforced Here ---
          userSelect: !isCopyable ? 'none' : 'auto',
          WebkitUserSelect: !isCopyable ? 'none' : 'auto',
          filter: !isCopyable ? 'drop-shadow(0 0 2px rgba(239, 68, 68, 0.2))' : 'none'
        }}>
          
          <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', pointerEvents: !isCopyable ? 'none' : 'auto' }}>
            {isVoice ? <VoicePlayer /> : 
             isImage ? <img src={imageUrl!} alt="attachment" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4, pointerEvents: !isCopyable ? 'none' : 'auto' }} /> :
             (
              <div style={{ fontSize: 14, color: isVanish ? '#9333ea' : '#374151', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {isVanish ? vanishText : content}
              </div>
            )}
          </div>

          {/* Context Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
            {!isCopyable && <span title="Restricted Message"><ShieldAlert size={12} style={{ color: '#ef4444' }} /></span>}
            {isVanish ? (
              <span style={{ fontSize: 11, color: '#d8b4fe', fontWeight: 600 }}>{timeLeft}s</span>
            ) : (
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{timeStr}</span>
            )}
            {isOwn && !isVanish && (isRead ? <CheckCheck size={14} style={{ color: '#6366f1' }} /> : <Check size={14} style={{ color: '#9ca3af' }} />)}
          </div>

        </div>

        {/* Feature 15 Hidden Actions & Feature 3 Conversion Actions */}
        <div style={{ minHeight: 16, marginTop: 4, fontSize: 10, color: '#9ca3af', display: 'flex', gap: 8, opacity: isOwn ? 0.5 : 1 }}>
          {!isForwardable && <span>No Forwarding</span>}
          {isForwardable && !isImage && !isVoice && !isVanish && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onConvert?.('task')} style={{ fontSize: 10, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={10} /> Extract Task
              </button>
              <button onClick={() => onConvert?.('order')} style={{ fontSize: 10, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={10} /> Generate Order
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
