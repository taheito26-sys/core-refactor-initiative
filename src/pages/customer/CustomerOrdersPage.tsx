import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, Plus, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  cancelCustomerOrder, createCustomerOrderWithGuide,
  deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber,
  getCurrencyForCountry, getDisplayedCustomerRate,
  getDisplayedCustomerTotal, getGuidePricingForCustomerOrder,
  listCustomerConnections, listCustomerOrders,
  rejectCustomerQuote, type CustomerCountry, type CustomerOrderRow,
} from '@/features/customer/customer-portal';

// ── Customer vocabulary: approval-first lifecycle ───────────────────────────
function customerStatus(status: string, lang: 'en' | 'ar'): { label: string; cls: string } {
  const map: Record<string, { en: string; ar: string; cls: string }> = {
    pending_quote:    { en: 'Pending approval', ar: 'بانتظار الموافقة', cls: 'bg-amber-500/10 text-amber-600' },
    quoted:           { en: 'Awaiting approval', ar: 'بانتظار الموافقة', cls: 'bg-blue-500/10 text-blue-600' },
    quote_accepted:   { en: 'Approved', ar: 'مقبول', cls: 'bg-emerald-500/10 text-emerald-600' },
    awaiting_payment: { en: 'Approved', ar: 'مقبول', cls: 'bg-emerald-500/10 text-emerald-600' },
    payment_sent:     { en: 'Approved', ar: 'مقبول', cls: 'bg-emerald-500/10 text-emerald-600' },
    completed:        { en: 'Approved', ar: 'مكتمل', cls: 'bg-emerald-500/10 text-emerald-600' },
    cancelled:        { en: 'Cancelled', ar: 'ملغي', cls: 'bg-muted text-muted-foreground' },
    quote_rejected:   { en: 'Rejected', ar: 'مرفوض', cls: 'bg-muted text-muted-foreground' },
  };
  const cfg = map[status] ?? map.pending_quote;
  return { label: lang === 'ar' ? cfg.ar : cfg.en, cls: cfg.cls };
}

