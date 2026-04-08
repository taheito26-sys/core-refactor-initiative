import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  merchantId: string;
}

export default function MerchantClientsTab({ merchantId }: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'blocked'>('all');

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['merchant-client-connections', merchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('*')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Resolve customer display names
      const userIds = data.map((c) => c.customer_user_id);
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, phone, region')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

      return data.map((c) => ({
        ...c,
        customer: profileMap.get(c.customer_user_id),
      }));
    },
    enabled: !!merchantId,
  });

  // Orders count per connection
  const { data: orderCounts = {} } = useQuery({
    queryKey: ['merchant-client-order-counts', merchantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('connection_id, status')
        .eq('merchant_id', merchantId);
      if (!data) return {};
      const counts: Record<string, { total: number; pending: number }> = {};
      data.forEach((o) => {
        if (!counts[o.connection_id]) counts[o.connection_id] = { total: 0, pending: 0 };
        counts[o.connection_id].total++;
        if (o.status === 'pending' || o.status === 'awaiting_payment' || o.status === 'payment_sent') {
          counts[o.connection_id].pending++;
        }
      });
      return counts;
    },
    enabled: !!merchantId,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('customer_merchant_connections')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-client-connections'] });
      toast.success('Connection updated');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  });

  const filtered = filter === 'all' ? connections : connections.filter((c: any) => c.status === filter);
  const pendingCount = connections.filter((c: any) => c.status === 'pending').length;

  const statusPill = (status: string) => {
    const cls = status === 'active' ? 'good' : status === 'pending' ? 'warn' : status === 'blocked' ? 'bad' : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['all', 'pending', 'active', 'blocked'] as const).map((f) => (
          <button
            key={f}
            className="btn"
            onClick={() => setFilter(f)}
            style={{
              fontSize: 10,
              fontWeight: filter === f ? 700 : 400,
              opacity: filter === f ? 1 : 0.6,
              minHeight: 34,
              padding: '4px 12px',
            }}
          >
            {f === 'all' ? `All (${connections.length})` :
             f === 'pending' ? `⏳ Pending (${pendingCount})` :
             f === 'active' ? `✅ Active` :
             `🚫 Blocked`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="empty">
          <div className="empty-t">Loading...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">👤</div>
          <div className="empty-t">No customer connections</div>
          <div className="empty-d">Customers will appear here when they connect to your merchant profile</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((conn: any) => {
            const counts = orderCounts[conn.id];
            return (
              <div
                key={conn.id}
                className="card"
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  gap: isMobile ? 8 : 12,
                  border: conn.status === 'pending' ? '2px solid var(--warn)' : undefined,
                }}
              >
                {/* Customer info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'var(--brand)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}>
                      {conn.customer?.display_name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {conn.customer?.display_name ?? 'Unknown Customer'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {conn.customer?.region ?? '—'}
                        {conn.customer?.phone ? ` · ${conn.customer.phone}` : ''}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10 }}>
                  {counts && (
                    <>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{counts.total}</div>
                        <div style={{ color: 'var(--muted)' }}>Orders</div>
                      </div>
                      {counts.pending > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--warn)' }}>{counts.pending}</div>
                          <div style={{ color: 'var(--muted)' }}>Pending</div>
                        </div>
                      )}
                    </>
                  )}
                  {statusPill(conn.status)}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {conn.status === 'pending' && (
                    <>
                      <button
                        className="btn"
                        style={{ fontSize: 10, minHeight: 34, padding: '4px 12px', background: 'var(--good)', color: '#fff' }}
                        onClick={() => updateStatus.mutate({ id: conn.id, status: 'active' })}
                        disabled={updateStatus.isPending}
                      >
                        ✅ Accept
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                        onClick={() => updateStatus.mutate({ id: conn.id, status: 'blocked' })}
                        disabled={updateStatus.isPending}
                      >
                        ❌ Reject
                      </button>
                    </>
                  )}
                  {conn.status === 'active' && (
                    <button
                      className="btn"
                      style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                      onClick={() => updateStatus.mutate({ id: conn.id, status: 'blocked' })}
                      disabled={updateStatus.isPending}
                    >
                      🚫 Block
                    </button>
                  )}
                  {conn.status === 'blocked' && (
                    <button
                      className="btn"
                      style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                      onClick={() => updateStatus.mutate({ id: conn.id, status: 'active' })}
                      disabled={updateStatus.isPending}
                    >
                      🔓 Unblock
                    </button>
                  )}
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>
                  {new Date(conn.created_at).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
