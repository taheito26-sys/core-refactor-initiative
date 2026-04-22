import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, Plus, X, Check, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  createSharedOrderRequest,
  respondSharedOrder,
  editSharedOrder,
  listSharedOrdersForActor,
  getCashAccountsForUser,
  getFxRate,
  getWorkflowStatusLabel,
  canApproveOrder,
  canRejectOrder,
  canEditOrder,
  type WorkflowOrder,
} from '@/features/orders/shared-order-workflow';
import { formatCustomerDate, formatCustomerNumber } from '@/features/customer/customer-portal';

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
        ? (lang === 'ar' ? 'اليوم' : 'Today')
        : date === yesterday
        ? (lang === 'ar' ? 'أمس' : 'Yesterday')
        : new Date(date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    }));
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

  // Load live FX rate with error handling
  const { data: liveRate, isLoading: isRateLoading, isError: isRateError } = useQuery({
    queryKey: ['live-fx-rate', 'QAR', 'EGP'],
    queryFn: async () => getFxRate('QAR', 'EGP'),
    staleTime: 60000, // 1 minute
    retry: 2,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!merchantId || !amount || parseFloat(amount) <= 0) throw new Error(L('Enter amount and select merchant', 'أدخل المبلغ واختر التاجر'));

      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error(L('Merchant not found', 'التاجر غير موجود'));

      // Use live rate or fallback to 0.27
      const fxRateToUse = liveRate ? (typeof liveRate.rate === 'number' ? liveRate.rate : parseFloat(String(liveRate.rate))) : 0.27;

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
      toast.success(L('Order placed and sent to merchant', 'تم تقديم الطلب وإرساله للتاجر'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{L('New Order', 'طلب جديد')}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
          <span className="text-sm font-bold text-primary">{L('QAR → EGP', 'قطري → مصري')}</span>
          <span className="text-xs text-muted-foreground">{L('Qatar to Egypt', 'قطر إلى مصر')}</span>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Merchant', 'التاجر')}</label>
          <select value={merchantId} onChange={e => setMerchantId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {connections.map((c: any) => <option key={c.merchant_id} value={c.merchant_id}>{c.merchant_display_name || c.merchant_id}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Amount (قطري)', 'المبلغ (قطري)')}</label>
          <div className="relative">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0"
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-16 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">قطري</span>
          </div>
        </div>

        {/* Live FX Rate Display */}
        {isRateLoading ? (
          <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-border/50 bg-card">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{L('Loading rate...', 'جاري تحميل السعر...')}</span>
          </div>
        ) : isRateError || !liveRate ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-3 space-y-2 border border-amber-500/20">
            <div className="text-xs font-medium text-amber-700">{L('Using default rate', 'استخدام السعر الافتراضي')}</div>
            <div className="text-sm font-bold text-amber-700">1 قطري = 0.27 مصري</div>
            {amount && (
              <div className="pt-2 border-t border-amber-500/20">
                <div className="text-[11px] text-amber-600 mb-1">{L('Estimated delivery (may change)', 'التسليم المتوقع (قد يتغير)')}</div>
                <div className="text-lg font-bold text-amber-700">
                  {(parseFloat(amount) * 0.27).toFixed(2)} مصري
                </div>
                <div className="text-[10px] text-amber-600 mt-1">{L('Merchant sets final rate', 'التاجر يحدد السعر النهائي')}</div>
              </div>
            )}
          </div>
        ) : liveRate ? (
          <div className="rounded-lg bg-blue-500/10 px-3 py-3 space-y-2 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700">{L('Market Rate', 'سعر السوق')}</span>
              <span className="text-sm font-bold text-blue-700">1 قطري = {typeof liveRate.rate === 'number' ? liveRate.rate.toFixed(4) : parseFloat(String(liveRate.rate)).toFixed(4)} مصري</span>
            </div>
            {amount && (
              <div className="pt-2 border-t border-blue-500/20">
                <div className="text-[11px] text-blue-600 mb-1">{L('Estimated delivery (may change)', 'التسليم المتوقع (قد يتغير)')}</div>
                <div className="text-lg font-bold text-blue-700">
                  {amount && liveRate ? (parseFloat(amount) * (typeof liveRate.rate === 'number' ? liveRate.rate : parseFloat(String(liveRate.rate)))).toFixed(2) : '0.00'} مصري
                </div>
                <div className="text-[10px] text-blue-600 mt-1">{L('Merchant sets final rate', 'التاجر يحدد السعر النهائي')}</div>
              </div>
            )}
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Note (optional)', 'ملاحظة (اختياري)')}</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={L('Add details about this order', 'أضف تفاصيل عن الطلب')}
            className="min-h-20 w-full rounded-xl border border-border/50 bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">💰 {L('Your Cash Account', 'حسابك')}</div>
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
                <div className="font-semibold text-foreground">{L('No Account', 'بدون حساب')}</div>
                <div className="text-[11px] opacity-80">{L('Skip account linking', 'تخطي ربط الحساب')}</div>
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
                  {L('No active cash accounts found. Select "No Account" above or add one in Wallet.', 'لا توجد حسابات نشطة. اختر "بدون حساب" أعلاه أو أضف حسابًا في المحفظة.')}
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
          {L('Place Order', 'تقديم الطلب')}
        </button>
      </div>
    </div>
  );
}

export default function CustomerOrdersPage() {
  const { customerProfile, userId } = useAuth();
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
      toast.success(L('Order approved', 'تمت الموافقة على الطلب'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to approve', 'فشل'));
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
      toast.success(L('Order rejected', 'تم رفض الطلب'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to reject', 'فشل'));
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
      toast.success(L('Order updated and sent to merchant', 'تم إرسال الطلب للتاجر'));
      setEditingId(null);
      setEditAmount('');
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to update', 'فشل'));
    },
  });

  const grouped = groupByDay(orders, lang);

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-4 py-4 -mx-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{L('My Orders', 'طلباتي')}</h1>
          <button
            onClick={() => setShowNewOrder(true)}
            disabled={connections.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {L('New Order', 'طلب جديد')}
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
          <p className="text-muted-foreground">{L('No orders yet', 'لا توجد طلبات بعد')}</p>
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
                  pending_customer_approval: { color: 'bg-amber-500/10 text-amber-600', icon: '⏳' },
                  pending_merchant_approval: { color: 'bg-blue-500/10 text-blue-600', icon: '👤' },
                  approved: { color: 'bg-emerald-500/10 text-emerald-600', icon: '✓' },
                  rejected: { color: 'bg-red-500/10 text-red-600', icon: '✗' },
                  cancelled: { color: 'bg-muted text-muted-foreground', icon: '—' },
                }[order.workflow_status || 'cancelled'] || { color: 'bg-muted', icon: '?' };

                const deliveredAmount = order.fx_rate ? order.amount * order.fx_rate : null;
                const currencyLabel = (cur: string) => {
                  const labels: Record<string, { en: string; ar: string }> = {
                    QAR: { en: 'QAR (قطري)', ar: 'قطري' },
                    EGP: { en: 'EGP (مصري)', ar: 'مصري' },
                  };
                  return labels[cur] ? (lang === 'ar' ? labels[cur].ar : labels[cur].en) : cur;
                };

                return (
                  <div key={order.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                    <div className="p-3 sm:p-4">
                      {/* Status Badge */}
                      <div className="mb-3">
                        <span className={cn('inline-block rounded-lg px-2.5 py-1 text-xs font-semibold', statusCfg.color)}>
                          {getWorkflowStatusLabel(order.workflow_status)}
                        </span>
                      </div>

                      {/* Order Details - Clean Layout */}
                      <div className="space-y-3">
                        {/* Received & Delivered Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                          <div className="space-y-1">
                            <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {L('Received', 'المستقبل')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">{formatCustomerNumber(order.amount, lang, 2)}</span>
                              <span className="text-xs font-semibold text-muted-foreground">{currencyLabel(order.send_currency)}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {L('Delivered', 'المسلّم')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">
                                {deliveredAmount ? formatCustomerNumber(deliveredAmount, lang, 2) : '—'}
                              </span>
                              <span className="text-xs font-semibold text-muted-foreground">{currencyLabel(order.receive_currency)}</span>
                            </div>
                          </div>
                        </div>

                        {/* FX Rate & Date Row */}
                        {order.fx_rate && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 rounded-lg bg-muted/30 px-2.5 sm:px-3 py-2">
                            <div className="space-y-0.5">
                              <div className="text-[9px] sm:text-[10px] font-medium uppercase text-muted-foreground">{L('FX Rate', 'سعر الصرف')}</div>
                              <div className="text-xs sm:text-sm font-semibold">1 {currencyLabel(order.send_currency)} = {formatCustomerNumber(order.fx_rate, lang, 4)} {currencyLabel(order.receive_currency)}</div>
                            </div>
                            <div className="space-y-0.5 sm:text-right">
                              <div className="text-[9px] sm:text-[10px] font-medium uppercase text-muted-foreground">{L('Date', 'التاريخ')}</div>
                              <div className="text-xs sm:text-sm font-semibold">{new Date(order.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</div>
                            </div>
                          </div>
                        )}

                        {/* Note & Revision */}
                        {(order.note || order.revision_no > 1) && (
                          <div className="space-y-1">
                            {order.note && <div className="text-xs text-muted-foreground italic">💬 {order.note}</div>}
                            {order.revision_no > 1 && (
                              <div className="text-xs text-amber-600">🔄 {L('Revision', 'الإصدار')} {order.revision_no}</div>
                            )}
                          </div>
                        )}
                      </div>

                      {(canApprove || canReject || canEdit) && (
                        <div className="mt-4 pt-4 border-t border-border/30">
                          {isEditing ? (
                            <div className="space-y-2">
                              <label className="block text-xs font-medium text-muted-foreground">{L('New amount (QAR)', 'المبلغ الجديد')}</label>
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
                                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Update', 'تحديث')}
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
                                  {L('Approve', 'موافقة')}
                                </button>
                              )}
                              {canReject && (
                                <button
                                  onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-500/25 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                  {L('Reject', 'رفض')}
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                                  className="rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold hover:bg-muted"
                                >
                                  {L('Edit', 'تعديل')}
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
