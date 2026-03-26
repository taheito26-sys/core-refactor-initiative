import { MessageSquare, Users, Search, RefreshCw, MoreVertical, Phone, LayoutTemplate } from 'lucide-react';

interface Props {
  name: string;
  nickname: string;
  onBack: () => void;
  onSearchToggle: () => void;
  onCallClick?: () => void;
  onToggleLayout?: () => void;
  isMobile?: boolean;
}

export function ConversationHeader({ name, nickname, onBack, onSearchToggle, onCallClick, onToggleLayout, isMobile }: Props) {
  const getAvatarColor = (name: string) => {
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = ['#059669', '#2563eb', '#db2777', '#d97706', '#7c3aed'];
    return colors[hash % colors.length];
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
      borderBottom: '1px solid #e5e7eb', flexShrink: 0,
      background: '#ffffff',
    }}>
      {/* Avatar */}
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: getAvatarColor(name), color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700,
      }}>
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Name + status */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Merchant conversation
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: '#9ca3af' }}>
        
        <button 
          onClick={onToggleLayout}
          style={{ 
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
            color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
          title="Switch to Modern UI"
        >
          <LayoutTemplate size={16} />
          <span>Switch to Modern</span>
        </button>

        <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <MessageSquare size={18} />
        </button>
        <button onClick={onCallClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Phone size={18} />
        </button>
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Users size={18} />
        </button>
        <button onClick={onSearchToggle} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Search size={18} />
        </button>
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <RefreshCw size={18} />
        </button>
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <MoreVertical size={18} />
        </button>
      </div>
    </div>
  );
}