// ── Group orders by calendar day ──────────────────────────────────────────────
function groupByDay(orders: CustomerOrderRow[], lang: 'en' | 'ar'): { label: string; date: string; orders: CustomerOrderRow[] }[] {
  const map = new Map<string, CustomerOrderRow[]>();
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

// ── New Order Form ────────────────────────────────────────────────────────────
function NewOrderForm({ connections, userId, lang, onClose, onCreated }: {
  connections: any[]; userId: string; lang: 'en' | 'ar'; onClose: () => void; onCreated: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [merchantId, setMerchantId] = useState(connections[0]?.merchant_id ?? '');
  const [amount, setAmount] = useState('');
  const [customerCashAccountId, setCustomerCashAccountId] = useState('');
  const sendCountry: CustomerCountry = 'Qatar';
  const receiveCountry: CustomerCountry = 'Egypt';
  const sendCurrency = getCurrencyForCountry(sendCountry);
  const receiveCurrency = getCurrencyForCountry(receiveCountry);
  const qc = useQueryClient();

  const { data: cashAccounts = [] } = useQuery({
    queryKey: ['c-cash-accounts', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('cash_accounts')
        .select('id, name, currency, type, status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (customerCashAccountId || cashAccounts.length === 0) return;
    setCustomerCashAccountId(cashAccounts[0].id);
  }, [cashAccounts, customerCashAccountId]);

  const { data: guide } = useQuery({
    queryKey: ['c-guide-form', amount],
    queryFn: () => getGuidePricingForCustomerOrder({ customerUserId: userId, merchantId, connectionId: '', orderType: 'buy', amount: parseFloat(amount) || 0, rate: null, note: null, sendCountry, receiveCountry, sendCurrency, receiveCurrency, payoutRail: 'bank_transfer', corridorLabel: 'Qatar -> Egypt' }),
    enabled: !!amount && parseFloat(amount) > 0, staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!merchantId || !amount || parseFloat(amount) <= 0) throw new Error(L('Enter amount and select merchant', 'أدخل المبلغ واختر التاجر'));
      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error(L('Merchant not found', 'التاجر غير موجود'));
      const selectedAccount = cashAccounts.find((account: any) => account.id === customerCashAccountId);
      const { error } = await createCustomerOrderWithGuide({
        customerUserId: userId,
        merchantId,
        connectionId: conn.id,
        orderType: 'buy',
        amount: parseFloat(amount),
        rate: null,
        note: null,
        sendCountry,
        receiveCountry,
        sendCurrency,
        receiveCurrency,
        payoutRail: 'bank_transfer',
        corridorLabel: 'Qatar -> Egypt',
        customerCashAccountId: selectedAccount?.id ?? null,
        customerCashAccountName: selectedAccount?.name ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L('Order placed', 'تم تقديم الطلب')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onCreated(); },
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
          <span className="text-sm font-bold text-primary">QAR → EGP</span>
          <span className="text-xs text-muted-foreground">{L('Qatar to Egypt', 'قطر إلى مصر')}</span>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Merchant', 'التاجر')}</label>
          <select value={merchantId} onChange={e => setMerchantId(e.target.value)} className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {connections.map((c: any) => <option key={c.merchant_id} value={c.merchant_id}>{c.merchant?.display_name ?? c.merchant_id}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Cash account', 'حساب النقد')}</label>
          <select value={customerCashAccountId} onChange={e => setCustomerCashAccountId(e.target.value)} className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">{L('Select account…', 'اختر حساباً…')}</option>
            {cashAccounts.map((account: any) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Amount to send (QAR)', 'المبلغ المُرسَل (QAR)')}</label>
          <div className="relative">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-16 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
          </div>
        </div>
        {guide?.guideRate != null && parseFloat(amount) > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">{L('Guide pricing', 'التسعير الإرشادي')}</p>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">{L('Rate', 'السعر')}</span><span className="font-bold tabular-nums">{formatCustomerNumber(guide.guideRate, lang, 4)} EGP/QAR</span></div>
            {guide.guideTotal != null && <div className="flex justify-between text-sm"><span className="text-muted-foreground">{L('You receive (est.)', 'تستلم (تقديري)')}</span><span className="font-bold tabular-nums text-emerald-600">{formatCustomerNumber(guide.guideTotal, lang, 0)} EGP</span></div>}
            <p className="text-[10px] text-muted-foreground">{L('Final rate set by merchant', 'السعر النهائي يحدده التاجر')}</p>
          </div>
        )}
        <button onClick={() => create.mutate()} disabled={create.isPending || !merchantId || !amount} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{L('Place Order', 'تقديم الطلب')}
        </button>
      </div>
    </div>
  );
}

// ── Order Detail ──────────────────────────────────────────────────────────────
function OrderDetail({ order, userId, lang, onClose, onUpdated }: {
  order: CustomerOrderRow; userId: string; lang: 'en' | 'ar'; onClose: () => void; onUpdated: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const meta = deriveCustomerOrderMeta(order);
  const rate = getDisplayedCustomerRate(order);
  const total = getDisplayedCustomerTotal(order);
  const { label: statusLabel, cls: statusCls } = customerStatus(order.status, lang);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const qc = useQueryClient();
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);

  const reject = useMutation({ mutationFn: () => rejectCustomerQuote(order, userId, rejectReason), onSuccess: () => { toast.success(L('Rejected', 'تم الرفض')); setShowReject(false); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onUpdated(); }, onError: (e: any) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: () => cancelCustomerOrder(order, userId), onSuccess: () => { toast.success(L('Order cancelled', 'تم إلغاء الطلب')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onClose(); }, onError: (e: any) => toast.error(e.message) });

  const approved = ['completed', 'quote_accepted', 'awaiting_payment', 'payment_sent'].includes(order.status);
  const canCancel = ['pending_quote', 'quoted'].includes(order.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="rounded-xl border border-border/50 p-2 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{meta.sendCurrency} → {meta.receiveCurrency}</h2>
          <p className="truncate text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <span className={cn('ms-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold', statusCls)}>{statusLabel}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border/60 px-2 py-1">{order.order_type.toUpperCase()}</span>
        {order.customer_cash_account_name && (
          <span className="rounded-full border border-border/60 px-2 py-1">
            Cash: {order.customer_cash_account_name}
          </span>
        )}
        {rate != null && (
          <span className="rounded-full border border-border/60 px-2 py-1">
            Rate {fmt(rate, 4)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{L('You sent (QAR)', 'أرسلت (QAR)')}</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{fmt(order.amount)}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{L('You receive (EGP)', 'تستلم (EGP)')}</p>
          <p className={cn('mt-1 text-2xl font-black tabular-nums', total != null ? 'text-emerald-600' : 'text-muted-foreground')}>
            {total != null ? fmt(total) : '—'}
          </p>
        </div>
      </div>

      {rate != null && (
        <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{L('FX Rate', 'سعر الصرف')}</span>
          <span className="text-sm font-bold tabular-nums">{fmt(rate, 4)} EGP/QAR</span>
        </div>
      )}

      {approved ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">{L('Approved order', 'طلب معتمد')}</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Final rate', 'السعر النهائي')}</span>
            <span className="font-bold tabular-nums">{order.final_rate != null ? fmt(order.final_rate, 4) : rate != null ? fmt(rate, 4) : '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Final total', 'الإجمالي النهائي')}</span>
            <span className="font-bold tabular-nums text-emerald-600">{order.final_total != null ? fmt(order.final_total) : total != null ? fmt(total) : '—'}</span>
          </div>
          {order.final_quote_note && <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">{order.final_quote_note}</p>}
        </div>
      ) : (
        order.status === 'quoted' && (
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{L('Merchant approval request', 'طلب موافقة التاجر')}</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Rate', 'السعر')}</span>
              <span className="font-bold tabular-nums">{order.final_rate != null ? fmt(order.final_rate, 4) : '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Total', 'الإجمالي')}</span>
              <span className="font-bold tabular-nums text-emerald-600">{order.final_total != null ? fmt(order.final_total) : '—'}</span>
            </div>
            {order.final_quote_note && <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">{order.final_quote_note}</p>}
          </div>
        )
      )}

      <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{L('Created', 'تاريخ الإنشاء')}</span>
          <span>{formatCustomerDate(order.created_at, lang)}</span>
        </div>
        {order.customer_cash_account_name && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{L('Cash account', 'حساب النقد')}</span>
            <span>{order.customer_cash_account_name}</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {order.status === 'quoted' && (
          <>
            {!showReject ? (
              <button onClick={() => setShowReject(true)} className="flex h-11 w-full items-center justify-center rounded-xl border border-destructive/30 text-sm font-semibold text-destructive">{L('Reject', 'رفض')}</button>
            ) : (
              <div className="space-y-2">
                <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={L('Reason (optional)', 'السبب (اختياري)')} className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => setShowReject(false)} className="flex-1 h-10 rounded-xl border border-border/50 text-sm">{L('Cancel', 'إلغاء')}</button>
                  <button onClick={() => reject.mutate()} disabled={reject.isPending} className="flex-1 h-10 rounded-xl bg-destructive text-sm font-bold text-destructive-foreground disabled:opacity-50">{reject.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : L('Confirm', 'تأكيد')}</button>
                </div>
              </div>
            )}
          </>
        )}
        {canCancel && <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">{cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Cancel order', 'إلغاء الطلب')}</button>}
      </div>
    </div>
  );
}

// ── Main Orders Page ──────────────────────────────────────────────────────────
export default function CustomerOrdersPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNew, setShowNew] = useState(searchParams.get('new') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const qc = useQueryClient();

  const { data: orders = [], isLoading } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-orders', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerOrders(userId); return (data ?? []) as CustomerOrderRow[]; },
    enabled: !!userId, refetchInterval: 15_000,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-connections-orders', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`c-orders-rt-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` }, () => qc.invalidateQueries({ queryKey: ['c-orders', userId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  // Summary totals
  const summary = useMemo(() => {
    const completed = orders.filter(o => o.status === 'completed');
    const totalQar = completed.reduce((s, o) => s + (o.amount ?? 0), 0);
    const totalEgp = completed.reduce((s, o) => s + (Number(getDisplayedCustomerTotal(o)) || 0), 0);
    const avgFx = totalQar > 0 ? totalEgp / totalQar : null;
    return { totalQar, totalEgp, avgFx };
  }, [orders]);

  const needsAction = orders.filter(o => o.status === 'quoted');
  const dayGroups = useMemo(() => groupByDay(orders, lang), [orders, lang]);
  const selectedOrder = orders.find(o => o.id === selectedId) ?? null;

  if (selectedOrder) {
    return <OrderDetail order={selectedOrder} userId={userId!} lang={lang} onClose={() => { setSelectedId(null); setSearchParams({}); }} onUpdated={() => qc.invalidateQueries({ queryKey: ['c-orders', userId] })} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Orders', 'الطلبات')}</h1>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" />{L('New', 'جديد')}
        </button>
      </div>

      {/* Summary strip */}
      {orders.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-border/40">
            <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Sent (QAR)', 'مُرسَل')}</p><p className="text-base font-black tabular-nums">{fmt(summary.totalQar)}</p></div>
            <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Received (EGP)', 'مُستلَم')}</p><p className="text-base font-black tabular-nums text-emerald-600">{fmt(summary.totalEgp)}</p></div>
            <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Avg FX', 'متوسط السعر')}</p><p className="text-base font-black tabular-nums">{summary.avgFx != null ? fmt(summary.avgFx, 4) : '—'}</p></div>
          </div>
        </div>
      )}

      {/* Action needed */}
      {needsAction.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">{needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}</p>
            <p className="text-xs text-muted-foreground">
              {needsAction.length > 0 && L('Review quotes', 'راجع العروض')}
            </p>
          </div>
        </div>
      )}

      {/* Orders grouped by day */}
      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : dayGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 py-12 text-center">
          <p className="text-sm text-muted-foreground">{L('No orders yet', 'لا توجد طلبات')}</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-primary font-medium">{L('Place your first order →', 'قدّم طلبك الأول →')}</button>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map(group => (
            <div key={group.date}>
              {/* Day divider */}
              <div className="flex items-center gap-3 mb-2">
                <div className="h-px flex-1 bg-border/40" />
                <span className="text-[11px] font-semibold text-muted-foreground">{group.label}</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <div className="space-y-2">
                {group.orders.map(o => {
                  const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
                  const total = getDisplayedCustomerTotal(o);
                  const rate  = getDisplayedCustomerRate(o);
                  const { label: sLabel, cls: sCls } = customerStatus(o.status, lang);
                  const isActionable = o.status === 'quoted';
                  return (
                    <button key={o.id} onClick={() => setSelectedId(o.id)}
                      className={cn('flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left active:scale-[0.99]', isActionable ? 'border-amber-500/30' : 'border-border/50')}>
                      <div className="flex-1 min-w-0">
                        {/* QAR → EGP visual hierarchy */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{fmt(o.amount)} QAR</span>
                          {total != null && <span className="text-sm font-bold text-emerald-600">→ {fmt(total)} EGP</span>}
                          {rate != null && <span className="text-[11px] text-muted-foreground tabular-nums">@ {fmt(rate, 4)}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', sCls)}>{sLabel}</span>
                          {isActionable && <AlertCircle className="h-3 w-3 text-amber-500" />}
                          {o.customer_cash_account_name && <span className="text-[11px] text-muted-foreground">{o.customer_cash_account_name}</span>}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New order modal */}
      {showNew && connections.length > 0 && (
        <NewOrderForm connections={connections as any[]} userId={userId!} lang={lang} onClose={() => setShowNew(false)} onCreated={() => setShowNew(false)} />
      )}
      {showNew && connections.length === 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center space-y-3">
            <p className="text-sm font-semibold">{L('No merchants connected', 'لا يوجد تجار مرتبطون')}</p>
            <p className="text-xs text-muted-foreground">{L('Connect a merchant first.', 'قم بربط تاجر أولاً.')}</p>
            <button onClick={() => setShowNew(false)} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">{L('OK', 'حسناً')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
