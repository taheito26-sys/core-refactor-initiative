import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Plus, X, Check, Loader2 } from 'lucide-react';
import {
  cancelCustomerOrder,
  completeCustomerOrder,
  commitCustomerQuote,
  deriveCustomerOrderMeta,
  deriveFinalQuoteValues,
  formatCustomerDate,
  formatCustomerNumber,
  getDisplayedCustomerRate,
  getDisplayedCustomerTotal,
  markCustomerOrderAwaitingPayment,
  ORDER_SELECT_FIELDS,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

type StatusFilter = 'all' | 'pending_quote' | 'quoted' | 'quote_accepted' | 'awaiting_payment' | 'payment_sent' | 'completed' | 'cancelled' | 'pending' | 'confirmed';
type QuoteDraft = { final_rate: string; final_total: string; final_quote_note: string };
const EMPTY_DRAFT: QuoteDraft = { final_rate: '', final_total: '', final_quote_note: '' };

function normalizeStatus(s: string): StatusFilter { return s as StatusFilter; }

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_quote:    { label: 'Pending',   cls: 'bg-amber-500/15 text-amber-500' },
  pending:          { label: 'Pending',   cls: 'bg-amber-500/15 text-amber-500' },
  quoted:           { label: 'Quoted',    cls: 'bg-blue-500/15 text-blue-400' },
  quote_accepted:   { label: 'Accepted',  cls: 'bg-emerald-500/15 text-emerald-400' },
  awaiting_payment: { label: 'Awaiting',  cls: 'bg-orange-500/15 text-orange-400' },
  payment_sent:     { label: 'Sent',      cls: 'bg-sky-500/15 text-sky-400' },
  completed:        { label: 'Done',      cls: 'bg-emerald-500/15 text-emerald-400' },
  cancelled:        { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
  quote_rejected:   { label: 'Rejected',  cls: 'bg-muted text-muted-foreground' },
};

interface Props { merchantId?: string | null; isAdminView?: boolean; }

// ── Place Order Modal ─────────────────────────────────────────────────────────
function PlaceOrderModal({ merchantId, userId, onClose, onCreated }: {
  merchantId: string; userId: string; onClose: () => void; onCreated: () => void;
}) {
  const [connId, setConnId] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const qc = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: ['merchant-connections-for-order', merchantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('id, customer_user_id, nickname, status')
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];
      const uids = data.map((r: any) => r.customer_user_id);
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, name, phone')
        .in('user_id', uids);
      const pm = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      return data.map((r: any) => ({
        ...r,
        label: resolveCustomerLabel({
          displayName: pm.get(r.customer_user_id)?.display_name,
          name: pm.get(r.customer_user_id)?.name,
          nickname: r.nickname,
          phone: pm.get(r.customer_user_id)?.phone,
          customerUserId: r.customer_user_id,
        }),
      }));
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!connId || !amount) throw new Error('Select client and enter amount');
      const numAmount = parseFloat(amount);
      const numRate = parseFloat(rate);
      if (!Number.isFinite(numAmount) || numAmount <= 0) throw new Error('Invalid amount');

      const { error } = await supabase.rpc('mirror_merchant_customer_order', {
        p_connection_id: connId,
        p_amount: numAmount,
        p_currency: 'USDT',
        p_status: 'pending_quote',
        p_order_type: 'buy',
        p_rate: Number.isFinite(numRate) && numRate > 0 ? numRate : null,
        p_total: Number.isFinite(numRate) && numRate > 0 ? numAmount * numRate : null,
        p_note: note.trim() || null,
        p_send_country: null,
        p_receive_country: null,
        p_send_currency: 'USDT',
        p_receive_currency: 'QAR',
        p_payout_rail: null,
        p_corridor_label: null,
        p_pricing_mode: 'merchant_quote',
        p_guide_rate: null,
        p_guide_total: null,
        p_guide_source: null,
        p_guide_snapshot: null,
        p_guide_generated_at: null,
        p_final_rate: null,
        p_final_total: null,
        p_final_quote_note: null,
        p_quoted_by_user_id: null,
        p_customer_accepted_quote_at: null,
        p_customer_rejected_quote_at: null,
        p_quote_rejection_reason: null,
        p_market_pair: null,
        p_pricing_version: 'merchant-placed-v1',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order placed for client');
      qc.invalidateQueries({ queryKey: ['merchant-customer-orders'] });
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-4 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">Place Order for Client</span>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <select value={connId} onChange={e => setConnId(e.target.value)}
          className="h-9 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
          <option value="">Select client…</option>
          {connections.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Amount (USDT)</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0"
              className="h-9 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Rate (optional)</label>
            <input value={rate} onChange={e => setRate(e.target.value)} type="number" placeholder="0.00"
              className="h-9 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none" />
          </div>
        </div>

        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
          className="h-9 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none" />

        <button onClick={() => submit.mutate()} disabled={submit.isPending || !connId || !amount}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Place Order
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MerchantCustomerOrdersTab({ merchantId, isAdminView }: Props = {}) {
  const { merchantProfile, userId } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [quoteDrafts, setQuoteDrafts] = useState<Record<string, QuoteDraft>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);

  const resolvedMerchantId = isAdminView ? merchantId ?? null : merchantProfile?.merchant_id;

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['merchant-customer-orders', resolvedMerchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_orders')
        .select(ORDER_SELECT_FIELDS.join(', '))
        .eq('merchant_id', resolvedMerchantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!resolvedMerchantId,
    refetchInterval: 15_000,
  });

  const customerIds = useMemo(() => [...new Set(orders.map(o => o.customer_user_id))], [orders]);
  const { data: customerConnections = [] } = useQuery({
    queryKey: ['merchant-customer-connections', customerIds, resolvedMerchantId],
    queryFn: async () => {
      if (customerIds.length === 0) return [];
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id, nickname')
        .eq('merchant_id', resolvedMerchantId!)
        .in('customer_user_id', customerIds);
      const uids = [...new Set((data ?? []).map((r: any) => r.customer_user_id))];
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, name, phone')
        .in('user_id', uids);
      const pm = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      return (data ?? []).map((r: any) => ({ ...r, profile: pm.get(r.customer_user_id) ?? null }));
    },
    enabled: customerIds.length > 0,
  });

  const customerMap = useMemo(() => {
    const m = new Map<string, any>();
    customerConnections.forEach((c: any) => m.set(c.customer_user_id, c));
    return m;
  }, [customerConnections]);

  // Auto-populate quote drafts from existing order data
  useEffect(() => {
    setQuoteDrafts(prev => {
      const next = { ...prev };
      let changed = false;
      for (const o of orders) {
        if (next[o.id]) continue;
        changed = true;
        next[o.id] = {
          final_rate: o.final_rate != null ? String(o.final_rate) : o.rate != null ? String(o.rate) : '',
          final_total: o.final_total != null ? String(o.final_total) : o.total != null ? String(o.total) : '',
          final_quote_note: o.final_quote_note ?? '',
        };
      }
      return changed ? next : prev;
    });
  }, [orders]);

  const updateDraft = (order: CustomerOrderRow, field: keyof QuoteDraft, value: string) => {
    setQuoteDrafts(prev => {
      const cur = prev[order.id] ?? EMPTY_DRAFT;
      const next = { ...cur, [field]: value };
      if (field === 'final_rate' && value.trim()) {
        const d = deriveFinalQuoteValues(order.amount, { finalRate: Number(value), finalTotal: null });
        next.final_total = d.finalTotal != null ? String(d.finalTotal) : '';
      } else if (field === 'final_total' && value.trim()) {
        const d = deriveFinalQuoteValues(order.amount, { finalRate: null, finalTotal: Number(value) });
        next.final_rate = d.finalRate != null ? String(d.finalRate) : '';
      }
      return { ...prev, [order.id]: next };
    });
  };

  const commitQuote = useMutation({
    mutationFn: async ({ order }: { order: CustomerOrderRow }) => {
      if (!userId) throw new Error('No session');
      const draft = quoteDrafts[order.id];
      const derived = deriveFinalQuoteValues(order.amount, {
        finalRate: draft?.final_rate?.trim() ? Number(draft.final_rate) : null,
        finalTotal: draft?.final_total?.trim() ? Number(draft.final_total) : null,
      });
      if (!derived.finalRate || derived.finalRate <= 0) throw new Error('Enter a valid rate or total');
      const finalRate = derived.finalRate;
      const finalTotal = derived.finalTotal ?? order.amount * finalRate;
      const { error } = await commitCustomerQuote(order, { merchantUserId: userId, finalRate, finalTotal, finalQuoteNote: draft?.final_quote_note?.trim() || null });
      if (error) throw error;
    },
    onMutate: ({ order }) => setActioningId(order.id),
    onSuccess: () => { toast.success('Quote sent'); qc.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
    onSettled: () => setActioningId(null),
  });

  const transition = useMutation({
    mutationFn: async ({ order, next }: { order: CustomerOrderRow; next: 'awaiting_payment' | 'completed' | 'cancelled' }) => {
      if (!userId) throw new Error('No session');
      if (next === 'awaiting_payment') { const { error } = await markCustomerOrderAwaitingPayment(order, userId); if (error) throw error; return; }
      if (next === 'completed') { const { error } = await completeCustomerOrder(order, userId); if (error) throw error; return; }
      const { error } = await cancelCustomerOrder(order, userId); if (error) throw error;
    },
    onMutate: ({ order }) => setActioningId(order.id),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
    onSettled: () => setActioningId(null),
  });

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    orders.forEach(o => { const s = normalizeStatus(o.status); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [orders]);

  const filtered = filter === 'all' ? orders : orders.filter(o => normalizeStatus(o.status) === filter);

  const FILTERS: { key: StatusFilter; short: string }[] = [
    { key: 'all', short: 'All' },
    { key: 'pending_quote', short: 'Pending quote' },
    { key: 'quoted', short: 'Quoted' },
    { key: 'quote_accepted', short: 'Accepted' },
    { key: 'awaiting_payment', short: 'Awaiting payment' },
    { key: 'payment_sent', short: 'Payment sent' },
    { key: 'completed', short: 'Completed' },
    { key: 'cancelled', short: 'Cancelled' },
  ];

  if (isLoading) return <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {filtered.length} order{filtered.length !== 1 ? 's' : ''}
          {statusCounts['pending_quote'] ? ` · ${statusCounts['pending_quote']} pending` : ''}
          {statusCounts['quoted'] ? ` · ${statusCounts['quoted']} quoted` : ''}
        </div>
        {!isAdminView && resolvedMerchantId && userId && (
          <button
            className="btn"
            style={{ fontSize: 10, minHeight: 30, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setShowPlaceOrder(true)}
          >
            <Plus size={12} /> Place Order
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const count = f.key === 'all' ? orders.length : (statusCounts[f.key] || 0);
          if (f.key !== 'all' && count === 0) return null;
          return (
            <button
              key={f.key}
              className="btn"
              onClick={() => setFilter(f.key)}
              style={{
                fontSize: 10, minHeight: 26, padding: '2px 8px',
                fontWeight: filter === f.key ? 700 : 400,
                opacity: filter === f.key ? 1 : 0.6,
              }}
            >
              {f.short} {count > 0 && <span style={{ marginLeft: 2, fontWeight: 700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Orders list */}
      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-t">No orders{filter !== 'all' ? ` · ${filter}` : ''}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(order => {
            const conn = customerMap.get(order.customer_user_id);
            const name = resolveCustomerLabel({
              displayName: conn?.profile?.display_name ?? null,
              name: conn?.profile?.name ?? null,
              nickname: conn?.nickname,
              phone: conn?.profile?.phone ?? null,
              customerUserId: order.customer_user_id,
            });
            const meta = deriveCustomerOrderMeta(order);
            const status = normalizeStatus(order.status);
            const { label: sLabel, cls: sCls } = STATUS_LABEL[status] ?? STATUS_LABEL['pending_quote'];
            const displayedRate = getDisplayedCustomerRate(order);
            const displayedTotal = getDisplayedCustomerTotal(order);
            const draft = quoteDrafts[order.id];
            const canQuote = status === 'pending_quote' || status === 'pending';
            const canMarkAwaiting = status === 'quote_accepted';
            const canComplete = status === 'payment_sent';
            const canCancel = ['pending_quote', 'quoted', 'payment_sent', 'pending'].includes(status);
            const isExpanded = expanded[order.id] ?? canQuote;
            const isActioning = actioningId === order.id;

            return (
              <div key={order.id} className="card" style={{ padding: '8px 10px', border: canQuote ? '1px solid var(--brand)' : undefined }}>
                {/* Compact header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  onClick={() => setExpanded(p => ({ ...p, [order.id]: !isExpanded }))}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: 'var(--brand)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, flexShrink: 0,
                  }}>
                    {name[0]?.toUpperCase() ?? 'C'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {formatCustomerNumber(order.amount, 'en', 2)} {meta.sendCurrency}
                      {displayedTotal != null && <> → {formatCustomerNumber(displayedTotal, 'en', 2)} {meta.receiveCurrency}</>}
                      {displayedRate != null && <> @ {formatCustomerNumber(displayedRate, 'en', 4)}</>}
                    </div>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', sCls)}>{sLabel}</span>
                  {isExpanded ? <ChevronUp size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} /> : <ChevronDown size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Meta row */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, color: 'var(--muted)' }}>
                      <span className="pill">{order.order_type.toUpperCase()}</span>
                      {order.payout_rail && <span className="pill">{order.payout_rail.replace(/_/g, ' ')}</span>}
                      <span style={{ marginLeft: 'auto' }}>{formatCustomerDate(order.created_at, 'en')}</span>
                    </div>

                    {/* Quote form */}
                    {canQuote && (
                      <div style={{ background: 'var(--panel)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)' }}>Send Quote</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>Rate</div>
                            <div className="inputBox" style={{ padding: '4px 8px' }}>
                              <input type="number" inputMode="decimal" value={draft?.final_rate ?? ''}
                                onChange={e => updateDraft(order, 'final_rate', e.target.value)}
                                placeholder="0.0000" style={{ width: '100%', fontSize: 12 }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>Total ({meta.receiveCurrency})</div>
                            <div className="inputBox" style={{ padding: '4px 8px' }}>
                              <input type="number" inputMode="decimal" value={draft?.final_total ?? ''}
                                onChange={e => updateDraft(order, 'final_total', e.target.value)}
                                placeholder="0" style={{ width: '100%', fontSize: 12 }} />
                            </div>
                          </div>
                        </div>
                        <div className="inputBox" style={{ padding: '4px 8px' }}>
                          <input value={draft?.final_quote_note ?? ''} placeholder="Note (optional)"
                            onChange={e => setQuoteDrafts(p => ({ ...p, [order.id]: { ...(p[order.id] ?? EMPTY_DRAFT), final_quote_note: e.target.value } }))}
                            style={{ width: '100%', fontSize: 11 }} />
                        </div>
                        <button className="btn" style={{ fontSize: 11, minHeight: 32, background: 'var(--brand)', color: '#fff' }}
                          onClick={() => commitQuote.mutate({ order })} disabled={isActioning || commitQuote.isPending}>
                          {isActioning ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          {' '}Send Quote
                        </button>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canMarkAwaiting && (
                        <button className="btn" style={{ fontSize: 10, minHeight: 30 }}
                          onClick={() => transition.mutate({ order, next: 'awaiting_payment' })} disabled={isActioning}>
                          Mark Awaiting Payment
                        </button>
                      )}
                      {canComplete && (
                        <button className="btn" style={{ fontSize: 10, minHeight: 30, background: 'var(--good)', color: '#fff' }}
                          onClick={() => transition.mutate({ order, next: 'completed' })} disabled={isActioning}>
                          <Check size={11} /> Complete
                        </button>
                      )}
                      {canCancel && (
                        <button className="btn" style={{ fontSize: 10, minHeight: 30, color: 'var(--bad)' }}
                          onClick={() => transition.mutate({ order, next: 'cancelled' })} disabled={isActioning}>
                          Cancel Order
                        </button>
                      )}
                    </div>

                    {/* Payment proof */}
                    {order.payment_proof_url && (
                      <a href={order.payment_proof_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: 'var(--brand)' }}>
                        📎 View payment proof
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Place Order Modal */}
      {showPlaceOrder && resolvedMerchantId && userId && (
        <PlaceOrderModal
          merchantId={resolvedMerchantId}
          userId={userId}
          onClose={() => setShowPlaceOrder(false)}
          onCreated={() => setShowPlaceOrder(false)}
        />
      )}
    </div>
  );
}
