/* ═══════════════════════════════════════════════════════════════
   JumpToLatestButton — floating scroll-to-bottom with unread badge
   ═══════════════════════════════════════════════════════════════ */

import { ChevronDown } from 'lucide-react';

interface Props {
  unreadCount?: number;
  onClick: () => void;
}

export function JumpToLatestButton({ unreadCount = 0, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute', bottom: 12, right: 16,
        width: 36, height: 36, borderRadius: 50,
        background: 'var(--panel2)', border: '1px solid var(--line)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: 5,
        color: 'var(--muted)', transition: 'all 0.12s',
      }}
    >
      <ChevronDown size={18} />
      {unreadCount > 0 && (
        <span style={{
          position: 'absolute', top: -6, right: -6,
          background: 'var(--brand)', color: '#fff', borderRadius: 50,
          fontSize: 9, fontWeight: 800, minWidth: 16, height: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
        }}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
