import { useState, useMemo } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'awaiting_payment' | 'payment_sent' | 'completed' | 'cancelled';

interface Props {
  merchantId?: string | null;
  isAdminView?: boolean;
}

export default function MerchantCustomerOrdersTab({ merchantId, isAdminView }: Props = {}) {
  const { merchantProfile } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const resolvedMerchantId = isAdminView ? merchantId ?? null : merchantProfile?.merchant_id;

  // Fetch customer orders for this merchant
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['merchant-customer-orders', resolvedMerchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_orders')
        .select('*')
        .eq('merchant_id', resolvedMerchantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!resolvedMerchantId,
  });

  // Fetch customer profiles for display names
  const customerIds = useMemo(() => [...new Set(orders.map((o: any) => o.customer_user_id))], [orders]);
  const { data: customerProfiles = [] } = useQuery({
    queryKey: ['merchant-customer-profiles', customerIds, resolvedMerchantId],
    queryFn: async () => {
      if (customerIds.length === 0) return [];
      const { data } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, phone, region')
        .in('user_id', customerIds);
      return data ?? [];
    },
    enabled: customerIds.length > 0,
  });

  const customerMap = useMemo(() => {
    const m = new Map<string, any>();
    customerProfiles.forEach((p: any) => m.set(p.user_id, p));
    return m;
  }, [customerProfiles]);

  // Update order status
  const updateStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      setActioningId(orderId);
      const updates: any = { status };
      if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
      const { error } = await supabase
        .from('customer_orders')
        .update(updates)
        .eq('id', orderId);
      if (error) throw error;

      // Log event
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('customer_order_events').insert({
          order_id: orderId,
          actor_user_id: user.id,
          event_type: `merchant_${status}`,
        });
      }
    },
    onSuccess: (_, { status }) => {
      toast.success(`Order ${status}`);
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      setActioningId(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update order');
      setActioningId(null);
    },
  });

  const filtered = filter === 'all' ? orders : orders.filter((o: any) => o.status === filter);

  const statusFilters: { key: StatusFilter; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: 'var(--muted)' },
    { key: 'pending', label: 'Pending', color: 'var(--warn)' },
    { key: 'confirmed', label: 'Confirmed', color: 'var(--brand)' },
    { key: 'awaiting_payment', label: 'Awaiting Pay', color: '#e67e22' },
    { key: 'payment_sent', label: 'Paid', color: '#3498db' },
    { key: 'completed', label: 'Completed', color: 'var(--good)' },
    { key: 'cancelled', label: 'Cancelled', color: 'var(--bad)' },
  ];

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      pending: 'warn', confirmed: '', awaiting_payment: 'warn',
      payment_sent: '', completed: 'good', cancelled: 'bad',
    };
    return <span className={`pill ${map[status] || ''}`}>{status.replace('_', ' ')}</span>;
  };

  const actionButtons = (order: any) => {
    if (isAdminView) return null;
    const isActioning = actioningId === order.id;
    const btnStyle = (bg: string, color: string = '#fff') => ({
      fontSize: 10, fontWeight: 700, padding: '5px 12px', borderRadius: 6,
      border: 'none', cursor: 'pointer', background: bg, color,
      opacity: isActioning ? 0.5 : 1,
      minHeight: 34,
    });

    switch (order.status) {
      case 'pending':
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btnStyle('var(--good)')} disabled={isActioning}
              onClick={() => updateStatus.mutate({ orderId: order.id, status: 'confirmed' })}>
              ✓ Confirm
            </button>
            <button style={btnStyle('var(--bad)')} disabled={isActioning}
              onClick={() => updateStatus.mutate({ orderId: order.id, status: 'cancelled' })}>
              ✗ Reject
            </button>
          </div>
        );
      case 'confirmed':
        return (
          <button style={btnStyle('var(--brand)')} disabled={isActioning}
            onClick={() => updateStatus.mutate({ orderId: order.id, status: 'awaiting_payment' })}>
            💳 Request Payment
          </button>
        );
      case 'payment_sent':
        return (
          <button style={btnStyle('var(--good)')} disabled={isActioning}
            onClick={() => updateStatus.mutate({ orderId: order.id, status: 'completed' })}>
            ✓ Complete
          </button>
        );
      case 'awaiting_payment':
        return (
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>Waiting for customer payment...</span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="empty"><div className="empty-t">Loading customer orders...</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
        {statusFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontSize: 10, fontWeight: filter === f.key ? 700 : 500,
              padding: '5px 12px', borderRadius: 20,
              border: filter === f.key ? `1.5px solid ${f.color}` : '1px solid var(--line)',
              background: filter === f.key ? `color-mix(in srgb, ${f.color} 12%, transparent)` : 'transparent',
              color: filter === f.key ? f.color : 'var(--muted)',
              cursor: 'pointer',
              minHeight: 32,
            }}
          >
            {f.label}
            {f.key !== 'all' && (
              <span style={{ marginLeft: 4, fontWeight: 700 }}>
                {orders.filter((o: any) => o.status === f.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--muted)' }}>
        <span>📦 {filtered.length} order{filtered.length !== 1 ? 's' : ''}</span>
        <span>⏳ {orders.filter((o: any) => o.status === 'pending').length} pending</span>
        <span>✅ {orders.filter((o: any) => o.status === 'completed').length} completed</span>
      </div>

      {/* Order list */}
      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-t">No customer orders{filter !== 'all' ? ` with status "${filter}"` : ''}</div>
          <div className="empty-d">Customer orders will appear here when placed</div>
        </div>
      ) : (
        filtered.map((order: any) => {
          const customer = customerMap.get(order.customer_user_id);
          return (
            <div key={order.id} style={{
              padding: '12px 14px', borderRadius: 8,
              border: order.status === 'pending' ? '1.5px solid var(--warn)' : '1px solid var(--line)',
              background: 'var(--cardBg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {/* Customer info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--brand)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800,
                    }}>
                      {customer?.display_name?.[0]?.toUpperCase() ?? 'C'}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        {customer?.display_name ?? 'Unknown Customer'}
                      </div>
                      {customer?.region && (
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>📍 {customer.region}</div>
                      )}
                    </div>
                  </div>

                  {/* Order details */}
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{
                      fontWeight: 700,
                      color: order.order_type === 'buy' ? 'var(--good)' : 'var(--bad)',
                    }}>
                      {order.order_type === 'buy' ? '↓ BUY' : '↑ SELL'}
                    </span>
                    <span className="mono" style={{ fontWeight: 800 }}>
                      {Number(order.amount).toLocaleString()} {order.currency}
                    </span>
                    {order.rate && (
                      <span style={{ color: 'var(--muted)' }}>@ {Number(order.rate).toFixed(2)}</span>
                    )}
                    {order.total && (
                      <span style={{ color: 'var(--muted)' }}>
                        = {Number(order.total).toLocaleString()} QAR
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: 10, fontSize: 9, color: 'var(--muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                    {statusPill(order.status)}
                    <span>📅 {new Date(order.created_at).toLocaleDateString()}</span>
                    <span>🕐 {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {order.note && (
                    <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 6, fontStyle: 'italic' }}>
                      💬 "{order.note}"
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  {actionButtons(order)}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
