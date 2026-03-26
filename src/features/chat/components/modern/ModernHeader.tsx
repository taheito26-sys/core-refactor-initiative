import { LayoutTemplate, Phone, Video, Info } from 'lucide-react';

interface Props {
  name: string;
  onCallClick: () => void;
  onToggleLayout: () => void;
}

export function ModernHeader({ name, onCallClick, onToggleLayout }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
      padding: '14px 24px', borderBottom: '1px solid #e2e8f0', 
      background: '#ffffff', flexShrink: 0,
    }}>
      {/* Name + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>
          {name}
        </h3>
        <span style={{ 
          background: '#dcfce7', color: '#ca8a04', fontSize: 10, fontWeight: 700, 
          padding: '2px 8px', borderRadius: 12 
        }}>
          Merchant
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: '#64748b' }}>
        
        <button 
          onClick={onToggleLayout}
          style={{ 
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
            color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
          title="Switch back to Classic UI"
        >
          <LayoutTemplate size={16} />
          <span>Switch to Classic</span>
        </button>

        <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

        <button onClick={onCallClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Phone size={18} />
        </button>
        <button onClick={onCallClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Video size={20} />
        </button>
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
          <Info size={20} />
        </button>
      </div>
    </div>
  );
}
