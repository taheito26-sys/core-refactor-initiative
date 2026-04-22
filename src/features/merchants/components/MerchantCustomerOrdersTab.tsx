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
import { Loader2, Plus, X, Check, XCircle } from 'lucide-react';
import {
  createSharedOrderRequest,
  respondSharedOrder,
  editSharedOrder,
  getCashAccountsForUser,
  getMerchantCashAccounts,
  listSharedOrdersForActor,
  getWorkflowStatusLabel,
  canApproveOrder,
  canRejectOrder,
  canEditOrder,
  type WorkflowOrder,
} from '@/features/orders/shared-order-workflow';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

// ── Place Order for Client Modal ──
function PlaceOrderForClientModal({ merchantId, userId, onClose }: {
  merchantId: string; userId: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const sendCountry = 'Qatar';
  const receiveCountry = 'Egypt';
  const sendCurrency = 'QAR';
  const receiveCurrency = 'EGP';

  const [connId, setConnId] = useState('');
  const [amount, setAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [customFxRate, setCustomFxRate] = useState(false);
  const [merchantCashAccountId, setMerchantCashAccountId] = useState('none');
  const [note, setNote] = useState('');
  const [submitResult, setSubmitResult] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Load live FX rate with proper error handling
  const { data: liveRate, isLoading: isRateLoading, isError: isRateError } = useQuery({
    queryKey: ['live-fx-rate', sendCurrency, receiveCurrency],
    queryFn: async () => {
      const { getFxRate } = await import('@/features/orders/shared-order-workflow');
      return getFxRate(sendCurrency, receiveCurrency);
    },
    staleTime: 60000, // 1 minute
    retry: 2,
  });

  // Auto-set FX rate on load
  useEffect(() => {
    if (liveRate && !fxRate && !customFxRate) {
      const rateValue = typeof liveRate.rate === 'number' ? liveRate.rate : parseFloat(String(liveRate.rate));
      setFxRate(rateValue.toFixed(4));
    }
  }, [liveRate, fxRate, customFxRate]);

  // Load connected clients
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

  const { data: cashAccounts = [] } = useQuery({
    queryKey: ['merchant-cash-accounts', merchantId],
    queryFn: async () => {
      if (!merchantId) return [];
      return getMerchantCashAccounts(merchantId);
    },
    enabled: !!merchantId,
  });

  const activeCashAccounts = useMemo(() =>
    cashAccounts.filter((account: any) => account.status === 'active'),
    [cashAccounts]
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!connId || !amount || parseFloat(amount) <= 0)
        throw new Error('Select a client and enter an amount');

      let numFxRate = 0.27; // default

      if (customFxRate && fxRate) {
        // User edited the rate
        if (parseFloat(fxRate) <= 0)
          throw new Error('Enter valid FX rate (QAR → EGP)');
        numFxRate = parseFloat(fxRate);
      } else if (fxRate) {
        // Use whatever FX rate we have (from market or previously set)
        numFxRate = parseFloat(fxRate);
      } else if (liveRate) {
        // Use live market rate if available
        numFxRate = typeof liveRate.rate === 'number' ? liveRate.rate : parseFloat(String(liveRate.rate));
      }

      const numAmount = parseFloat(amount);

      const order = await createSharedOrderRequest({
        connectionId: connId,
        placedByRole: 'merchant',
        amount: numAmount,
        orderType: 'buy',
        sendCountry,
        receiveCountry,
        sendCurrency,
        receiveCurrency,
        payoutRail: 'bank_transfer',
        fxRate: numFxRate,
        note: note || null,
        merchantCashAccountId: merchantCashAccountId === 'none' ? null : merchantCashAccountId,
      });

      return order;
    },
    onSuccess: (order) => {
      qc.setQueryData<WorkflowOrder[]>(
        ['merchant-customer-orders', merchantId],
        (current = []) => [order, ...current.filter((o) => o.id !== order.id)],
      );
      setSubmitResult({
        kind: 'success',
        title: 'Order placed',
        message: 'Order sent to customer for approval',
      });
      toast.success('Order placed and sent to customer');
      qc.invalidateQueries({ queryKey: ['merchant-customer-orders', merchantId] });
    },
    onError: (e: any) => {
      setSubmitResult({
        kind: 'error',
        title: 'Failed',
        message: e.message || 'Could not place order',
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">New Order for Client</h2>
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

        {/* FX Rate with Live Market Data */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">FX Rate (قطري → مصري) *</label>
            <button
              type="button"
              onClick={() => setCustomFxRate(!customFxRate)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {customFxRate ? '📌 Use Market Rate' : '✏️ Edit Rate'}
            </button>
          </div>

          {isRateLoading ? (
            <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-border/50 bg-card">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading market rate...</span>
            </div>
          ) : isRateError || !liveRate ? (
            <div className="relative">
              <input
                value={fxRate}
                onChange={e => setFxRate(e.target.value)}
                type="number"
                min="0"
                step="0.0001"
                placeholder="0.27"
                className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-40 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">1 QAR = ? EGP</span>
            </div>
          ) : (
            <>
              <div className="relative">
                <input
                  value={fxRate}
                  onChange={e => setFxRate(e.target.value)}
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder={'0.27'}
                  disabled={!customFxRate}
                  className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-40 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-default"
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">1 QAR = ? EGP</span>
              </div>
              {liveRate && !customFxRate && (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                  📈 Market Rate: 1 QAR = {typeof liveRate.rate === 'number' ? liveRate.rate.toFixed(4) : parseFloat(String(liveRate.rate)).toFixed(4)} EGP {liveRate.isEstimate ? '(estimated)' : ''}
                </div>
              )}
            </>
          )}
        </div>

        {/* Calculated EGP Amount */}
        {amount && fxRate && (
          <div className="rounded-lg bg-blue-500/10 px-3 py-3 space-y-1">
            <div className="text-xs font-medium text-blue-700">Estimated Delivery</div>
            <div className="text-lg font-bold text-blue-700">
              {(parseFloat(amount) * parseFloat(fxRate)).toFixed(2)} EGP
            </div>
            <div className="text-[11px] text-blue-600">Based on {fxRate} rate • Final amount may vary</div>
          </div>
        )}

        {/* Note */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Note (optional)</label>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note about this order…"
            className="min-h-20 text-sm"
          />
        </div>

        {/* Cash Account */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            💰 Merchant cash account
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {/* No Account Option */}
              <button
                type="button"
                onClick={() => setMerchantCashAccountId('none')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  merchantCashAccountId === 'none'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                    : 'border-border/50 bg-card text-muted-foreground hover:border-emerald-500/40',
                )}
              >
                <div className="font-semibold text-foreground">No Account</div>
                <div className="text-[11px] opacity-80">Skip account linking</div>
              </button>

              {/* Cash Accounts */}
              {activeCashAccounts.map((account: any) => {
                const isSelected = merchantCashAccountId === account.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setMerchantCashAccountId(account.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                        : 'border-border/50 bg-card text-muted-foreground hover:border-emerald-500/40',
                    )}
                  >
                    <div className="font-semibold text-foreground">{account.name}</div>
                    <div className="text-[11px] opacity-80">{account.currency}</div>
                  </button>
                );
              })}
            </div>
            {activeCashAccounts.length === 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-xs text-amber-700">
                  No active cash accounts found. Go to Wallet to create one, or select "No Account" above.
                </p>
              </div>
            )}
          </div>
        </div>

        {submitResult && (
          <div
            className={cn(
              'rounded-xl border px-4 py-3 text-sm',
              submitResult.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                : 'border-red-500/30 bg-red-500/5 text-red-700',
            )}
          >
            <p className="font-semibold">{submitResult.title}</p>
            <p className="mt-1 text-xs leading-5 opacity-90">{submitResult.message}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={() => {
            if (submitResult) {
              setConnId('');
              setAmount('');
              setFxRate('');
              setCustomFxRate(false);
              setMerchantCashAccountId('none');
              setNote('');
              setSubmitResult(null);
              onClose();
            } else {
              create.mutate();
            }
          }}
          disabled={create.isPending || (!submitResult && (!connId || !amount))}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitResult ? 'Close' : 'Place Order'}
        </button>
      </div>
    </div>
  );
}

interface Props {
  merchantId?: string | null;
  isAdminView?: boolean;
}

export default function MerchantCustomerOrdersTab({ merchantId, isAdminView }: Props = {}) {
  const { merchantProfile, userId } = useAuth();
  const queryClient = useQueryClient();
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const resolvedMerchantId = isAdminView ? merchantId ?? null : (merchantProfile?.merchant_id ?? merchantId ?? null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['merchant-customer-orders', resolvedMerchantId],
    queryFn: async () => {
      if (!resolvedMerchantId) return [];
      return listSharedOrdersForActor({ merchantId: resolvedMerchantId });
    },
    enabled: !!resolvedMerchantId,
  });

  useEffect(() => {
    if (!resolvedMerchantId) return;
    const channel = supabase
      .channel(`merchant-customer-orders-${resolvedMerchantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_orders', filter: `merchant_id=eq.${resolvedMerchantId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, resolvedMerchantId]);

  const customerIds = useMemo(() => [...new Set(orders.map((o) => o.customer_user_id))], [orders]);
  const { data: customerConnections = [] } = useQuery({
    queryKey: ['merchant-customer-connections', customerIds, resolvedMerchantId],
    queryFn: async () => {
      if (customerIds.length === 0 || !resolvedMerchantId) return [];
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id, nickname, created_at, status')
        .eq('merchant_id', resolvedMerchantId)
        .neq('status', 'blocked')
        .in('customer_user_id', customerIds);
      if (error) throw error;
      const userIds = [...new Set((data ?? []).map((row) => row.customer_user_id))];
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, name, phone, region, country')
        .in('user_id', userIds);
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

  const approveMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      if (!resolvedMerchantId) throw new Error('Merchant not found');
      const result = await respondSharedOrder({
        orderId: order.id,
        actorRole: 'merchant',
        action: 'approve',
      });
      return result;
    },
    onSuccess: () => {
      toast.success('Order approved');
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to approve order');
    },
    onSettled: () => setActioningId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ order, reason }: { order: WorkflowOrder; reason?: string }) => {
      if (!resolvedMerchantId) throw new Error('Merchant not found');
      const result = await respondSharedOrder({
        orderId: order.id,
        actorRole: 'merchant',
        action: 'reject',
        reason,
      });
      return result;
    },
    onSuccess: () => {
      toast.success('Order rejected');
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to reject order');
    },
    onSettled: () => setActioningId(null),
  });

  const editMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      if (!userId) throw new Error('Merchant session missing');
      const editedAmount = editAmount.trim() ? parseFloat(editAmount) : undefined;
      const result = await editSharedOrder({
        orderId: order.id,
        actorRole: 'merchant',
        amount: editedAmount,
      });
      return result;
    },
    onSuccess: () => {
      toast.success('Order updated and sent back to customer');
      setEditingId(null);
      setEditAmount('');
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to update order');
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Customer Orders</h2>
        <button
          onClick={() => setShowPlaceOrder(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      {showPlaceOrder && resolvedMerchantId && userId && (
        <PlaceOrderForClientModal
          merchantId={resolvedMerchantId}
          userId={userId}
          onClose={() => setShowPlaceOrder(false)}
        />
      )}

      {isLoading ? (
        <Card><CardContent className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : orders.length === 0 ? (
        <Card><CardContent className="flex h-32 items-center justify-center text-muted-foreground">No orders yet</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const customer = customerMap.get(order.customer_user_id);
            const isActioning = actioningId === order.id;
            const isEditing = editingId === order.id;
            const canApprove = canApproveOrder(order, 'merchant');
            const canReject = canRejectOrder(order, 'merchant');
            const canEdit = canEditOrder(order, 'merchant');

            return (
              <Card key={order.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          {customer?.profile?.display_name || customer?.nickname || 'Customer'}
                        </span>
                        <Badge variant="outline">{order.order_type.toUpperCase()}</Badge>
                        <Badge variant={order.workflow_status === 'approved' ? 'default' : order.workflow_status === 'rejected' ? 'destructive' : 'secondary'}>
                          {getWorkflowStatusLabel(order.workflow_status)}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {order.amount} {order.send_currency} {order.receive_country && `→ ${order.receive_country}`}
                      </div>
                      {order.note && <div className="text-xs text-muted-foreground italic">"{order.note}"</div>}
                      {order.revision_no > 1 && (
                        <div className="text-xs text-amber-600">Revision {order.revision_no}</div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      {isEditing ? (
                        <div className="w-32 space-y-1">
                          <Input
                            type="number"
                            value={editAmount}
                            onChange={e => setEditAmount(e.target.value)}
                            placeholder={String(order.amount)}
                            className="h-8 text-xs"
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editMutation.mutate({ order })}
                              disabled={editMutation.isPending}
                              className="h-7 flex-1 text-xs"
                            >
                              {editMutation.isPending ? <Loader2 className="h-3 w-3" /> : 'Update'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setEditingId(null); setEditAmount(''); }}
                              className="h-7 px-2"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {canApprove && (
                            <Button
                              size="sm"
                              onClick={() => { setActioningId(order.id); approveMutation.mutate({ order }); }}
                              disabled={isActioning}
                              className="h-8 gap-1 text-xs"
                            >
                              {isActioning && <Loader2 className="h-3 w-3 animate-spin" />}
                              <Check className="h-3 w-3" />
                              Approve
                            </Button>
                          )}
                          {canReject && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                              disabled={isActioning}
                              className="h-8 gap-1 text-xs"
                            >
                              {isActioning && <Loader2 className="h-3 w-3 animate-spin" />}
                              <XCircle className="h-3 w-3" />
                              Reject
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                              className="h-8 text-xs"
                            >
                              Edit
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
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
