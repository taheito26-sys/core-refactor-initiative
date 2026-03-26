import { Search, ChevronDown, Lock, Users } from 'lucide-react';
import { OsRoom, InboxLane } from '@/lib/os-store';

interface Props {
  conversations: OsRoom[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  unreadCounts?: Record<string, number>;
}

export function ConversationSidebar({ conversations, activeRoomId, onSelectRoom, unreadCounts = {} }: Props) {
  // Feature 5: Split Inbox Architecture
  const grouped = conversations.reduce((acc, room) => {
    if (!acc[room.lane]) acc[room.lane] = [];
    acc[room.lane].push(room);
    return acc;
  }, {} as Record<InboxLane, OsRoom[]>);

  const lanes = Object.keys(grouped) as InboxLane[];

  return (
    <div style={{ width: 320, background: '#ffffff', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '0 0 16px' }}>Inbox</h1>
        
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: 10, color: '#94a3b8' }} />
          <input 
            type="text" 
            placeholder="Search messages, users..." 
            style={{ width: '100%', padding: '10px 12px 10px 38px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'all 0.2s', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)' }}
          />
        </div>
      </div>

      {/* Inbox Lanes List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {lanes.map(lane => (
          <div key={lane} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lane}</span>
              <ChevronDown size={14} color="#94a3b8" />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {grouped[lane].map(room => {
                const isSecure = room.security_policies.disable_export || room.security_policies.watermark;
                const unread = unreadCounts[room.id] || 0;
                
                return (
                  <button 
                    key={room.id}
                    onClick={() => onSelectRoom(room.id)}
                    style={{ 
                      width: '100%', background: room.id === activeRoomId ? '#f1f5f9' : 'transparent', 
                      border: 'none', padding: '12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.2s',
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: isSecure ? '#fef3c7' : '#e0e7ff', color: isSecure ? '#d97706' : '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isSecure ? <Lock size={18} /> : <Users size={18} />}
                    </div>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: room.id === activeRoomId ? 700 : 600, color: room.id === activeRoomId ? '#0f172a' : '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {room.name}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isSecure ? 'Classified discussion' : 'Last message snippet...'}
                      </div>
                    </div>
                    {unread > 0 && (
                      <div style={{ minWidth: 18, height: 18, borderRadius: 12, background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
