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
import { triggerVaultBackup } from '@/lib/vault-auto-trigger';
// -- Place Order for Client Modal --
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
      triggerVaultBackup('merchant order placed');
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
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">QAR ? EGP</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">

          {/* Client + Amount � side by side on wider screens */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Client</label>
              <select value={connId} onChange={e => setConnId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Select client�</option>
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

          {/* FX Rate � always editable, no toggle */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">FX Rate (QAR ? EGP)</label>
            {isRateLoading ? (
              <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border/50 bg-card">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading�</span>
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

            {/* USDT/QAR Rate � only for phased */}
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
              placeholder="Add a note�"
              rows={2}
              className="w-full rounded-lg border border-border/50 bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Cash Account */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">?? Cash Account</label>
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
                  {account.name} � {account.currency}
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

      {/* Add Execution Form � show unless fully fulfilled */}
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
          ? Fully fulfilled
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

    return () => { void supabase.removeChannel(channel); };
  }, [resolvedMerchantId, queryClient]);

  const customerIds = useMemo(() => [...new Set(orders.map(o => o.customer_user_id))], [orders]);

  const { data: customerConnections = [] } = useQuery({
    queryKey: ['merchant-customer-connections', resolvedMerchantId, customerIds],
    queryFn: async () => {
      if (!resolvedMerchantId || customerIds.length === 0) return [];
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id, nickname')
        .eq('merchant_id', resolvedMerchantId)
        .neq('status', 'blocked')
        .in('customer_user_id', customerIds);
      if (!data || data.length === 0) return [];
      const userIds = [...new Set(data.map((r: any) => r.customer_user_id))];
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      return data.map((row: any) => ({
        ...row,
        profile: profileMap.get(row.customer_user_id) ?? null,
      }));
    },
    enabled: !!resolvedMerchantId && customerIds.length > 0,
  });

  const customerMap = useMemo(() => {
    const map = new Map<string, any>();
    customerConnections.forEach((c: any) => map.set(c.customer_user_id, c));
    return map;
  }, [customerConnections]);

  const approveMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      if (!resolvedMerchantId) throw new Error('Merchant not found');
      return respondSharedOrder({ orderId: order.id, actorRole: 'merchant', action: 'approve' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      setActioningId(null);
      toast.success('Order approved');
      triggerVaultBackup('merchant order approved');
    },
    onError: (e: any) => {
      setActioningId(null);
      toast.error(e?.message || 'Failed to approve');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      if (!resolvedMerchantId) throw new Error('Merchant not found');
      return respondSharedOrder({ orderId: order.id, actorRole: 'merchant', action: 'reject' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      setActioningId(null);
      toast.success('Order rejected');
      triggerVaultBackup('merchant order rejected');
    },
    onError: (e: any) => {
      setActioningId(null);
      toast.error(e?.message || 'Failed to reject');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      if (!userId) throw new Error('Merchant session missing');
      const editedAmount = editAmount.trim() ? parseFloat(editAmount) : undefined;
      return editSharedOrder({ orderId: order.id, actorRole: 'merchant', amount: editedAmount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-customer-orders', resolvedMerchantId] });
      setEditingId(null);
      setEditAmount('');
      toast.success('Order updated and sent back to customer');
      triggerVaultBackup('merchant order edited');
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Failed to update');
    },
  });

  return (
    <div style={{ margin: '0 -12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>Customer Orders</div>
        <button
          onClick={() => setShowPlaceOrder(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          <Plus style={{ width: 14, height: 14 }} />
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 120 }}>
          <Loader2 style={{ width: 22, height: 22, color: '#64748b' }} className="animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b', fontSize: 13 }}>No orders yet</div>
      ) : (
        <div>
          {orders.map((order, idx) => {
            const customer = customerMap.get(order.customer_user_id);
            const isActioning = actioningId === order.id;
            const isEditing = editingId === order.id;
            const canApprove = canApproveOrder(order, 'merchant');
            const canReject = canRejectOrder(order, 'merchant');
            const canEdit = canEditOrder(order, 'merchant');
            const isPhasedOrder = order.fulfillment_mode === 'phased';
            const customerName = customer?.profile?.display_name || customer?.nickname || 'Customer';
            const isApproved = order.workflow_status === 'approved';

            type SK = 'pending_customer_approval'|'pending_merchant_approval'|'approved'|'rejected'|'cancelled';
            const STATUS: Record<SK, { label: string; color: string; bg: string }> = {
              pending_customer_approval: { label: '??????? ??????', color: '#f59e0b', bg: 'rgba(245,158,11,0.13)' },
              pending_merchant_approval: { label: '??????? ??????',  color: '#38bdf8', bg: 'rgba(56,189,248,0.13)' },
              approved:                  { label: '??? ????????',    color: '#34d399', bg: 'rgba(52,211,153,0.13)' },
              rejected:                  { label: '?????',           color: '#f87171', bg: 'rgba(248,113,113,0.13)' },
              cancelled:                 { label: '????',            color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
            };
            const sc = STATUS[(order.workflow_status as SK) || 'cancelled'] || STATUS.cancelled;
            const amtColor = isApproved ? '#34d399' : canApprove ? '#f59e0b' : '#e2e8f0';

            const dateStr = new Date(order.created_at).toLocaleString('ar-EG', {
              month: 'numeric', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            });

            return (
              <div
                key={order.id}
                style={{
                  background: '#0d1117',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  borderBottom: idx === orders.length - 1 ? '1px solid rgba(255,255,255,0.06)' : undefined,
                  padding: '12px',
                }}
              >
                {/* Row 1: status pill + customer name */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: sc.color, background: sc.bg }}>
                    {isPhasedOrder ? `?? ${sc.label}` : sc.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9' }}>{customerName}</span>
                </div>

                {/* Row 2: corridor + date */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#475569' }}>
                    {order.send_currency || 'QAR'} ? {order.receive_country || order.receive_currency || 'EGP'}
                    {order.revision_no > 1 && <span style={{ color: '#f59e0b', marginLeft: 6 }}>Rev {order.revision_no}</span>}
                  </span>
                  <span style={{ fontSize: 11, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{dateStr}</span>
                </div>

                {/* Row 3: amount + fx rate */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: order.note ? 6 : 0 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#334155', marginBottom: 2 }}>??????</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: amtColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {isApproved ? '+' : ''}{order.amount.toLocaleString()}
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginLeft: 4 }}>{order.send_currency || 'QAR'}</span>
                    </div>
                  </div>
                  {order.fx_rate && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#334155', marginBottom: 2 }}>?????</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#7dd3fc', fontVariantNumeric: 'tabular-nums' }}>{order.fx_rate.toFixed(2)}</div>
                    </div>
                  )}
                </div>

                {/* Row 4: note */}
                {order.note && (
                  <div style={{ fontSize: 11, color: '#475569', marginBottom: 6, fontStyle: 'italic' }}>{order.note}</div>
                )}

                {/* Action buttons */}
                {(canApprove || canReject || canEdit || isEditing) && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                          type="number"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          placeholder={String(order.amount)}
                          className="h-8 flex-1 text-xs"
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9' }}
                        />
                        <Button size="sm" variant="outline" onClick={() => editMutation.mutate({ order })} disabled={editMutation.isPending} className="h-8 text-xs">
                          {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Update'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditAmount(''); }} className="h-8 px-2">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {canApprove && (
                          <button
                            onClick={() => { setActioningId(order.id); approveMutation.mutate({ order }); }}
                            disabled={isActioning}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: isActioning ? 0.5 : 1 }}
                          >
                            {isActioning ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Check style={{ width: 12, height: 12 }} />}
                            Approve
                          </button>
                        )}
                        {canReject && (
                          <button
                            onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                            disabled={isActioning}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: isActioning ? 0.5 : 1 }}
                          >
                            {isActioning ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <XCircle style={{ width: 12, height: 12 }} />}
                            Reject
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                            style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Phased execution */}
                {isPhasedOrder && (
                  <div style={{ marginTop: 8, borderRadius: 10, border: '1px solid rgba(56,189,248,0.2)', background: 'rgba(56,189,248,0.04)', padding: '8px 10px' }}>
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
