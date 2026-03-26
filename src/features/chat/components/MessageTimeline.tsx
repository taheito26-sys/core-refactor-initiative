import { useEffect, useRef, useMemo } from 'react';
import { MessageItem } from './MessageItem';
import { OsMessage, OsBusinessObject } from '@/lib/os-store';
import { FileText, Lock, CheckCircle } from 'lucide-react';

interface Props {
  messages: (OsMessage | OsBusinessObject)[];
  currentUserId: string;
  counterpartyName: string;
  scrollRef: (el: HTMLDivElement | null) => void;
  onAcceptDeal?: (id: string) => void;
  onConvertMessage?: (id: string, type: 'task' | 'order') => void;
  onReply: (msg: OsMessage) => void;
}

function BusinessObjectCard({ obj, onAccept }: { obj: OsBusinessObject, onAccept: () => void }) {
  const isLocked = obj.status === 'locked';

  return (
    <div style={{
      width: '90%', maxWidth: 700, margin: '0 auto', padding: 20, borderRadius: 12,
      background: isLocked ? '#f0fdf4' : '#ffffff',
      border: isLocked ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
      boxShadow: '0 2px 4px rgba(0,0,0,0.02)', display: 'flex', gap: 16
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, background: isLocked ? '#22c55e' : '#6366f1', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        {isLocked ? <Lock size={20} /> : <FileText size={20} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 16, color: '#111827' }}>{obj.object_type.toUpperCase().replace('_', ' ')}</strong>
          <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 600, padding: '2px 8px', background: '#e5e7eb', borderRadius: 4 }}>
            {obj.status.toUpperCase()}
          </span>
        </div>
        
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px dashed #cbd5e1', fontFamily: 'monospace' }}>
          {JSON.stringify(obj.payload, null, 2)}
        </div>

        {isLocked && obj.state_snapshot_hash && (
          <div style={{ fontSize: 11, color: '#16a34a', marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <CheckCircle size={14} /> IMMUTABLE CONVERSATION SNAPSHOT: {obj.state_snapshot_hash}
          </div>
        )}

        {!isLocked && obj.object_type === 'deal_offer' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={onAccept} style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Sign Agreement</button>
            <button style={{ background: '#fff', color: '#ef4444', border: '1px solid #ef4444', padding: '8px 24px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Decline</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageTimeline({
  messages, currentUserId, counterpartyName, scrollRef, onAcceptDeal, onConvertMessage, onReply
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => {
    const groups: { date: string; msgs: (OsMessage | OsBusinessObject)[] }[] = [];
    let lastDate = '';

    for (const msg of messages) {
      const d = new Date(msg.created_at);
      let dateStr = d.toLocaleDateString();
      const today = new Date();
      if (d.toDateString() === today.toDateString()) {
        dateStr = 'Today';
      } else {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) {
          dateStr = 'Yesterday';
        }
      }
      if (dateStr !== lastDate) {
        groups.push({ date: dateStr, msgs: [] });
        lastDate = dateStr;
      }
      groups[groups.length - 1].msgs.push(msg);
    }
    return groups;
  }, [messages]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={(el) => {
        // @ts-ignore
        containerRef.current = el;
        scrollRef(el);
      }}
      style={{
        flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16,
        background: '#f8f9fe',
      }}
    >
      {grouped.map((g) => (
        <div key={g.date} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20 }}>
              {g.date}
            </span>
          </div>

          {g.msgs.map((item, i) => {
            if (item.type === 'business_object') {
              return <BusinessObjectCard key={item.id} obj={item as OsBusinessObject} onAccept={() => onAcceptDeal?.(item.id)} />;
            }

            const msg = item as OsMessage;
            const isOwn = msg.sender_id === currentUserId;
            
            const prev = i > 0 && g.msgs[i-1].type === 'message' ? g.msgs[i - 1] as OsMessage : null;
            const next = i < g.msgs.length - 1 && g.msgs[i+1].type === 'message' ? g.msgs[i + 1] as OsMessage : null;
            const isFirstInGroup = !prev || prev.sender_id !== msg.sender_id;
            const isLastInGroup = !next || next.sender_id !== msg.sender_id;

            return (
              <MessageItem
                key={msg.id} message={msg} isOwn={isOwn} isFirstInGroup={isFirstInGroup} isLastInGroup={isLastInGroup}
                currentUserId={currentUserId} counterpartyName={counterpartyName} isHighlighted={false}
                onReply={onReply} onConvert={(type:any) => onConvertMessage?.(msg.id, type)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
