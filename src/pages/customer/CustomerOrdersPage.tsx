import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, Plus, X, Check, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  createSharedOrderRequest,
  respondSharedOrder,
  editSharedOrder,
  listSharedOrdersForActor,
  getCashAccountsForUser,
  canApproveOrder,
  canRejectOrder,
  canEditOrder,
  type WorkflowOrder,
} from '@/features/orders/shared-order-workflow';
import { formatCustomerDate, formatCustomerNumber } from '@/features/customer/customer-portal';
import { getP2PRates } from '@/lib/p2p-rates';

function groupByDay(orders: WorkflowOrder[], lang: 'en' | 'ar'): { label: string; date: string; orders: WorkflowOrder[] }[] {
  const map = new Map<string, WorkflowOrder[]>();
  for (const o of orders) {
    const d = new Date(o.created_at);
    const key = d.toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, orders]) => ({
      date,
      orders,
      label: date === today
        ? (lang === 'ar' ? 'Ø§Ù„ÙŠÙˆÙ…' : 'Today')
        : date === yesterday
        ? (lang === 'ar' ? 'Ø£Ù…Ø³' : 'Yesterday')
        : new Date(date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    }));
}

function getLocalizedWorkflowStatusLabel(status: WorkflowOrder['workflow_status'], lang: 'en' | 'ar') {
  switch (status) {
    case 'pending_customer_approval':
      return lang === 'ar' ? 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„' : 'Awaiting Customer Approval';
    case 'pending_merchant_approval':
      return lang === 'ar' ? 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„ØªØ§Ø¬Ø±' : 'Awaiting Merchant Approval';
    case 'approved':
      return lang === 'ar' ? 'ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©' : 'Approved';
    case 'rejected':
      return lang === 'ar' ? 'Ù…Ø±ÙÙˆØ¶' : 'Rejected';
    case 'cancelled':
      return lang === 'ar' ? 'Ù…Ù„ØºÙŠ' : 'Cancelled';
    default:
      return lang === 'ar' ? 'ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ' : 'Unknown';
  }
}

