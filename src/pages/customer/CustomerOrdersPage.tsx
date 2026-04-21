import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, Plus, Upload, X, AlertCircle, CheckCircle2, Clock, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  acceptCustomerQuote, cancelCustomerOrder, createCustomerOrderWithGuide,
  deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber,
  getCompatibleRails, getCurrencyForCountry, getDisplayedCustomerRate,
  getDisplayedCustomerTotal, getGuidePricingForCustomerOrder,
  listCustomerConnections, listCustomerOrders, markCustomerOrderPaymentSent,
  rejectCustomerQuote, CUSTOMER_COUNTRIES,
  type CustomerCountry, type CustomerOrderRow,
} from '@/features/customer/customer-portal';

// ── Status config ─────────────────────────────────────────────────────────────
const S: Record<string, { en: string; ar: string; cls: string }> = {
  pending_quote:    { en: 'Awaiting quote',  ar: 'بانتظار العرض',  cls: 'bg-amber-500/10 text-amber-600' },
  quoted:           { en: 'Quote ready',     ar: 'العرض جاهز',     cls: 'bg-blue-500/10 text-blue-600' },
  quote_accepted:   { en: 'Accepted',        ar: 'مقبول',          cls: 'bg-emerald-500/10 text-emerald-600' },
  quote_rejected:   { en: 'Rejected',        ar: 'مرفوض',          cls: 'bg-red-500/10 text-red-500' },
  awaiting_payment: { en: 'Send payment',    ar: 'أرسل الدفعة',    cls: 'bg-orange-500/10 text-orange-600' },
  payment_sent:     { en: 'Payment sent',    ar: 'تم الإرسال',     cls: 'bg-blue-500/10 text-blue-600' },
  completed:        { en: 'Completed',       ar: 'مكتمل',          cls: 'bg-emerald-500/10 text-emerald-600' },
  cancelled:        { en: 'Cancelled',       ar: 'ملغي',           cls: 'bg-muted text-muted-foreground' },
};

// ── Timeline steps ────────────────────────────────────────────────────────────
const STEPS = [
  { key: 'pending_quote',    en: 'Order placed',      ar: 'تم تقديم الطلب' },
  { key: 'quoted',           en: 'Quote received',    ar: 'تم استلام العرض' },
  { key: 'quote_accepted',   en: 'Quote accepted',    ar: 'تم قبول العرض' },
  { key: 'awaiting_payment', en: 'Send payment',      ar: 'أرسل الدفعة' },
  { key: 'payment_sent',     en: 'Payment sent',      ar: 'تم إرسال الدفعة' },
  { key: 'completed',        en: 'Completed',         ar: 'مكتمل' },
];

const STEP_ORDER = STEPS.map(s => s.key);

function stepIndex(status: string) {
  const i = STEP_ORDER.indexOf(status);
  return i === -1 ? 0 : i;
}

