import { useState } from 'react';
import { format } from 'date-fns';
import { Search, ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminUsers } from '../hooks/useAdminUsers';

interface Props {
  onOpenWorkspace: (userId: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  approved: '#22c55e',
  pending:  '#eab308',
  rejected: '#ef4444',
};

export function AdminUserDirectory({ onOpenWorkspace }: Props) {
  const [search, setSearch] = useState('');
  const { data: users, isLoading } = useAdminUsers(search);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Search ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          position: 'relative', flex: 1, maxWidth: 340,
        }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--muted)' }} />
          <input
            placeholder="Search email, merchant ID, name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '7px 10px 7px 30px',
              fontSize: 12, color: 'var(--fg)',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {users?.length != null && (
          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </span>
        )}
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : !users?.length ? (
        <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 12, color: 'var(--muted)' }}>
          No users found.
        </div>
      ) : (
        <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Email','Name','Merchant ID','Status','Registered','Deals','Profit',''].map((h, i) => (
                  <th key={i} style={{
                    padding: '8px 12px', textAlign: i >= 5 ? 'right' : 'left',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                    textTransform: 'uppercase', color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr
                  key={u.user_id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{u.display_name ?? '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--mono, monospace)', color: 'var(--muted)', fontSize: 11 }}>{u.merchant_id ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[u.status] ?? 'var(--muted)', flexShrink: 0 }} />
                      <span style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{u.status}</span>
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {format(new Date(u.created_at), 'MMM d, yyyy')}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--mono, monospace)' }}>{u.deal_count}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--mono, monospace)' }}>
                    {u.total_profit > 0 ? u.total_profit.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      onClick={() => onOpenWorkspace(u.user_id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', fontSize: 11, fontWeight: 500,
                        color: '#818cf8',
                        background: 'rgba(99,102,241,0.1)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: 6, cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.18)')}
                      onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.1)')}
                    >
                      <ArrowUpRight style={{ width: 11, height: 11 }} />
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
