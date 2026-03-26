import { Hash, Lock, Settings, Search, Edit } from 'lucide-react';
import { OsRoom, InboxLane } from '@/lib/os-store';

interface Props {
  conversations: OsRoom[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
}

export function ModernSidebar({ conversations, activeRoomId, onSelectRoom }: Props) {
  // Feature 5: Split Inbox Architecture
  const grouped = conversations.reduce((acc, room) => {
    if (!acc[room.lane]) acc[room.lane] = [];
    acc[room.lane].push(room);
    return acc;
  }, {} as Record<InboxLane, OsRoom[]>);

  const lanes = Object.keys(grouped) as InboxLane[];

  return (
    <div style={{ width: 280, background: '#0f172a', display: 'flex', flexDirection: 'column', color: '#f8fafc', flexShrink: 0 }}>
      {/* Workspace Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>P2P Global</h1>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Connected
          </div>
        </div>
        <button style={{ background: '#1e293b', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Edit size={16} />
        </button>
      </div>

      <div style={{ padding: '16px 24px', position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 40, top: 26, color: '#64748b' }} />
        <input 
          type="text" 
          placeholder="Jump to..." 
          style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px 8px 36px', color: '#f8fafc', fontSize: 13, outline: 'none' }} 
        />
      </div>

      {/* Lanes */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
        {lanes.map((lane) => (
          <div key={lane} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 8, color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              <span>{lane}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {grouped[lane].map(room => {
                const isSecure = room.security_policies.disable_export || room.security_policies.disable_forwarding;
                return (
                  <button 
                    key={room.id}
                    onClick={() => onSelectRoom(room.id)}
                    style={{ 
                      width: '100%', background: room.id === activeRoomId ? '#1e293b' : 'transparent',
                      border: 'none', padding: '8px 12px', borderRadius: 6, color: room.id === activeRoomId ? '#fff' : '#cbd5e1',
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left',
                      fontWeight: room.id === activeRoomId ? 600 : 500
                    }}
                  >
                    {isSecure ? <Lock size={15} style={{ color: '#f59e0b', opacity: 0.8 }} /> : <Hash size={15} style={{ opacity: 0.6 }} />}
                    <span style={{ fontSize: 15, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</span>
                    {/* Unread badge mock logic */}
                    {room.lane === 'Customers' && <span style={{ background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12 }}>3</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 16 }}>
        <img src="https://ui-avatars.com/api/?name=Admin&background=0D8ABC&color=fff" alt="Profile" style={{ width: 36, height: 36, borderRadius: 8 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>Admin</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Operations</div>
        </div>
        <button style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><Settings size={18} /></button>
      </div>
    </div>
  );
}