// ── New Order Form ────────────────────────────────────────────────────────────
function NewOrderForm({ connections, userId, lang, onClose, onCreated }: {
  connections: any[]; userId: string; lang: 'en' | 'ar';
  onClose: () => void; onCreated: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [merchantId, setMerchantId] = useState(connections[0]?.merchant_id ?? '');
  const [amount, setAmount]         = useState('');
  const [receiveCountry, setReceiveCountry] = useState<CustomerCountry>('Egypt');
  const [payoutRail, setPayoutRail] = useState('bank_transfer');
  const [note, setNote]             = useState('');
  const sendCountry: CustomerCountry = 'Qatar';
  const sendCurrency = getCurrencyForCountry(sendCountry);
  const receiveCurrency = getCurrencyForCountry(receiveCountry);
  const rails = getCompatibleRails(sendCountry, receiveCountry);

  const { data: guide } = useQuery({
    queryKey: ['c-guide-form', amount, sendCountry, receiveCountry],
    queryFn: () => getGuidePricingForCustomerOrder({
      customerUserId: userId, merchantId, connectionId: '',
      orderType: 'buy', amount: parseFloat(amount) || 0,
      rate: null, note: null, sendCountry, receiveCountry,
      sendCurrency, receiveCurrency,
      payoutRail, corridorLabel: `${sendCountry} -> ${receiveCountry}`,
    }),
    enabled: !!amount && parseFloat(amount) > 0,
    staleTime: 60_000,
  });

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async () => {
      if (!merchantId || !amount || parseFloat(amount) <= 0)
        throw new Error(L('Enter amount and select merchant', 'أدخل المبلغ واختر التاجر'));
      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error(L('Merchant not found', 'التاجر غير موجود'));
      const { error } = await createCustomerOrderWithGuide({
        customerUserId: userId, merchantId, connectionId: conn.id,
        orderType: 'buy', amount: parseFloat(amount),
        rate: null, note: note.trim() || null,
        sendCountry, receiveCountry, sendCurrency, receiveCurrency,
        payoutRail, corridorLabel: `${sendCountry} -> ${receiveCountry}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L('Order placed', 'تم تقديم الطلب'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{L('New Order', 'طلب جديد')}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Corridor badge */}
        <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
          <span className="text-sm font-semibold text-primary">QAR → EGP</span>
          <span className="text-xs text-muted-foreground">{L('Qatar to Egypt', 'قطر إلى مصر')}</span>
        </div>

        {/* Merchant */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Merchant', 'التاجر')}</label>
          <select value={merchantId} onChange={e => setMerchantId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {connections.map((c: any) => (
              <option key={c.merchant_id} value={c.merchant_id}>
                {c.merchant?.display_name ?? c.merchant_id}
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {L('Amount to send (QAR)', 'المبلغ المُرسَل (QAR)')}
          </label>
          <div className="relative">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" placeholder="0"
              className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 pe-16 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
          </div>
        </div>

        {/* Guide pricing */}
        {guide?.guideRate != null && parseFloat(amount) > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
              {L('Guide pricing (market estimate)', 'التسعير الإرشادي (تقدير السوق)')}
            </p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Rate', 'السعر')}</span>
              <span className="font-bold tabular-nums">{formatCustomerNumber(guide.guideRate, lang, 4)} EGP/QAR</span>
            </div>
            {guide.guideTotal != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{L('You receive (est.)', 'تستلم (تقديري)')}</span>
                <span className="font-bold tabular-nums text-emerald-600">
                  {formatCustomerNumber(guide.guideTotal, lang, 0)} EGP
                </span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              {L('Final rate set by merchant', 'السعر النهائي يحدده التاجر')}
            </p>
          </div>
        )}

        {/* Payout rail */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {L('Receive via', 'استلام عبر')}
          </label>
          <select value={payoutRail} onChange={e => setPayoutRail(e.target.value)}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {rails.map(r => (
              <option key={r.value} value={r.value}>
                {r.value === 'bank_transfer' ? L('Bank Transfer', 'تحويل بنكي') :
                 r.value === 'mobile_wallet' ? L('Mobile Wallet (InstaPay/VCash)', 'محفظة موبايل (InstaPay/VCash)') :
                 r.value === 'cash_pickup'   ? L('Cash Pickup', 'استلام نقدي') :
                 r.value === 'instant_bank'  ? L('Instant Bank', 'تحويل فوري') :
                 r.value}
              </option>
            ))}
          </select>
        </div>

        {/* Note */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {L('Note', 'ملاحظة')} <span className="text-muted-foreground/60">({L('optional', 'اختياري')})</span>
          </label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder={L('e.g. InstaPay account: 01xxxxxxxxx', 'مثال: حساب InstaPay: 01xxxxxxxxx')}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>

        <button onClick={() => create.mutate()} disabled={create.isPending || !merchantId || !amount}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {L('Place Order', 'تقديم الطلب')}
        </button>
      </div>
    </div>
  );
}

// ── Order Detail ──────────────────────────────────────────────────────────────
function OrderDetail({ order, userId, lang, onClose, onUpdated }: {
  order: CustomerOrderRow; userId: string; lang: 'en' | 'ar';
  onClose: () => void; onUpdated: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const meta = deriveCustomerOrderMeta(order);
  const rate = getDisplayedCustomerRate(order);
  const total = getDisplayedCustomerTotal(order);
  const cfg = S[order.status] ?? S.pending_quote;
  const currentStep = stepIndex(order.status);
  const [uploading, setUploading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const accept = useMutation({
    mutationFn: () => acceptCustomerQuote(order, userId),
    onSuccess: () => { toast.success(L('Quote accepted', 'تم قبول العرض')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onUpdated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: () => rejectCustomerQuote(order, userId, rejectReason),
    onSuccess: () => { toast.success(L('Quote rejected', 'تم رفض العرض')); setShowReject(false); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onUpdated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const markSent = useMutation({
    mutationFn: () => markCustomerOrderPaymentSent(order, userId),
    onSuccess: () => { toast.success(L('Payment marked as sent', 'تم تحديد الدفعة كمُرسَلة')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onUpdated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelCustomerOrder(order, userId),
    onSuccess: () => { toast.success(L('Order cancelled', 'تم إلغاء الطلب')); qc.invalidateQueries({ queryKey: ['c-orders', userId] }); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const uploadProof = async (file: File) => {
    setUploading(true);
    try {
      const path = `${userId}/${order.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('customer-payment-proofs').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('customer-payment-proofs').getPublicUrl(path);
      const { error: updErr } = await supabase.from('customer_orders').update({ payment_proof_url: publicUrl }).eq('id', order.id);
      if (updErr) throw updErr;
      toast.success(L('Proof uploaded', 'تم رفع الإثبات'));
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
      onUpdated();
    } catch (e: any) {
      toast.error(e.message ?? L('Upload failed', 'فشل الرفع'));
    } finally { setUploading(false); }
  };

  const canCancel = ['pending_quote', 'quoted', 'quote_rejected'].includes(order.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="rounded-xl border border-border/50 p-2 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-base font-bold">{meta.sendCurrency} → {meta.receiveCurrency}</h2>
          <p className="text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <span className={cn('ms-auto rounded-full px-3 py-1 text-xs font-semibold', cfg.cls)}>
          {lang === 'ar' ? cfg.ar : cfg.en}
        </span>
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{L('You send', 'تُرسِل')}</p>
          <p className="mt-1 text-xl font-black tabular-nums">{formatCustomerNumber(order.amount, lang, 0)}</p>
          <p className="text-xs text-muted-foreground">{meta.sendCurrency}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{L('You receive', 'تستلم')}</p>
          <p className={cn('mt-1 text-xl font-black tabular-nums', total != null ? 'text-emerald-600' : 'text-muted-foreground')}>
            {total != null ? formatCustomerNumber(total, lang, 0) : '—'}
          </p>
          <p className="text-xs text-muted-foreground">{meta.receiveCurrency}</p>
        </div>
      </div>

      {/* Rate + rail */}
      {(rate != null || order.payout_rail) && (
        <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 space-y-2">
          {rate != null && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Rate', 'السعر')}</span>
              <span className="font-semibold tabular-nums">{formatCustomerNumber(rate, lang, 4)} EGP/QAR</span>
            </div>
          )}
          {order.payout_rail && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Receive via', 'استلام عبر')}</span>
              <span className="font-semibold">{order.payout_rail.replace(/_/g, ' ')}</span>
            </div>
          )}
          {order.note && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('Note', 'ملاحظة')}</span>
              <span className="font-medium text-end max-w-[60%]">{order.note}</span>
            </div>
          )}
        </div>
      )}

      {/* Quote details */}
      {order.status === 'quoted' && order.final_rate != null && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{L('Merchant Quote', 'عرض التاجر')}</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{L('Rate offered', 'السعر المعروض')}</span>
            <span className="font-bold tabular-nums">{formatCustomerNumber(order.final_rate, lang, 4)} EGP/QAR</span>
          </div>
          {order.final_total != null && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{L('You will receive', 'ستستلم')}</span>
              <span className="font-bold tabular-nums text-emerald-600">{formatCustomerNumber(order.final_total, lang, 0)} EGP</span>
            </div>
          )}
          {order.final_quote_note && (
            <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">{order.final_quote_note}</p>
          )}
        </div>
      )}

      {/* Payment instructions */}
      {order.status === 'awaiting_payment' && (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
            {L('Payment Instructions', 'تعليمات الدفع')}
          </p>
          <p className="text-sm text-foreground">
            {L(
              `Send ${formatCustomerNumber(order.amount, 'en', 0)} QAR to your merchant via ${order.payout_rail?.replace(/_/g, ' ') ?? 'agreed method'}, then upload proof below.`,
              `أرسل ${formatCustomerNumber(order.amount, 'ar', 0)} QAR إلى التاجر عبر ${order.payout_rail?.replace(/_/g, ' ') ?? 'الطريقة المتفق عليها'}، ثم ارفع الإثبات أدناه.`
            )}
          </p>
          {order.note && <p className="text-xs text-muted-foreground">{L('Note', 'ملاحظة')}: {order.note}</p>}
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-2xl border border-border/50 bg-card px-4 py-3">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Progress', 'التقدم')}</p>
        <div className="space-y-2">
          {STEPS.map((step, i) => {
            const done = i <= currentStep && !['cancelled','quote_rejected'].includes(order.status);
            const active = i === currentStep && !['cancelled','quote_rejected'].includes(order.status);
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
                  active && 'ring-2 ring-emerald-500/30',
                )}>
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className={cn('text-sm', done ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                  {lang === 'ar' ? step.ar : step.en}
                </span>
              </div>
            );
          })}
          {['cancelled','quote_rejected'].includes(order.status) && (
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold">✕</div>
              <span className="text-sm text-red-500">{lang === 'ar' ? S[order.status]?.ar : S[order.status]?.en}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {/* Quote: accept/reject */}
        {order.status === 'quoted' && (
          <>
            <button onClick={() => accept.mutate()} disabled={accept.isPending}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-white disabled:opacity-50">
              {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {L('Accept Quote', 'قبول العرض')}
            </button>
            {!showReject ? (
              <button onClick={() => setShowReject(true)}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-destructive/30 text-sm font-semibold text-destructive">
                {L('Reject Quote', 'رفض العرض')}
              </button>
            ) : (
              <div className="space-y-2">
                <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder={L('Reason (optional)', 'السبب (اختياري)')}
                  className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => setShowReject(false)} className="flex-1 h-10 rounded-xl border border-border/50 text-sm font-medium">
                    {L('Cancel', 'إلغاء')}
                  </button>
                  <button onClick={() => reject.mutate()} disabled={reject.isPending}
                    className="flex-1 h-10 rounded-xl bg-destructive text-sm font-bold text-destructive-foreground disabled:opacity-50">
                    {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : L('Confirm Reject', 'تأكيد الرفض')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Awaiting payment: upload proof + mark sent */}
        {order.status === 'awaiting_payment' && (
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border/50 bg-card text-sm font-semibold disabled:opacity-50">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {order.payment_proof_url
                ? L('Replace proof', 'استبدال الإثبات')
                : L('Upload payment proof', 'رفع إثبات الدفع')}
            </button>
            {order.payment_proof_url && (
              <a href={order.payment_proof_url} target="_blank" rel="noopener noreferrer"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-sm font-medium text-emerald-600">
                {L('View uploaded proof', 'عرض الإثبات المرفوع')}
              </a>
            )}
            <button onClick={() => markSent.mutate()} disabled={markSent.isPending}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
              {markSent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {L('I have sent the payment', 'لقد أرسلت الدفعة')}
            </button>
          </>
        )}

        {/* Cancel */}
        {canCancel && (
          <button onClick={() => cancel.mutate()} disabled={cancel.isPending}
            className="flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">
            {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Cancel order', 'إلغاء الطلب')}
          </button>
        )}
      </div>

      {/* Dates */}
      <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{L('Created', 'تاريخ الإنشاء')}</span>
          <span>{formatCustomerDate(order.created_at, lang)}</span>
        </div>
        {order.updated_at !== order.created_at && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{L('Updated', 'آخر تحديث')}</span>
            <span>{formatCustomerDate(order.updated_at, lang)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomerOrdersPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNew, setShowNew] = useState(searchParams.get('new') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const qc = useQueryClient();

  const { data: orders = [], isLoading } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerOrders(userId);
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
    refetchInterval: 15_000,
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

  // Realtime
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`c-orders-rt-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `customer_user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ['c-orders', userId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const filtered = useMemo(() => {
    if (filter === 'active')    return orders.filter(o => !['completed','cancelled','quote_rejected'].includes(o.status));
    if (filter === 'completed') return orders.filter(o => o.status === 'completed');
    if (filter === 'cancelled') return orders.filter(o => ['cancelled','quote_rejected'].includes(o.status));
    return orders;
  }, [orders, filter]);

  const needsAction = orders.filter(o => ['quoted','awaiting_payment'].includes(o.status));
  const selectedOrder = orders.find(o => o.id === selectedId) ?? null;

  if (selectedOrder) {
    return (
      <OrderDetail
        order={selectedOrder} userId={userId!} lang={lang}
        onClose={() => { setSelectedId(null); setSearchParams({}); }}
        onUpdated={() => qc.invalidateQueries({ queryKey: ['c-orders', userId] })}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Orders', 'الطلبات')}</h1>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" />
          {L('New', 'جديد')}
        </button>
      </div>

      {/* Action needed */}
      {needsAction.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}
            </p>
            <p className="text-xs text-muted-foreground">
              {needsAction.filter(o => o.status === 'quoted').length > 0 && L('Review quotes · ', 'راجع العروض · ')}
              {needsAction.filter(o => o.status === 'awaiting_payment').length > 0 && L('Send payment', 'أرسل الدفعة')}
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {(['all','active','completed','cancelled'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors',
              filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
            {f === 'all'       ? L('All', 'الكل') :
             f === 'active'    ? L('Active', 'نشط') :
             f === 'completed' ? L('Done', 'مكتمل') :
                                 L('Cancelled', 'ملغي')}
          </button>
        ))}
      </div>

      {/* Order list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">{L('No orders', 'لا توجد طلبات')}</p>
          {filter === 'all' && (
            <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-primary font-medium">
              {L('Place your first order →', 'قدّم طلبك الأول →')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(o => {
            const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
            const total = getDisplayedCustomerTotal(o);
            const rate = getDisplayedCustomerRate(o);
            const cfg = S[o.status] ?? S.pending_quote;
            const isActionable = ['quoted','awaiting_payment'].includes(o.status);
            return (
              <button key={o.id} onClick={() => setSelectedId(o.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-all active:scale-[0.99]',
                  isActionable ? 'border-amber-500/30' : 'border-border/50',
                )}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-foreground">
                      {formatCustomerNumber(o.amount, lang, 0)} {meta.sendCurrency}
                    </span>
                    {total != null && (
                      <span className="text-sm font-bold text-emerald-600">
                        → {formatCustomerNumber(total, lang, 0)} {meta.receiveCurrency}
                      </span>
                    )}
                    {isActionable && <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.cls)}>
                      {lang === 'ar' ? cfg.ar : cfg.en}
                    </span>
                    {rate != null && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatCustomerNumber(rate, lang, 4)}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {formatCustomerDate(o.created_at, lang)}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* New order modal */}
      {showNew && connections.length > 0 && (
        <NewOrderForm
          connections={connections as any[]} userId={userId!} lang={lang}
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
        />
      )}
      {showNew && connections.length === 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-background p-6 text-center space-y-3">
            <p className="text-sm font-semibold">{L('No merchants connected', 'لا يوجد تجار مرتبطون')}</p>
            <p className="text-xs text-muted-foreground">{L('Connect a merchant first to place orders.', 'قم بربط تاجر أولاً لتقديم الطلبات.')}</p>
            <button onClick={() => setShowNew(false)} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
              {L('OK', 'حسناً')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