function NewOrderForm({ connections, userId, lang, onClose, onCreated }: {
  connections: any[]; userId: string; lang: 'en' | 'ar'; onClose: () => void; onCreated: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [merchantId, setMerchantId] = useState(connections[0]?.merchant_id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [customerCashAccountId, setCustomerCashAccountId] = useState('none');
  const qc = useQueryClient();

  const { data: cashAccounts = [] } = useQuery({
    queryKey: ['c-cash-accounts', userId],
    queryFn: async () => getCashAccountsForUser(userId),
    enabled: !!userId,
  });

  // Load live QAR -> EGP FX from the P2P rates store for this customer flow.
  const { data: liveRate, isLoading: isRateLoading, isError: isRateError } = useQuery({
    queryKey: ['live-fx-rate', 'QAR', 'EGP'],
    queryFn: async () => {
      const rates = await getP2PRates();
      return {
        rate: rates.qarToEgp,
        fetchedAt: new Date(rates.timestamp).toISOString(),
        isEstimate: false,
      };
    },
    staleTime: 60000, // 1 minute
    retry: 2,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!merchantId || !amount || parseFloat(amount) <= 0) throw new Error(L('Enter amount and select merchant', 'Ø£Ø¯Ø®Ù„ Ø§Ù„Ù…Ø¨Ù„Øº ÙˆØ§Ø®ØªØ± Ø§Ù„ØªØ§Ø¬Ø±'));

      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error(L('Merchant not found', 'Ø§Ù„ØªØ§Ø¬Ø± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯'));

      // Use exact InstaPay V1 market rate (no transformation)
      if (!liveRate || liveRate.rate == null || !Number.isFinite(liveRate.rate) || liveRate.rate <= 0) {
        throw new Error(L('Live market rate unavailable', 'Ø³Ø¹Ø± Ø§Ù„Ø³ÙˆÙ‚ ØºÙŠØ± Ù…ØªÙˆÙØ±'));
      }
      const fxRateToUse = liveRate.rate;

      const order = await createSharedOrderRequest({
        connectionId: conn.id,
        placedByRole: 'customer',
        amount: parseFloat(amount),
        orderType: 'buy',
        sendCountry: 'Qatar',
        receiveCountry: 'Egypt',
        sendCurrency: 'QAR',
        receiveCurrency: 'EGP',
        payoutRail: 'bank_transfer',
        fxRate: fxRateToUse,
        note: note || null,
        customerCashAccountId: customerCashAccountId === 'none' ? null : customerCashAccountId,
      });

      return { order, merchantId };
    },
    onSuccess: (result) => {
      if (result?.order) {
        qc.setQueryData<WorkflowOrder[]>(
          ['c-orders', userId],
          (current = []) => [result.order, ...current.filter((existing) => existing.id !== result.order.id)],
        );
        qc.invalidateQueries({ queryKey: ['merchant-customer-orders', result.merchantId] });
      }
      toast.success(L('Order placed and sent to merchant', 'ØªÙ… ØªÙ‚Ø¯ÙŠÙ… Ø§Ù„Ø·Ù„Ø¨ ÙˆØ¥Ø±Ø³Ø§Ù„Ù‡ Ù„Ù„ØªØ§Ø¬Ø±'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{L('New Order', 'Ø·Ù„Ø¨ Ø¬Ø¯ÙŠØ¯')}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
          <span className="text-sm font-bold text-primary">{L('QAR â†’ EGP', 'Ù‚Ø·Ø±ÙŠ â†’ Ù…ØµØ±ÙŠ')}</span>
          <span className="text-xs text-muted-foreground">{L('Qatar to Egypt', 'Ù‚Ø·Ø± Ø¥Ù„Ù‰ Ù…ØµØ±')}</span>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Merchant', 'Ø§Ù„ØªØ§Ø¬Ø±')}</label>
          <select value={merchantId} onChange={e => setMerchantId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {connections.map((c: any) => <option key={c.merchant_id} value={c.merchant_id}>{c.merchant_display_name || c.merchant_id}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Amount (Ù‚Ø·Ø±ÙŠ)', 'Ø§Ù„Ù…Ø¨Ù„Øº (Ù‚Ø·Ø±ÙŠ)')}</label>
          <div className="relative">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0"
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-16 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">Ù‚Ø·Ø±ÙŠ</span>
          </div>
        </div>

        {/* Live FX Rate Display â€” exact InstaPay V1 value, no transformation */}
        {isRateLoading ? (
          <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-border/50 bg-card">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{L('Loading rate...', 'Ø¬Ø§Ø±ÙŠ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³Ø¹Ø±...')}</span>
          </div>
        ) : isRateError || !liveRate || liveRate.rate == null || !Number.isFinite(liveRate.rate) ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-3 space-y-2 border border-amber-500/20">
            <div className="text-xs font-medium text-amber-700">{L('Market rate unavailable', 'Ø³Ø¹Ø± Ø§Ù„Ø³ÙˆÙ‚ ØºÙŠØ± Ù…ØªÙˆÙØ±')}</div>
            <div className="text-[11px] text-amber-600">{L('Please try again shortly.', 'ÙŠØ±Ø¬Ù‰ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù„Ø§Ø­Ù‚Ø§Ù‹.')}</div>
          </div>
        ) : (
          <div className="rounded-lg bg-blue-500/10 px-3 py-3 space-y-2 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700">{L('Market Rate (InstaPay V1)', 'Ø³Ø¹Ø± Ø§Ù„Ø³ÙˆÙ‚ (InstaPay V1)')}</span>
              <span className="text-sm font-bold text-blue-700">1 Ù‚Ø·Ø±ÙŠ = {liveRate.rate.toFixed(4)} Ù…ØµØ±ÙŠ</span>
            </div>
            {amount && (
              <div className="pt-2 border-t border-blue-500/20">
                <div className="text-[11px] text-blue-600 mb-1">{L('Estimated delivery (may change)', 'Ø§Ù„ØªØ³Ù„ÙŠÙ… Ø§Ù„Ù…ØªÙˆÙ‚Ø¹ (Ù‚Ø¯ ÙŠØªØºÙŠØ±)')}</div>
                <div className="text-lg font-bold text-blue-700">
                  {(parseFloat(amount) * liveRate.rate).toFixed(2)} Ù…ØµØ±ÙŠ
                </div>
                <div className="text-[10px] text-blue-600 mt-1">{L('Merchant sets final rate', 'Ø§Ù„ØªØ§Ø¬Ø± ÙŠØ­Ø¯Ø¯ Ø§Ù„Ø³Ø¹Ø± Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ')}</div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Note (optional)', 'Ù…Ù„Ø§Ø­Ø¸Ø© (Ø§Ø®ØªÙŠØ§Ø±ÙŠ)')}</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={L('Add details about this order', 'Ø£Ø¶Ù ØªÙØ§ØµÙŠÙ„ Ø¹Ù† Ø§Ù„Ø·Ù„Ø¨')}
            className="min-h-20 w-full rounded-xl border border-border/50 bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">ðŸ’° {L('Your Cash Account', 'Ø­Ø³Ø§Ø¨Ùƒ')}</div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {/* No Account Option */}
              <button
                type="button"
                onClick={() => setCustomerCashAccountId('none')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  customerCashAccountId === 'none'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-700'
                    : 'border-border/50 bg-card text-muted-foreground hover:border-blue-500/40',
                )}
              >
                <div className="font-semibold text-foreground">{L('No Account', 'Ø¨Ø¯ÙˆÙ† Ø­Ø³Ø§Ø¨')}</div>
                <div className="text-[11px] opacity-80">{L('Skip account linking', 'ØªØ®Ø·ÙŠ Ø±Ø¨Ø· Ø§Ù„Ø­Ø³Ø§Ø¨')}</div>
              </button>

              {/* Cash Accounts */}
              {cashAccounts.map((account: any) => {
                const isSelected = customerCashAccountId === account.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setCustomerCashAccountId(account.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10 text-blue-700'
                        : 'border-border/50 bg-card text-muted-foreground hover:border-blue-500/40',
                    )}
                  >
                    <div className="font-semibold text-foreground">{account.name}</div>
                    <div className="text-[11px] opacity-80">{account.currency}</div>
                  </button>
                );
              })}
            </div>
            {cashAccounts.length === 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-xs text-amber-700">
                  {L('No active cash accounts found. Select "No Account" above or add one in Wallet.', 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø­Ø³Ø§Ø¨Ø§Øª Ù†Ø´Ø·Ø©. Ø§Ø®ØªØ± "Ø¨Ø¯ÙˆÙ† Ø­Ø³Ø§Ø¨" Ø£Ø¹Ù„Ø§Ù‡ Ø£Ùˆ Ø£Ø¶Ù Ø­Ø³Ø§Ø¨Ù‹Ø§ ÙÙŠ Ø§Ù„Ù…Ø­ÙØ¸Ø©.')}
                </p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !merchantId || !amount}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {L('Place Order', 'ØªÙ‚Ø¯ÙŠÙ… Ø§Ù„Ø·Ù„Ø¨')}
        </button>
      </div>
    </div>
  );
}

export default function CustomerOrdersPage() {
  const { customerProfile, userId } = useAuth();
  const isMobile = useIsMobile();
  const { settings } = useTheme();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const qc = useQueryClient();
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const { data: connections = [] } = useQuery({
    queryKey: ['c-connections', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('merchant_id, status, nickname, created_at')
        .eq('customer_user_id', userId)
        .in('status', ['pending', 'active'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      const merchantIds = [...new Set((data ?? []).map(r => r.merchant_id))];
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, name')
        .in('merchant_id', merchantIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.merchant_id, p]));
      return (data ?? []).map((row: any) => ({
        ...row,
        merchant_display_name: profileMap.get(row.merchant_id)?.display_name || row.merchant_id,
      }));
    },
    enabled: !!userId,
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['c-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      return listSharedOrdersForActor({ customerUserId: userId });
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`c-orders-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['c-orders', userId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);

  const approveMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      const result = await respondSharedOrder({
        orderId: order.id,
        actorRole: 'customer',
        action: 'approve',
      });
      return result;
    },
    onSuccess: () => {
      toast.success(L('Order approved', 'ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø·Ù„Ø¨'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to approve', 'ÙØ´Ù„'));
    },
    onSettled: () => setActioningId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ order, reason }: { order: WorkflowOrder; reason?: string }) => {
      const result = await respondSharedOrder({
        orderId: order.id,
        actorRole: 'customer',
        action: 'reject',
        reason,
      });
      return result;
    },
    onSuccess: () => {
      toast.success(L('Order rejected', 'ØªÙ… Ø±ÙØ¶ Ø§Ù„Ø·Ù„Ø¨'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to reject', 'ÙØ´Ù„'));
    },
    onSettled: () => setActioningId(null),
  });

  const editMutation = useMutation({
    mutationFn: async ({ order }: { order: WorkflowOrder }) => {
      const editedAmount = editAmount.trim() ? parseFloat(editAmount) : undefined;
      const result = await editSharedOrder({
        orderId: order.id,
        actorRole: 'customer',
        amount: editedAmount,
      });
      return result;
    },
    onSuccess: () => {
      toast.success(L('Order updated and sent to merchant', 'ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø·Ù„Ø¨ Ù„Ù„ØªØ§Ø¬Ø±'));
      setEditingId(null);
      setEditAmount('');
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to update', 'ÙØ´Ù„'));
    },
  });

  const grouped = groupByDay(orders, lang);

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-4 py-4 -mx-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{L('My Orders', 'Ø·Ù„Ø¨Ø§ØªÙŠ')}</h1>
          <button
            onClick={() => setShowNewOrder(true)}
            disabled={connections.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {L('New Order', 'Ø·Ù„Ø¨ Ø¬Ø¯ÙŠØ¯')}
          </button>
        </div>
      </div>

      {showNewOrder && connections.length > 0 && (
        <NewOrderForm
          connections={connections}
          userId={userId!}
          lang={lang}
          onClose={() => setShowNewOrder(false)}
          onCreated={() => setShowNewOrder(false)}
        />
      )}

      {isLoading ? (
        <div className="flex h-32 items-center justify-center px-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
          <p className="text-muted-foreground">{L('No orders yet', 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø·Ù„Ø¨Ø§Øª Ø¨Ø¹Ø¯')}</p>
        </div>
      ) : (
        <div className="space-y-6 px-4">
          {grouped.map(({ label, orders: dayOrders }) => (
            <div key={label} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
              {dayOrders.map((order) => {
                const isActioning = actioningId === order.id;
                const isEditing = editingId === order.id;
                const canApprove = canApproveOrder(order, 'customer');
                const canReject = canRejectOrder(order, 'customer');
                const canEdit = canEditOrder(order, 'customer');

                const statusCfg = {
                  pending_customer_approval: { color: 'bg-amber-500/10 text-amber-600', icon: 'â³' },
                  pending_merchant_approval: { color: 'bg-blue-500/10 text-blue-600', icon: 'ðŸ‘¤' },
                  approved: { color: 'bg-emerald-500/10 text-emerald-600', icon: 'âœ“' },
                  rejected: { color: 'bg-red-500/10 text-red-600', icon: 'âœ—' },
                  cancelled: { color: 'bg-muted text-muted-foreground', icon: 'â€”' },
                }[order.workflow_status || 'cancelled'] || { color: 'bg-muted', icon: '?' };

                const deliveredAmount = order.fx_rate ? order.amount * order.fx_rate : null;
                const currencyLabel = (cur: string) => {
                  const labels: Record<string, { en: string; ar: string }> = {
                    QAR: { en: 'QAR (Ù‚Ø·Ø±ÙŠ)', ar: 'Ù‚Ø·Ø±ÙŠ' },
                    EGP: { en: 'EGP (Ø¬Ù†ÙŠØ©)', ar: 'Ø¬Ù†ÙŠØ©' },
                  };
                  return labels[cur] ? (lang === 'ar' ? labels[cur].ar : labels[cur].en) : cur;
                };

                if (isMobile) {
                  const statusTone = {
                    pending_customer_approval: {
                      card: 'border-amber-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(245,158,11,0.08)]',
                      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                      amount: 'text-amber-300',
                    },
                    pending_merchant_approval: {
                      card: 'border-sky-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(59,130,246,0.08)]',
                      badge: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
                      amount: 'text-sky-300',
                    },
                    approved: {
                      card: 'border-emerald-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(16,185,129,0.08)]',
                      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                      amount: 'text-emerald-400',
                    },
                    rejected: {
                      card: 'border-rose-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(244,63,94,0.08)]',
                      badge: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
                      amount: 'text-rose-400',
                    },
                    cancelled: {
                      card: 'border-slate-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(148,163,184,0.08)]',
                      badge: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
                      amount: 'text-slate-300',
                    },
                  }[order.workflow_status || 'cancelled'] || {
                    card: 'border-slate-500/18 bg-[#0d1730] shadow-[0_0_0_1px_rgba(148,163,184,0.08)]',
                    badge: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
                    amount: 'text-slate-300',
                  };
                  const statusLabel = getLocalizedWorkflowStatusLabel(order.workflow_status, lang);
                  const fxRateLabel = order.fx_rate != null ? formatCustomerNumber(order.fx_rate, lang, 2) : 'â€”';
                  const sendAmountLabel = formatCustomerNumber(order.amount, lang, 0);
                  const receiveAmountLabel = deliveredAmount != null
                    ? formatCustomerNumber(deliveredAmount, lang, 0)
                    : 'â€”';
                  const sendCurrencyLabel = currencyLabel(order.send_currency);
                  const receiveCurrencyLabel = currencyLabel(order.receive_currency);
                  const dateLabel = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(new Date(order.created_at));

                  return (
                    <div
                      key={order.id}
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      className={cn(
                        'overflow-hidden rounded-[22px] border px-3 py-3 text-[12px] text-slate-100',
                        statusTone.card,
                        lang === 'ar' && 'text-right',
                      )}
                    >
                      <div className={cn('flex items-start justify-between gap-2', lang === 'ar' && 'flex-row-reverse')}>
                        <div className="min-w-0">
                          <div className="text-[22px] font-black tracking-tight text-slate-50">
                            -{sendAmountLabel} {sendCurrencyLabel}
                          </div>
                        </div>
                        <span className={cn('shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium leading-none', statusTone.badge)}>
                          {statusLabel}
                        </span>
                      </div>

                      <div className={cn('mt-2 font-mono text-[11px] font-semibold tracking-[0.02em] text-slate-400', lang === 'ar' && 'text-right')}>
                        {dateLabel}
                      </div>

                      <div className={cn('mt-3 flex items-baseline justify-between gap-3', lang === 'ar' && 'flex-row-reverse')}>
                        <div className="min-w-0">
                          <div className="text-[11px] text-slate-400">
                            {lang === 'ar' ? 'الصرف' : 'FX'} 
                            <span className={cn('font-mono font-semibold tabular-nums', statusTone.amount)}>
                              1 {sendCurrencyLabel} = {fxRateLabel} {receiveCurrencyLabel}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-slate-400">
                          {lang === 'ar' ? 'الإجمالي' : 'Total'}: <span className="font-semibold text-slate-50">{receiveAmountLabel} {receiveCurrencyLabel}</span>
                        </div>
                      </div>

                      {(canApprove || canReject || canEdit) && (
                        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                          {isEditing ? (
                            <div className="space-y-2">
                              <label className="block text-[10px] font-medium tracking-wide text-slate-400">
                                {L('New amount', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø§Ù„Ø¬Ø¯ÙŠØ¯')}
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  value={editAmount}
                                  onChange={e => setEditAmount(e.target.value)}
                                  placeholder={String(order.amount)}
                                  className="h-9 flex-1 rounded-xl border border-white/10 bg-[#0b1224] px-3 text-xs outline-none focus:ring-2 focus:ring-blue-500/30"
                                />
                                <button
                                  onClick={() => editMutation.mutate({ order })}
                                  disabled={editMutation.isPending}
                                  className="flex h-9 items-center justify-center rounded-xl bg-sky-500/15 px-3 text-xs font-semibold text-sky-300 disabled:opacity-50"
                                >
                                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Update', 'ØªØ­Ø¯ÙŠØ«')}
                                </button>
                                <button
                                  onClick={() => { setEditingId(null); setEditAmount(''); }}
                                  className="flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/0 px-3 text-xs font-semibold text-slate-300"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {canApprove && (
                                <button
                                  onClick={() => { setActioningId(order.id); approveMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  {L('Approve', 'Ù…ÙˆØ§ÙÙ‚Ø©')}
                                </button>
                              )}
                              {canReject && (
                                <button
                                  onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                  {L('Reject', 'Ø±ÙØ¶')}
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                                  className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                                >
                                  {L('Edit', 'ØªØ¹Ø¯ÙŠÙ„')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={order.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                    <div className="p-3 sm:p-4">
                      {/* Status Badge */}
                      <div className="mb-3">
                        <span className={cn('inline-block rounded-lg px-2.5 py-1 text-xs font-semibold', statusCfg.color)}>
                          {getLocalizedWorkflowStatusLabel(order.workflow_status, lang)}
                        </span>
                      </div>

                      {/* Order Details - Clean Layout */}
                      <div className="space-y-3">
                        {/* Received & Delivered Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                          <div className="space-y-1">
                            <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {L('Received', 'Ø§Ù„Ù…Ø³ØªÙ‚Ø¨Ù„')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">{formatCustomerNumber(order.amount, lang, 2)}</span>
                              <span className="text-xs font-semibold text-muted-foreground">{currencyLabel(order.send_currency)}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {L('Delivered', 'Ø§Ù„Ù…Ø³Ù„Ù‘Ù…')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">
                                {deliveredAmount ? formatCustomerNumber(deliveredAmount, lang, 2) : 'â€”'}
                              </span>
                              <span className="text-xs font-semibold text-muted-foreground">{currencyLabel(order.receive_currency)}</span>
                            </div>
                          </div>
                        </div>

                        {/* FX Rate & Date Row */}
                        {order.fx_rate && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 rounded-lg bg-muted/30 px-2.5 sm:px-3 py-2">
                            <div className="space-y-0.5">
                              <div className="text-[9px] sm:text-[10px] font-medium uppercase text-muted-foreground">{L('FX Rate', 'Ø³Ø¹Ø± Ø§Ù„ØµØ±Ù')}</div>
                              <div className="text-xs sm:text-sm font-semibold">1 {currencyLabel(order.send_currency)} = {formatCustomerNumber(order.fx_rate, lang, 4)} {currencyLabel(order.receive_currency)}</div>
                            </div>
                            <div className="space-y-0.5 sm:text-right">
                              <div className="text-[9px] sm:text-[10px] font-medium uppercase text-muted-foreground">{L('Date', 'Ø§Ù„ØªØ§Ø±ÙŠØ®')}</div>
                              <div className="text-xs sm:text-sm font-semibold">{new Date(order.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</div>
                            </div>
                          </div>
                        )}

                        {/* Note & Revision */}
                        {(order.note || order.revision_no > 1) && (
                          <div className="space-y-1">
                            {order.note && <div className="text-xs text-muted-foreground italic">ðŸ’¬ {order.note}</div>}
                            {order.revision_no > 1 && (
                              <div className="text-xs text-amber-600">ðŸ”„ {L('Revision', 'Ø§Ù„Ø¥ØµØ¯Ø§Ø±')} {order.revision_no}</div>
                            )}
                          </div>
                        )}
                      </div>

                      {(canApprove || canReject || canEdit) && (
                        <div className="mt-4 pt-4 border-t border-border/30">
                          {isEditing ? (
                            <div className="space-y-2">
                              <label className="block text-xs font-medium text-muted-foreground">{L('New amount', 'Ø§Ù„Ù…Ø¨Ù„Øº Ø§Ù„Ø¬Ø¯ÙŠØ¯')}</label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  value={editAmount}
                                  onChange={e => setEditAmount(e.target.value)}
                                  placeholder={String(order.amount)}
                                  className="h-9 flex-1 rounded-lg border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                <button
                                  onClick={() => editMutation.mutate({ order })}
                                  disabled={editMutation.isPending}
                                  className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                >
                                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Update', 'ØªØ­Ø¯ÙŠØ«')}
                                </button>
                                <button
                                  onClick={() => { setEditingId(null); setEditAmount(''); }}
                                  className="rounded-lg border border-border/50 px-4 text-sm font-semibold hover:bg-muted"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {canApprove && (
                                <button
                                  onClick={() => { setActioningId(order.id); approveMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  {L('Approve', 'Ù…ÙˆØ§ÙÙ‚Ø©')}
                                </button>
                              )}
                              {canReject && (
                                <button
                                  onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-500/25 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                  {L('Reject', 'Ø±ÙØ¶')}
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                                  className="rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold hover:bg-muted"
                                >
                                  {L('Edit', 'ØªØ¹Ø¯ÙŠÙ„')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
