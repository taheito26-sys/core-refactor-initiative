/* ═══════════════════════════════════════════════════════════════
   UnreadDivider — visual separator showing unread message count
   ═══════════════════════════════════════════════════════════════ */

interface Props {
  count: number;
}

export function UnreadDivider({ count }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px', margin: '4px 0',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--brand)', opacity: 0.3 }} />
      <span style={{
        fontSize: 10, fontWeight: 700, color: 'var(--brand)',
        background: 'color-mix(in srgb, var(--brand) 10%, transparent)',
        padding: '2px 10px', borderRadius: 10, whiteSpace: 'nowrap',
      }}>
        ↑ {count} unread message{count !== 1 ? 's' : ''}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--brand)', opacity: 0.3 }} />
    </div>
  );
}
