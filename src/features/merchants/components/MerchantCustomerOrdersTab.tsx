import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';
import {
  cancelCustomerOrder,
  completeCustomerOrder,
  commitCustomerQuote,
  deriveCustomerOrderMeta,
  deriveFinalQuoteValues,
  formatCustomerDate,
  formatCustomerNumber,
  getCompatibleRails,
  getCurrencyForCountry,
  getGuidePricingForCustomerOrder,
  getDisplayedCustomerRate,
  getDisplayedCustomerTotal,
  markCustomerOrderAwaitingPayment,
  ORDER_SELECT_FIELDS,
  type CustomerCountry,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

// ── Place Order for Client Modal (mirrors the customer NewOrderForm exactly) ──
function PlaceOrderForClientModal({ merchantId, userId, onClose, onCreated }: {
  merchantId: string; userId: string; onClose: () => void; onCreated: () => void;
}) {
  const qc = useQueryClient();
  const sendCountry: CustomerCountry = 'Qatar';
  const receiveCountry: CustomerCountry = 'Egypt';
  const sendCurrency = getCurrencyForCountry(sendCountry);   // QAR
  const receiveCurrency = getCurrencyForCountry(receiveCountry); // EGP
  const rails = getCompatibleRails(sendCountry, receiveCountry);

  const [connId, setConnId] = useState('');
  const [amount, setAmount] = useState('');
  const [payoutRail, setPayoutRail] = useState('bank_transfer');
  const [note, setNote] = useState('');

  // Load connected clients — only use connection row data (customer_profiles blocked by RLS for merchants)
  const { data: connections = [] } = useQuery({
    queryKey: ['merchant-active-connections', merchantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('id, customer_user_id, nickname, status')
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];
      return data.map((r: any) => ({
        id: r.id,
        customer_user_id: r.customer_user_id,
        label: resolveCustomerLabel({
          displayName: null,
          name: null,
          nickname: r.nickname ?? null,
          phone: null,
          customerUserId: r.customer_user_id,
        }),
      }));
    },
  });

  // Guide pricing preview (same as customer form)
  const selectedConn = connections.find((c: any) => c.id === connId);
  const { data: guide } = useQuery({
    queryKey: ['merchant-guide-form', amount, connId],
    queryFn: () => getGuidePricingForCustomerOrder({
      customerUserId: selectedConn?.customer_user_id ?? '',
      merchantId,
      connectionId: connId,
      orderType: 'buy',
      amount: parseFloat(amount) || 0,
      rate: null,
      note: null,
      sendCountry,
      receiveCountry,
      sendCurrency,
      receiveCurrency,
      payoutRail,
      corridorLabel: 'Qatar -> Egypt',
    }),
    enabled: !!connId && !!amount && parseFloat(amount) > 0,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!connId || !amount || parseFloat(amount) <= 0)
        throw new Error('Select a client and enter an amount');
      const numAmount = parseFloat(amount);
      const { error } = await supabase.rpc('mirror_merchant_customer_order', {
        p_connection_id: connId,
        p_amount: numAmount,
        p_currency: sendCurrency,
        p_status: 'pending_quote',
        p_order_type: 'buy',
        p_rate: null,
        p_total: null,
        p_note: note.trim() || null,
        p_send_country: sendCountry,
        p_receive_country: receiveCountry,
        p_send_currency: sendCurrency,
        p_receive_currency: receiveCurrency,
        p_payout_rail: payoutRail,
        p_corridor_label: 'Qatar -> Egypt',
        p_pricing_mode: 'merchant_quote',
        p_guide_rate: guide?.guideRate ?? null,
        p_guide_total: guide?.guideTotal ?? null,
        p_guide_source: guide?.guideSource ?? null,
        p_guide_snapshot: guide?.guideSnapshot ?? null,
        p_guide_generated_at: guide?.guideGeneratedAt ?? null,
        p_final_rate: null,
        p_final_total: null,
        p_final_quote_note: null,
        p_quoted_by_user_id: null,
        p_customer_accepted_quote_at: null,
        p_customer_rejected_quote_at: null,
        p_quote_rejection_reason: null,
        p_market_pair: guide?.marketPair ?? null,
        p_pricing_version: guide?.pricingVersion ?? 'merchant-placed-v1',
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">New Order</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Corridor badge */}
        <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
          <span className="text-sm font-bold text-primary">QAR → EGP</span>
          <span className="text-xs text-muted-foreground">Qatar to Egypt</span>
        </div>

        {/* Client selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Client</label>
          <select value={connId} onChange={e => setConnId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">Select client…</option>
            {connections.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Amount to send (QAR)</label>
          <div className="relative">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0"
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-16 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
          </div>
        </div>

        {/* Guide pricing preview */}
        {guide?.guideRate != null && parseFloat(amount) > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Guide pricing</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-bold tabular-nums">{formatCustomerNumber(guide.guideRate, 'en', 4)} EGP/QAR</span>
            </div>
            {guide.guideTotal != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Client receives (est.)</span>
                <span className="font-bold tabular-nums text-emerald-600">{formatCustomerNumber(guide.guideTotal, 'en', 0)} EGP</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">Final rate set by you when quoting</p>
          </div>
        )}

        {/* Receive via */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Receive via</label>
          <select value={payoutRail} onChange={e => setPayoutRail(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {rails.map(r => (
              <option key={r.value} value={r.value}>
                {r.value === 'bank_transfer' ? 'Bank Transfer'
                  : r.value === 'mobile_wallet' ? 'Mobile Wallet (InstaPay/VCash)'
                  : r.value === 'cash_pickup' ? 'Cash Pickup'
                  : r.value}
              </option>
            ))}
          </select>
        </div>

        {/* Note */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Note <span className="text-muted-foreground/60">(optional)</span>
          </label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. InstaPay: 01xxxxxxxxx"
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>

        {/* Submit */}
        <button onClick={() => create.mutate()} disabled={create.isPending || !connId || !amount}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Place Order
        </button>
      </div>
    </div>
  );
}

type StatusFilter =
  | 'all'
  | 'pending_quote'
  | 'quoted'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'awaiting_payment'
  | 'payment_sent'
  | 'completed'
  | 'cancelled'
  | 'pending'
  | 'confirmed';

interface Props {
  merchantId?: string | null;
  isAdminView?: boolean;
}

type QuoteDraft = {
  final_rate: string;
  final_total: string;
  final_quote_note: string;
};

const EMPTY_QUOTE_DRAFT: QuoteDraft = {
  final_rate: '',
  final_total: '',
  final_quote_note: '',
};

function normalizeStatus(status: string) {
  if (status === 'pending' || status === 'confirmed') return status;
  return status as StatusFilter;
}

export default function MerchantCustomerOrdersTab({ merchantId, isAdminView }: Props = {}) {
  const { merchantProfile, userId } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [quoteDrafts, setQuoteDrafts] = useState<Record<string, QuoteDraft>>({});
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
  });

  const customerIds = useMemo(() => [...new Set(orders.map((o) => o.customer_user_id))], [orders]);
  const { data: customerConnections = [] } = useQuery({
    queryKey: ['merchant-customer-connections', customerIds, resolvedMerchantId],
    queryFn: async () => {
      if (customerIds.length === 0) return [];
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id, nickname, created_at, status')
        .eq('merchant_id', resolvedMerchantId!)
        .neq('status', 'blocked')
        .in('customer_user_id', customerIds);
      if (error) throw error;
      const userIds = [...new Set((data ?? []).map((row) => row.customer_user_id))];
      const { data: profiles, error: profileError } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, name, phone, region, country')
        .in('user_id', userIds);
      if (profileError) throw profileError;
      const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.user_id, profile]));
      return (data ?? []).map((row) => ({
        ...row,
        profile: profileMap.get(row.customer_user_id) ?? null,
      }));
    },
    enabled: customerIds.length > 0,
  });

  const customerMap = useMemo(() => {
    const map = new Map<string, any>();
    customerConnections.forEach((connection: any) => map.set(connection.customer_user_id, connection));
    return map;
  }, [customerConnections]);

  const updateQuoteDraft = (order: CustomerOrderRow, field: keyof QuoteDraft, value: string) => {
    setQuoteDrafts((prev) => {
      const current = prev[order.id] ?? EMPTY_QUOTE_DRAFT;
      const next = { ...current, [field]: value };
      const trimmed = value.trim();

      if (trimmed === '') {
        if (field === 'final_rate') {
          next.final_total = '';
        }
        if (field === 'final_total') {
          next.final_rate = '';
        }
      } else if (field === 'final_rate') {
        const derived = deriveFinalQuoteValues(order.amount, {
          finalRate: Number(value),
          finalTotal: null,
        });
        next.final_total = derived.finalTotal != null ? String(derived.finalTotal) : '';
      } else if (field === 'final_total') {
        const derived = deriveFinalQuoteValues(order.amount, {
          finalRate: null,
          finalTotal: Number(value),
        });
        next.final_rate = derived.finalRate != null ? String(derived.finalRate) : '';
      }

      return {
        ...prev,
        [order.id]: next,
      };
    });
  };

  useEffect(() => {
    setQuoteDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const order of orders) {
        if (next[order.id]) continue;
        changed = true;
        next[order.id] = {
          final_rate: order.final_rate != null ? String(order.final_rate) : order.rate != null ? String(order.rate) : '',
          final_total: order.final_total != null ? String(order.final_total) : order.total != null ? String(order.total) : '',
          final_quote_note: order.final_quote_note ?? '',
        };
      }
      return changed ? next : prev;
    });
  }, [orders]);

  const commitQuoteMutation = useMutation({
    mutationFn: async ({ order }: { order: CustomerOrderRow }) => {
      if (!userId) throw new Error('Missing merchant session');
      const draft = quoteDrafts[order.id];
      const derived = deriveFinalQuoteValues(order.amount, {
        finalRate: draft?.final_rate?.trim() ? Number(draft.final_rate) : null,
        finalTotal: draft?.final_total?.trim() ? Number(draft.final_total) : null,
      });
      if (!derived.finalRate || !Number.isFinite(derived.finalRate) || derived.finalRate <= 0) {
        throw new Error('Enter a valid final rate or final total');
      }
      const finalRate = derived.finalRate;
      const finalTotal = derived.finalTotal ?? Number((order.amount * finalRate).toFixed(6));
      const { error } = await commitCustomerQuote(order, {
        merchantUserId: userId,
        finalRate,
        finalTotal,
        finalQuoteNote: draft?.final_quote_note?.trim() || null,
      });
      if (error) throw error;
    },
    onMutate: async ({ order }) => {
      setActioningId(order.id);
    },
    onSuccess: () => {
      toast.success('Quote committed');
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      queryClient.invalidateQueries({ queryKey: ['merchant-client-connections'] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to commit quote');
    },
    onSettled: () => setActioningId(null),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ order, nextStatus }: { order: CustomerOrderRow; nextStatus: 'awaiting_payment' | 'completed' | 'cancelled' }) => {
      if (!userId) throw new Error('Missing merchant session');
      if (nextStatus === 'awaiting_payment') {
        const { error } = await markCustomerOrderAwaitingPayment(order, userId);
        if (error) throw error;
        return;
      }
      if (nextStatus === 'completed') {
        const { error } = await completeCustomerOrder(order, userId);
        if (error) throw error;
        return;
      }
      const { error } = await cancelCustomerOrder(order, userId);
      if (error) throw error;
    },
    onMutate: async ({ order }) => {
      setActioningId(order.id);
    },
    onSuccess: () => {
      toast.success('Order updated');
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      queryClient.invalidateQueries({ queryKey: ['merchant-client-connections'] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to update order');
    },
    onSettled: () => setActioningId(null),
  });

  const filtered = filter === 'all'
    ? orders
    : orders.filter((order) => normalizeStatus(order.status) === filter);

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending_quote', label: 'Pending quote' },
    { key: 'quoted', label: 'Quoted' },
    { key: 'quote_accepted', label: 'Accepted' },
    { key: 'awaiting_payment', label: 'Awaiting payment' },
    { key: 'payment_sent', label: 'Payment sent' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  if (isLoading) {
    return <div className="empty"><div className="empty-t">Loading customer orders...</div></div>;
  }

  return (
    <div className="space-y-3">
      {/* Place Order button */}
      {!isAdminView && resolvedMerchantId && userId && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowPlaceOrder(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Place Order for Client
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-border/60 pb-3">
        {statusFilters.map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === item.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
            type="button"
          >
            {item.label}
            {item.key !== 'all' && (
              <span className="ml-1 font-bold">
                {orders.filter((order) => normalizeStatus(order.status) === item.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Orders: {filtered.length}</span>
        <span>Pending quotes: {orders.filter((order) => normalizeStatus(order.status) === 'pending_quote').length}</span>
        <span>Quoted: {orders.filter((order) => normalizeStatus(order.status) === 'quoted').length}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-t">No customer orders{filter !== 'all' ? ` for ${filter}` : ''}</div>
          <div className="empty-d">Customer orders will appear here when placed</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const customer = customerMap.get(order.customer_user_id);
            const customerName = resolveCustomerLabel({
              displayName: customer?.profile?.display_name ?? null,
              name: customer?.profile?.name ?? null,
              nickname: customer?.nickname,
              customerUserId: order.customer_user_id,
            });
            const meta = deriveCustomerOrderMeta(order);
            const status = normalizeStatus(order.status);
            const displayedRate = getDisplayedCustomerRate(order);
            const displayedTotal = getDisplayedCustomerTotal(order);
            const draft = quoteDrafts[order.id];
            const canQuote = status === 'pending_quote' || status === 'pending';
            const canMarkAwaiting = status === 'quote_accepted';
            const canComplete = status === 'payment_sent';
            const canCancel = ['pending_quote', 'quoted', 'payment_sent', 'pending'].includes(status);

            return (
              <Card key={order.id} className={cn('overflow-hidden', canQuote ? 'border-primary/30' : '')}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                          {customerName[0]?.toUpperCase() ?? 'C'}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">
                            {customerName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {meta.corridorLabel} - {formatCustomerNumber(order.amount, 'en', 2)} {meta.sendCurrency}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border/60 px-2 py-1">{order.order_type.toUpperCase()}</span>
                        <span className="rounded-full border border-border/60 px-2 py-1">{order.payout_rail ?? 'N/A'}</span>
                        <span className="rounded-full border border-border/60 px-2 py-1">
                          {order.receive_currency ?? meta.receiveCurrency}
                        </span>
                        <Badge variant={status === 'completed' ? 'default' : status === 'cancelled' || status === 'quote_rejected' ? 'destructive' : 'secondary'} className="capitalize">
                          {status.replace(/_/g, ' ')}
                        </Badge>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Guide Rate</div>
                          <div className="mt-1 font-semibold text-foreground">
                            {order.guide_rate != null ? formatCustomerNumber(order.guide_rate, 'en', 4) : '-'}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {order.guide_source ?? 'INSTAPAY_V1'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {status === 'pending_quote' ? 'Estimated You Receive' : 'Final Total'}
                          </div>
                          <div className="mt-1 font-semibold text-foreground">
                            {displayedTotal != null
                              ? `${formatCustomerNumber(displayedTotal, 'en', 2)} ${meta.receiveCurrency}`
                              : '-'}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {displayedRate != null ? `Rate ${formatCustomerNumber(displayedRate, 'en', 4)}` : 'Awaiting quote'}
                          </div>
                        </div>
                      </div>

                      {order.final_quote_note && (
                        <div className="mt-3 rounded-lg border border-border/60 bg-card/80 p-3 text-sm text-muted-foreground">
                          {order.final_quote_note}
                        </div>
                      )}

                      <div className="mt-3 text-xs text-muted-foreground">
                        Created {formatCustomerDate(order.created_at, 'en')}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2" />
                  </div>

                  {canQuote && (
                    <div className="space-y-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
                      <div className="text-sm font-semibold text-foreground">Merchant quote form</div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Final rate</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={draft?.final_rate ?? ''}
                            onChange={(event) => updateQuoteDraft(order, 'final_rate', event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Final total</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={draft?.final_total ?? ''}
                            onChange={(event) => updateQuoteDraft(order, 'final_total', event.target.value)}
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Final quote note</Label>
                          <Textarea
                            value={draft?.final_quote_note ?? ''}
                            onChange={(event) => setQuoteDrafts((prev) => ({
                              ...prev,
                              [order.id]: {
                                ...(prev[order.id] ?? EMPTY_QUOTE_DRAFT),
                                final_quote_note: event.target.value,
                              },
                            }))}
                            rows={3}
                          />
                        </div>
                      </div>
                      <Button
                        onClick={() => commitQuoteMutation.mutate({ order })}
                        disabled={commitQuoteMutation.isPending || actioningId === order.id}
                      >
                        Commit Quote
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {canMarkAwaiting && (
                      <Button
                        onClick={() => transitionMutation.mutate({ order, nextStatus: 'awaiting_payment' })}
                        disabled={transitionMutation.isPending || actioningId === order.id}
                      >
                        Mark Awaiting Payment
                      </Button>
                    )}
                    {canComplete && (
                      <Button
                        onClick={() => transitionMutation.mutate({ order, nextStatus: 'completed' })}
                        disabled={transitionMutation.isPending || actioningId === order.id}
                      >
                        Complete Order
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="outline"
                        onClick={() => transitionMutation.mutate({ order, nextStatus: 'cancelled' })}
                        disabled={transitionMutation.isPending || actioningId === order.id}
                      >
                        Cancel Order
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>

      {/* Place Order modal */}
      {showPlaceOrder && resolvedMerchantId && userId && (
        <PlaceOrderForClientModal
          merchantId={resolvedMerchantId}
          userId={userId}
          onClose={() => setShowPlaceOrder(false)}
          onCreated={() => setShowPlaceOrder(false)}
        />
      )}
    </div>
  );
}
