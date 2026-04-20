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
  );
}
