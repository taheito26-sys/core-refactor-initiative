import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { formatCustomerNumber } from '@/features/customer/customer-portal';
import type { WorkflowOrder } from '@/features/orders/shared-order-workflow';

interface OrderVerificationModalProps {
  order: WorkflowOrder;
  lang: 'en' | 'ar';
  onClose: () => void;
}

export function OrderVerificationModal({ order, lang, onClose }: OrderVerificationModalProps) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const qc = useQueryClient();
  const isRTL = lang === 'ar';

  const [amountReceived, setAmountReceived] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [isAmountCorrect, setIsAmountCorrect] = useState<boolean | null>(null);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [fundConfirmed, setFundConfirmed] = useState(false);

  const expectedAmount = order.fx_rate ? Math.round(order.amount * order.fx_rate) : 0;
  const receivedAmount = amountReceived ? parseFloat(amountReceived) : 0;
  const discrepancy = Math.abs(receivedAmount - expectedAmount);
  const discrepancyPercent = expectedAmount > 0 ? (discrepancy / expectedAmount) * 100 : 0;

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('verify_customer_order_receipt', {
        p_order_id: order.id,
        p_is_amount_correct: isAmountCorrect,
        p_amount_received: receivedAmount || null,
        p_bank_reference: bankReference || null,
        p_verification_notes: verificationNotes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(L('Order verified successfully', 'تم التحقق من الطلب بنجاح'));
      qc.invalidateQueries({ queryKey: ['c-orders'] });
      onClose();
    },
    onError: (e: any) => {
      toast.error(e?.message || L('Verification failed', 'فشل التحقق'));
    },
  });

  const canSubmit = fundConfirmed && isAmountCorrect !== null && amountReceived && bankReference;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/30 p-4">
          <p className="font-bold text-sm flex items-center gap-2">
            ✓ {L('Verify Order Receipt', 'التحقق من استلام الطلب')}
          </p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Order Summary */}
          <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">{L('Expected Amount', 'المبلغ المتوقع')}</span>
              <span className="text-sm font-bold">{formatCustomerNumber(expectedAmount, lang, 0)} {order.receive_currency || 'EGP'}</span>
            </div>
            {order.fx_rate && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">{order.amount} {order.send_currency} × {formatCustomerNumber(order.fx_rate, lang, 2)}</span>
              </div>
            )}
          </div>

          {/* Fund Received Confirmation */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground block">
              {L('Step 1: Confirm Fund Receipt', 'الخطوة 1: تأكيد استلام الأموال')}
            </label>
            <div className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-3 cursor-pointer transition-colors',
              fundConfirmed
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-border/50 hover:border-primary/30'
            )}>
              <input
                type="checkbox"
                checked={fundConfirmed}
                onChange={(e) => setFundConfirmed(e.target.checked)}
                className="h-5 w-5 rounded cursor-pointer"
              />
              <span className="text-sm font-medium">
                {L('I have received the funds in my bank account', 'لقد استلمت الأموال في حسابي البنكي')}
              </span>
            </div>
          </div>

          {fundConfirmed && (
            <>
              {/* Amount Received */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block">
                  {L('Step 2: Amount Received', 'الخطوة 2: المبلغ المستلم')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    placeholder={String(expectedAmount)}
                    className="h-11 flex-1 rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex items-center px-3 rounded-xl border border-border/50 bg-muted/30 text-sm font-medium">
                    {order.receive_currency || 'EGP'}
                  </div>
                </div>

                {/* Discrepancy Warning */}
                {receivedAmount > 0 && Math.abs(receivedAmount - expectedAmount) > 0.01 && (
                  <div className={cn(
                    'flex gap-2 rounded-lg p-2 text-xs',
                    discrepancyPercent > 5
                      ? 'bg-red-500/10 text-red-600'
                      : 'bg-amber-500/10 text-amber-600'
                  )}>
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>
                      {L('Discrepancy detected:', 'تم اكتشاف فرق:')} {formatCustomerNumber(discrepancy, lang, 0)} {order.receive_currency || 'EGP'} ({discrepancyPercent.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </div>

              {/* Bank Reference */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block">
                  {L('Bank Transaction Reference', 'مرجع معاملة البنك')}
                </label>
                <input
                  type="text"
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value)}
                  placeholder={L('e.g., TXN123456789', 'مثال: TXN123456789')}
                  className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Amount Correctness */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block">
                  {L('Step 3: Is the Amount Correct?', 'الخطوة 3: هل المبلغ صحيح؟')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsAmountCorrect(true)}
                    className={cn(
                      'h-11 rounded-xl border-2 font-semibold text-sm transition-colors',
                      isAmountCorrect === true
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600'
                        : 'border-border/50 hover:border-emerald-500/30'
                    )}
                  >
                    <CheckCircle className="h-4 w-4 inline mr-1" />
                    {L('Yes, Correct', 'نعم، صحيح')}
                  </button>
                  <button
                    onClick={() => setIsAmountCorrect(false)}
                    className={cn(
                      'h-11 rounded-xl border-2 font-semibold text-sm transition-colors',
                      isAmountCorrect === false
                        ? 'border-red-500/50 bg-red-500/10 text-red-600'
                        : 'border-border/50 hover:border-red-500/30'
                    )}
                  >
                    <AlertCircle className="h-4 w-4 inline mr-1" />
                    {L('No, Discrepancy', 'لا، هناك فرق')}
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block">
                  {L('Additional Notes (Optional)', 'ملاحظات إضافية (اختياري)')}
                </label>
                <textarea
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  placeholder={L('e.g., Received on date X, reference Y...', 'مثال: تم الاستلام في التاريخ X...')}
                  rows={3}
                  className="w-full rounded-xl border border-border/50 bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Summary */}
              {isAmountCorrect !== null && (
                <div className={cn(
                  'rounded-xl border-2 p-3',
                  isAmountCorrect === true
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                )}>
                  <div className="text-xs font-medium mb-1 flex items-center gap-2">
                    {isAmountCorrect === true ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <span className="text-emerald-700">{L('Order verified ✓', 'تم التحقق من الطلب ✓')}</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <span className="text-red-700">{L('Amount discrepancy reported', 'تم الإبلاغ عن فرق في المبلغ')}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isAmountCorrect === true
                      ? L('Funds received and verified. Thank you!', 'تم استلام الأموال والتحقق منها. شكراً!')
                      : L('Please contact merchant to resolve discrepancy', 'يرجى التواصل مع التاجر لحل الفرق')}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border/30 p-4 space-y-2">
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={!canSubmit || verifyMutation.isPending}
            className={cn(
              'w-full h-11 rounded-xl font-semibold text-sm transition-colors',
              canSubmit && !verifyMutation.isPending
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            )}
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                {L('Verifying...', 'جاري التحقق...')}
              </>
            ) : (
              L('Confirm Verification', 'تأكيد التحقق')
            )}
          </button>
          <button
            onClick={onClose}
            className="w-full h-11 rounded-xl border border-border/50 font-semibold text-sm hover:bg-muted transition-colors"
          >
            {L('Cancel', 'إلغاء')}
          </button>
        </div>
      </div>
    </div>
  );
}
