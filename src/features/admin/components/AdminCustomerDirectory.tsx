import { useState } from 'react';
import { format } from 'date-fns';
import { Search, ArrowUpRight, Users, ShoppingCart, MessageCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AdminCustomerRow {
  user_id: string;
  email: string;
  display_name: string;
  phone: string | null;
  region: string | null;
  status: string;
  preferred_currency: string;
  created_at: string;
  connection_count: number;
  order_count: number;
  message_count: number;
}

function useAdminCustomers(search: string) {
  return useQuery({
    queryKey: ['admin-customers', search],
    queryFn: async (): Promise<AdminCustomerRow[]> => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email, status, created_at')
        .eq('role', 'customer');

      const customerUserIds = (profiles ?? []).map(p => p.user_id);
      if (!customerUserIds.length) return [];

      const { data: customerProfiles } = await supabase
        .from('customer_profiles')
        .select('*')
        .in('user_id', customerUserIds);

      const { data: connections } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id')
        .in('customer_user_id', customerUserIds);

      const { data: orders } = await supabase
        .from('customer_orders')
        .select('customer_user_id')
        .in('customer_user_id', customerUserIds);

      const { data: messages } = await supabase
        .from('customer_messages')
        .select('sender_user_id')
        .in('sender_user_id', customerUserIds);

      const cpMap = new Map((customerProfiles ?? []).map(c => [c.user_id, c]));
      const connCounts = new Map<string, number>();
      (connections ?? []).forEach(c => connCounts.set(c.customer_user_id, (connCounts.get(c.customer_user_id) ?? 0) + 1));
      const orderCounts = new Map<string, number>();
      (orders ?? []).forEach(o => orderCounts.set(o.customer_user_id, (orderCounts.get(o.customer_user_id) ?? 0) + 1));
      const msgCounts = new Map<string, number>();
      (messages ?? []).forEach(m => msgCounts.set(m.sender_user_id, (msgCounts.get(m.sender_user_id) ?? 0) + 1));

      let rows: AdminCustomerRow[] = (profiles ?? []).map(p => {
        const cp = cpMap.get(p.user_id);
        return {
          user_id: p.user_id,
          email: p.email,
          display_name: cp?.display_name ?? '—',
          phone: cp?.phone ?? null,
          region: cp?.region ?? null,
          status: cp?.status ?? p.status,
          preferred_currency: cp?.preferred_currency ?? 'USDT',
          created_at: p.created_at,
          connection_count: connCounts.get(p.user_id) ?? 0,
          order_count: orderCounts.get(p.user_id) ?? 0,
          message_count: msgCounts.get(p.user_id) ?? 0,
        };
      });

      if (search.trim()) {
        const q = search.toLowerCase();
        rows = rows.filter(r =>
          r.email.toLowerCase().includes(q) ||
          r.display_name.toLowerCase().includes(q) ||
          r.phone?.includes(q) ||
          r.user_id.toLowerCase().includes(q)
        );
      }

      return rows;
    },
  });
}

const STATUS_DOT: Record<string, string> = {
  active: '#22c55e',
  suspended: '#ef4444',
  pending: '#eab308',
};

interface Props {
  onOpenWorkspace?: (userId: string) => void;
}

export function AdminCustomerDirectory({ onOpenWorkspace }: Props) {
  const [search, setSearch] = useState('');
  const { data: customers, isLoading } = useAdminCustomers(search);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--tracker-muted)' }} />
          <input
            placeholder="Search email, name, phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '7px 10px 7px 30px',
              fontSize: 12, color: 'var(--tracker-text)',
              background: 'var(--tracker-panel)',
              border: '1px solid var(--tracker-line)',
              borderRadius: 8, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {customers?.length != null && (
          <span style={{ fontSize: 11, color: 'var(--tracker-muted)', flexShrink: 0 }}>
            {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : !customers?.length ? (
        <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 12, color: 'var(--tracker-muted)' }}>
          No customers found.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--tracker-line)', borderRadius: 'var(--lt-radius)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--tracker-line)' }}>
                {['Email', 'Name', 'Phone', 'Region', 'Status', 'Joined', 'Merchants', 'Orders', 'Messages', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '8px 12px', textAlign: i >= 6 ? 'right' : 'left',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                    textTransform: 'uppercase', color: 'var(--tracker-muted)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((c, idx) => (
                <tr
                  key={c.user_id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--tracker-line2, var(--tracker-line))',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tracker-hover-card, color-mix(in srgb, var(--tracker-brand) 4%, transparent))')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--tracker-text)', whiteSpace: 'nowrap' }}>{c.email}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--tracker-text)' }}>{c.display_name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--tracker-muted)', fontFamily: 'var(--lt-font-mono, monospace)', fontSize: 11 }}>{c.phone ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--tracker-muted)' }}>{c.region ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[c.status] ?? 'var(--tracker-muted)', flexShrink: 0 }} />
                      <span style={{ color: 'var(--tracker-muted)', textTransform: 'capitalize' }}>{c.status}</span>
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--tracker-muted)', whiteSpace: 'nowrap' }}>
                    {format(new Date(c.created_at), 'MMM d, yyyy')}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Users style={{ width: 11, height: 11, color: 'var(--tracker-muted)' }} />
                      {c.connection_count}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <ShoppingCart style={{ width: 11, height: 11, color: 'var(--tracker-muted)' }} />
                      {c.order_count}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MessageCircle style={{ width: 11, height: 11, color: 'var(--tracker-muted)' }} />
                      {c.message_count}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {onOpenWorkspace && (
                      <button
                        onClick={() => onOpenWorkspace(c.user_id)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', fontSize: 11, fontWeight: 500,
                          color: 'var(--tracker-brand)',
                          background: 'color-mix(in srgb, var(--tracker-brand) 10%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--tracker-brand) 22%, transparent)',
                          borderRadius: 6, cursor: 'pointer',
                          transition: 'background 0.15s ease',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--tracker-brand) 18%, transparent)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--tracker-brand) 10%, transparent)')}
                      >
                        <ArrowUpRight style={{ width: 11, height: 11 }} />
                        View
                      </button>
                    )}
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
