import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronRight, Check, Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import OrderDetailView from './components/OrderDetailView';
import {
  acceptCustomerQuote, createCustomerOrder, createCustomerOrderWithGuide,
  deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber,
  getCompatibleRails, getCurrencyForCountry, getDisplayedCustomerRate,
  getDisplayedCustomerTotal, getGuidePricingForCustomerOrder,
  listCustomerConnections, listCustomerOrders, rejectCustomerQuote,
  CUSTOMER_COUNTRIES, type CustomerCountry, type CustomerOrderRow,
} from '@/features/customer/customer-portal';

const STATUS_COLOR: Record<string, string> = {
  completed:      'bg-emerald-500/10 text-emerald-600',
  cancelled:      'bg-red-500/10 text-red-600',
  quote_rejected: 'bg-red-500/10 text-red-600',
  quoted:         'bg-blue-500/10 text-blue-600',
  default:        'bg-amber-500/10 text-amber-600',
};

function statusColor(s: string) {
  return STATUS_COLOR[s] ?? STATUS_COLOR.default;
}

export default function CustomerOrdersPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const qc = useQueryClient();
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;

  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Form state
  const [orderType,     setOrderType]     = useState<'buy' | 'sell'>('buy');
  const [merchantId,    setMerchantId]    = useState('');
  const [amount,        setAmount]        = useState('');
  const [rate,          setRate]          = useState('');
  const [note,          setNote]          = useState('');
  const [sendCountry,   setSendCountry]   = useState<CustomerCountry>(customerProfile?.country as CustomerCountry ?? CUSTOMER_COUNTRIES[0]);
  const [receiveCountry,setReceiveCountry]= useState<CustomerCountry>(CUSTOMER_COUNTRIES[1]);
  const [payoutRail,    setPayoutRail]    = useState('bank_transfer');

  const sendCurrency    = getCurrencyForCountry(sendCountry);
  const receiveCurrency = getCurrencyForCountry(receiveCountry);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['c-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerOrders(userId);
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-connections-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerConnections(userId);
      return (data ?? []).filter((c: any) => c.status === 'active');
    },
    enabled: !!userId,
  });

  const { data: guide } = useQuery({
    queryKey: ['c-guide', sendCountry, receiveCountry, amount, orderType],
    queryFn: () => getGuidePricingForCustomerOrder({ orderType, sendCountry, receiveCountry, amount: parseFloat(amount) || 0 }),
    enabled: showForm && orderType === 'buy' && !!amount && parseFloat(amount) > 0,
    staleTime: 60_000,
  });

  const rails = useMemo(() => getCompatibleRails(sendCountry, receiveCountry), [sendCountry, receiveCountry]);

  useEffect(() => {
    if (rails.length > 0 && !rails.find(r => r.value === payoutRail)) {
      setPayoutRail(rails[0].value);
    }
  }, [rails, payoutRail]);

  // Open form from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('c_open_order_form') === '1') {
      localStorage.removeItem('c_open_order_form');
      setShowForm(true);
    }
  }, []);

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!userId || !merchantId || !amount) throw new Error(L('Fill all fields', 'أكمل الحقول'));
      const connection = (connections as any[]).find((c: any) => c.merchant_id === merchantId);
      if (!connection) throw new Error(L('Merchant not found', 'التاجر غير موجود'));
      const base = {
        userId, merchantId, connectionId: connection.id,
        orderType, amount: parseFloat(amount),
        currency: sendCurrency, sendCountry, receiveCountry,
        payoutRail, note: note.trim() || null,
      };
      if (orderType === 'buy') {
        await createCustomerOrderWithGuide(base);
      } else {
        await createCustomerOrder({ ...base, rate: parseFloat(rate) || null });
      }
    },
    onSuccess: () => {
      toast.success(L('Order created', 'تم إنشاء الطلب'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
      setShowForm(false);
      setAmount(''); setRate(''); setNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const acceptQuote = useMutation({
    mutationFn: (order: CustomerOrderRow) => acceptCustomerQuote(order, userId!),
    onSuccess: () => { toast.success(L('Quote accepted', 'تم قبول العرض')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectQuote = useMutation({
    mutationFn: (order: CustomerOrderRow) => rejectCustomerQuote(order, userId!, ''),
    onSuccess: () => { toast.success(L('Quote rejected', 'تم رفض العرض')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const detailOrder = orders.find(o => o.id === detailId) ?? null;
  if (detailOrder) {
    return <OrderDetailView order={detailOrder} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Orders', 'الطلبات')}</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
            showForm ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? L('Cancel', 'إلغاء') : L('New', 'جديد')}
        </button>
      </div>

      {/* New order form */}
      {showForm && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {L('New Order', 'طلب جديد')}
            </p>
          </div>
          <div className="px-4 py-4 space-y-4">
            {/* Buy / Sell toggle */}
            <div className="flex rounded-xl bg-muted p-1 gap-1">
              {(['buy', 'sell'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors',
                    orderType === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {t === 'buy'
                    ? <><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />{L('Buy', 'شراء')}</>
                    : <><ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />{L('Sell', 'بيع')}</>}
                </button>
              ))}
            </div>

            {/* Merchant */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Merchant', 'التاجر')}</label>
              <select
                value={merchantId}
                onChange={e => setMerchantId(e.target.value)}
                className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{L('Select…', 'اختر…')}</option>
                {(connections as any[]).map((c: any) => (
                  <option key={c.merchant_id} value={c.merchant_id}>
                    {c.merchant?.display_name ?? c.merchant_id}
                  </option>
                ))}
              </select>
            </div>

            {/* Countries */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('From', 'من')}</label>
                <select
                  value={sendCountry}
                  onChange={e => setSendCountry(e.target.value as CustomerCountry)}
                  className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {CUSTOMER_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('To', 'إلى')}</label>
                <select
                  value={receiveCountry}
                  onChange={e => setReceiveCountry(e.target.value as CustomerCountry)}
                  className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {CUSTOMER_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {L('Amount', 'المبلغ')} ({sendCurrency})
              </label>
              <input
                value={amount}
                onChange={e => setAmount(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Rate (sell only) */}
            {orderType === 'sell' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Rate', 'السعر')}</label>
                <input
                  value={rate}
                  onChange={e => setRate(e.target.value)}
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="0.0000"
                  className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {/* Guide pricing (buy only) */}
            {orderType === 'buy' && guide?.guideRate != null && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide">
                  {L('Guide pricing', 'التسعير الإرشادي')}
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{L('Rate', 'السعر')}</span>
                  <span className="font-semibold tabular-nums">{formatCustomerNumber(guide.guideRate, lang, 4)}</span>
                </div>
                {guide.guideTotal != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{L('You receive', 'تستلم')}</span>
                    <span className="font-semibold tabular-nums text-emerald-600">
                      {formatCustomerNumber(guide.guideTotal, lang, 2)} {receiveCurrency}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Rail */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Payout method', 'طريقة الدفع')}</label>
              <select
                value={payoutRail}
                onChange={e => setPayoutRail(e.target.value)}
                className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                {rails.map(r => <option key={r.value} value={r.value}>{r.value.replace(/_/g, ' ')}</option>)}
              </select>
            </div>

            {/* Note */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {L('Note', 'ملاحظة')} <span className="text-muted-foreground/60">({L('optional', 'اختياري')})</span>
              </label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <button
              onClick={() => createOrder.mutate()}
              disabled={createOrder.isPending || !merchantId || !amount}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {createOrder.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {L('Place order', 'تقديم الطلب')}
            </button>
          </div>
        </div>
      )}

      {/* Order list */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {L('No orders yet', 'لا توجد طلبات')}
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => {
            const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
            const rate = getDisplayedCustomerRate(o);
            const isQuoted = o.status === 'quoted';
            return (
              <div key={o.id} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <button
                  onClick={() => setDetailId(o.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {meta.sendCurrency} → {meta.receiveCurrency}
                      </span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', statusColor(o.status))}>
                        {o.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.amount} {o.currency}
                      {rate != null && ` · ${formatCustomerNumber(rate, lang, 4)}`}
                      {' · '}{formatCustomerDate(o.created_at, lang)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>

                {/* Quote actions */}
                {isQuoted && (
                  <div className="flex gap-2 border-t border-border/40 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      {o.final_rate != null && (
                        <p className="text-xs text-muted-foreground">
                          {L('Quoted rate', 'السعر المعروض')}: <span className="font-semibold text-foreground">{formatCustomerNumber(o.final_rate, lang, 4)}</span>
                        </p>
                      )}
                      {o.final_quote_note && (
                        <p className="text-xs text-muted-foreground truncate">{o.final_quote_note}</p>
                      )}
                    </div>
                    <button
                      onClick={() => rejectQuote.mutate(o)}
                      disabled={rejectQuote.isPending}
                      className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive"
                    >
                      {L('Reject', 'رفض')}
                    </button>
                    <button
                      onClick={() => acceptQuote.mutate(o)}
                      disabled={acceptQuote.isPending}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {L('Accept', 'قبول')}
                    </button>
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
