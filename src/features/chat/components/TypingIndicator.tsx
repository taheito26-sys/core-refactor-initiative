/* ═══════════════════════════════════════════════════════════════
   TypingIndicator — animated dots showing who's typing
   ═══════════════════════════════════════════════════════════════ */

interface Props {
  users: string[];
}

export function TypingIndicator({ users }: Props) {
  if (users.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px',
      fontSize: 11, color: 'var(--muted)', fontStyle: 'italic',
    }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5, height: 5, borderRadius: 50,
              background: 'var(--brand)', opacity: 0.6,
              animation: `typing-dot 1.2s ${i * 0.2}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
      <span>typing...</span>
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}
