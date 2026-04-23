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
import { useTheme } from '@/lib/theme-context';
import { formatFxRateDisplay } from '@/lib/currency-locale';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';
import { MerchantAddExecutionForm } from '@/features/parent-order-fulfillment/components/MerchantAddExecutionForm';
import { MerchantExecutionList } from '@/features/parent-order-fulfillment/components/MerchantExecutionList';
import { useParentOrderSummary } from '@/features/parent-order-fulfillment/hooks/useParentOrderSummary';

// ── Place Order for Client Modal ──
function PlaceOrderForClientModal({ merchantId, userId, onClose }: {
  merchantId: string; userId: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const sendCountry = 'Qatar';
  const receiveCountry = 'Egypt';
  const sendCurrency = 'QAR';
  const receiveCurrency = 'EGP';

  const [connId, setConnId] = useState('');
  const [amount, setAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [merchantCashAccountId, setMerchantCashAccountId] = useState('none');
  const [fulfillmentMode, setFulfillmentMode] = useState<'complete' | 'phased'>('complete');
  const [usdtQarRate, setUsdtQarRate] = useState('3.8');
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
      const guide = await getQatarEgyptGuideRate();
      return {
        rate: guide.rate,
        fetchedAt: guide.timestamp,
        isEstimate: guide.source !== 'INSTAPAY_V1',
      };
    },
    staleTime: 60000, // 1 minute
    retry: 2,
  });

  // Auto-set FX rate on load
  useEffect(() => {
    if (liveRate && liveRate.rate != null && !fxRate) {
      setFxRate(String(liveRate.rate));
    }
  }, [liveRate, fxRate]);

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

      let numFxRate: number | null = null;

      if (fxRate && parseFloat(fxRate) > 0) {
        numFxRate = parseFloat(fxRate);
      } else if (liveRate?.rate != null) {
        numFxRate = liveRate.rate;
      }

      if (numFxRate == null || !Number.isFinite(numFxRate) || numFxRate <= 0) {
        throw new Error('Enter a valid FX rate');
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
        fulfillmentMode,
        usdtQarRate: fulfillmentMode === 'phased' && usdtQarRate ? parseFloat(usdtQarRate) : null,
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
      <div
        className="w-full max-w-lg rounded-t-2xl bg-background flex flex-col"
        style={{ maxHeight: '92dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">New Order</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">QAR → EGP</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">

          {/* Client + Amount — side by side on wider screens */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Client</label>
              <select value={connId} onChange={e => setConnId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Select client…</option>
                {connections.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount (QAR)</label>
              <div className="relative">
                <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0"
                  className="h-10 w-full rounded-lg border border-border/50 bg-card px-3 pe-14 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
              </div>
            </div>
          </div>

          {/* FX Rate — always editable, no toggle */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">FX Rate (QAR → EGP)</label>
            {isRateLoading ? (
              <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border/50 bg-card">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading…</span>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={fxRate}
                  onChange={e => setFxRate(e.target.value)}
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder={liveRate?.rate != null ? String(liveRate.rate) : '13.9253'}
                  className="h-10 w-full rounded-lg border border-border/50 bg-card px-3 pe-32 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">
                  1 QAR = {fxRate ? parseFloat(fxRate).toFixed(4) : '?'} EGP
                </span>
              </div>
            )}
            {/* Estimated delivery inline */}
            {amount && fxRate && parseFloat(fxRate) > 0 && (
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs">
                <span className="text-blue-600">Estimated delivery</span>
                <span className="font-bold text-blue-700">{(parseFloat(amount) * parseFloat(fxRate)).toFixed(0)} EGP</span>
              </div>
            )}
          </div>

          {/* Fulfillment Mode */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Fulfillment Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFulfillmentMode('complete')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  fulfillmentMode === 'complete'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                )}
              >
                <div className="font-semibold">Complete</div>
                <div className="text-[10px] opacity-70">All at once</div>
              </button>
              <button
                type="button"
                onClick={() => setFulfillmentMode('phased')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  fulfillmentMode === 'phased'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                )}
              >
                <div className="font-semibold">Phased</div>
                <div className="text-[10px] opacity-70">Incremental</div>
              </button>
            </div>

            {/* USDT/QAR Rate — only for phased */}
            {fulfillmentMode === 'phased' && (
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    value={usdtQarRate}
                    onChange={e => setUsdtQarRate(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="3.80"
                    className="h-9 w-full rounded-lg border border-border/50 bg-card px-3 pe-28 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">1 USDT = ? QAR</span>
                </div>
                {amount && usdtQarRate && parseFloat(usdtQarRate) > 0 && (
                  <span className="shrink-0 text-xs font-semibold text-primary">
                    {(parseFloat(amount) / parseFloat(usdtQarRate)).toFixed(0)} USDT
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className="w-full rounded-lg border border-border/50 bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Cash Account */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">💰 Cash Account</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setMerchantCashAccountId('none')}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  merchantCashAccountId === 'none'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                    : 'border-border/50 bg-card text-muted-foreground hover:border-emerald-500/40',
                )}
              >
                No Account
              </button>
              {activeCashAccounts.map((account: any) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setMerchantCashAccountId(account.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                    merchantCashAccountId === account.id
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                      : 'border-border/50 bg-card text-muted-foreground hover:border-emerald-500/40',
                  )}
                >
                  {account.name} · {account.currency}
                </button>
              ))}
            </div>
          </div>

          {/* Result banner */}
          {submitResult && (
            <div className={cn(
              'rounded-lg border px-3 py-2.5 text-sm',
              submitResult.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                : 'border-red-500/30 bg-red-500/5 text-red-700',
            )}>
              <p className="font-semibold">{submitResult.title}</p>
              <p className="mt-0.5 text-xs opacity-90">{submitResult.message}</p>
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="px-4 pb-6 pt-3 border-t border-border/40 shrink-0">
          <button
            onClick={() => {
              if (submitResult) {
                setConnId('');
                setAmount('');
                setFxRate('');
                setMerchantCashAccountId('none');
                setFulfillmentMode('complete');
                setUsdtQarRate('3.8');
                setNote('');
                setSubmitResult(null);
                onClose();
              } else {
                create.mutate();
              }
            }}
            disabled={create.isPending || (!submitResult && (!connId || !amount))}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitResult ? 'Close' : 'Place Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  merchantId?: string | null;
  isAdminView?: boolean;
}

// Helper component for phased order execution section - COMPACT INLINE VERSION
function PhasedOrderExecutionSection({ orderId, orderAmount, orderUsdtQarRate }: {
  orderId: string;
  orderAmount: number;
  orderUsdtQarRate: number | null;
}) {
  const { data: summary } = useParentOrderSummary(orderId);

  // Use summary values if available, fall back to order-level values
  const usdtQarRate = summary?.usdt_qar_rate ?? orderUsdtQarRate ?? 0;
  const remainingUsdt = summary?.remaining_usdt ?? (
    orderUsdtQarRate && orderUsdtQarRate > 0
      ? orderAmount / orderUsdtQarRate
      : orderAmount
  );
  const isFulfilled = summary
    ? (summary.remaining_usdt ?? summary.remaining_qar ?? 0) <= 0 && (summary.fill_count ?? 0) > 0
    : false;

  return (
    <div className="space-y-2">
      {/* Execution List - Compact chips */}
      <MerchantExecutionList parentOrderId={orderId} />

      {/* Add Execution Form — show unless fully fulfilled */}
      {!isFulfilled && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5">
          <span className="text-xs font-medium text-primary">Add:</span>
          <MerchantAddExecutionForm
            parentOrderId={orderId}
            remainingUsdt={remainingUsdt}
            usdtQarRate={usdtQarRate}
          />
        </div>
      )}

      {isFulfilled && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-center text-xs font-medium text-emerald-700">
          ✓ Fully fulfilled
        </div>
      )}
    </div>
  );
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
        .select('user_id, display_name, phone, region, country')
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
    <div className="space-y-0 -mx-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3">
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
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">No orders yet</div>
      ) : (
        <div className="divide-y divide-white/5">
          {orders.map((order) => {
            const customer = customerMap.get(order.customer_user_id);
            const isActioning = actioningId === order.id;
            const isEditing = editingId === order.id;
            const canApprove = canApproveOrder(order, 'merchant');
            const canReject = canRejectOrder(order, 'merchant');
            const canEdit = canEditOrder(order, 'merchant');
            const isPhasedOrder = order.fulfillment_mode === 'phased';

            const customerName = customer?.profile?.display_name || customer?.nickname || 'Customer';

            // Status badge config
            const statusCfg: Record<string, { label: string; cls: string }> = {
              pending_customer_approval: { label: 'بانتظار العميل', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
              pending_merchant_approval: { label: 'بانتظار التاجر', cls: 'bg-sky-500/20 text-sky-400 border-sky-500/30' },
              approved: { label: 'تمت الموافقة', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
              rejected: { label: 'مرفوض', cls: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
              cancelled: { label: 'ملغي', cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
            };
            const sc = statusCfg[order.workflow_status || 'cancelled'] || statusCfg.cancelled;

            const isApproved = order.workflow_status === 'approved';
            const amountColor = isApproved ? 'text-emerald-400' : canApprove ? 'text-amber-400' : 'text-slate-300';

            const dateLabel = new Date(order.created_at).toLocaleString('ar-EG', {
              month: 'numeric', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            });

            return (
              <div key={order.id} className="bg-[#0d1117] px-4 py-3 space-y-2">
                {/* Row 1: status badge (left) + customer name (right) */}
                <div className="flex items-center justify-between">
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sc.cls}`}>
                    {isPhasedOrder ? `📦 ${sc.label}` : sc.label}
                  </span>
                  <span className="text-[13px] font-bold text-slate-100">{customerName}</span>
                </div>

                {/* Row 2: balance label + date/time */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    {order.send_currency} → {order.receive_country || order.receive_currency}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">{dateLabel}</span>
                </div>

                {/* Row 3: running balance (left) + amount (right) */}
                <div className="flex items-center justify-between">
                  <div className="text-right" dir="rtl">
                    <span className="text-[11px] text-slate-500">الرصيد: </span>
                    <span className="text-[15px] font-black tabular-nums text-slate-200">
                      {order.amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className={`text-[15px] font-black tabular-nums ${amountColor}`}>
                      {isApproved ? '+' : ''}{order.amount.toLocaleString()} {order.send_currency}
                    </span>
                  </div>
                </div>

                {/* Row 4: note / description */}
                {(order.note || order.fx_rate) && (
                  <div className="text-[11px] text-slate-500 text-right" dir="rtl">
                    {order.note
                      ? order.note
                      : order.fx_rate
                      ? `${order.amount.toLocaleString()} ${order.send_currency} @ ${order.fx_rate.toFixed(2)}`
                      : ''}
                    {order.revision_no > 1 && ` · Rev ${order.revision_no}`}
                  </div>
                )}

                {/* Action buttons */}
                {(canApprove || canReject || canEdit || isEditing) && (
                  <div className="pt-1">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          placeholder={String(order.amount)}
                          className="h-8 flex-1 text-xs bg-white/5 border-white/10"
                        />
                        <Button size="sm" variant="outline" onClick={() => editMutation.mutate({ order })} disabled={editMutation.isPending} className="h-8 text-xs">
                          {editMutation.isPending ? <Loader2 className="h-3 w-3" /> : 'Update'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditAmount(''); }} className="h-8 px-2">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {canApprove && (
                          <Button size="sm" onClick={() => { setActioningId(order.id); approveMutation.mutate({ order }); }} disabled={isActioning} className="h-7 gap-1 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                            {isActioning && <Loader2 className="h-3 w-3 animate-spin" />}
                            <Check className="h-3 w-3" />Approve
                          </Button>
                        )}
                        {canReject && (
                          <Button size="sm" variant="destructive" onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }} disabled={isActioning} className="h-7 gap-1 text-[11px]">
                            {isActioning && <Loader2 className="h-3 w-3 animate-spin" />}
                            <XCircle className="h-3 w-3" />Reject
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="sm" variant="outline" onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }} className="h-7 text-[11px] border-white/10">
                            Edit
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Phased Order Execution */}
                {isPhasedOrder && (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <PhasedOrderExecutionSection
                      orderId={order.id}
                      orderAmount={order.amount}
                      orderUsdtQarRate={order.usdt_qar_rate ?? null}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
