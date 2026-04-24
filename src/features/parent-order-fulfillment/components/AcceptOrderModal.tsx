/**
 * AcceptOrderModal
 *
 * Forces customer to link a cash account before approving any order.
 * If no cash accounts exist, shows inline 3-step creation flow.
 * Passes destination_cash_account_id to respondSharedOrder on approval.
 */

import { useState } from 'react';
import { Check, ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { respondSharedOrder } from '@/features/orders/shared-order-workflow';
import { useCashAccountsForUser } from '../hooks/useCashAccountsForUser';
import { cn } from '@/lib/utils';

interface AcceptOrderModalProps {
  orderId: string;
  receiveCurrency: string;
  egpAmount?: number | null; // delivered EGP amount to credit to cash account
  lang?: 'en' | 'ar';
  onClose: () => void;
  onSuccess: () => void;
}

export function AcceptOrderModal({
  orderId,
  receiveCurrency,
  egpAmount,
  lang = 'en',
  onClose,
  onSuccess,
}: AcceptOrderModalProps) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { accounts, isLoading: accountsLoading } = useCashAccountsForUser();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Inline account creation state
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('bank');
  const [newCurrency, setNewCurrency] = useState(receiveCurrency || 'EGP');

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newName.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));
      const newId = Math.random().toString(36).slice(2, 10);
      const { data, error } = await supabase.from('cash_accounts').insert({
        id: newId, user_id: userId, name: newName.trim(), type: newType, currency: newCurrency, status: 'active', created_at: Date.now(),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(L('Account created', 'تم إنشاء الحساب'));
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts-for-user', userId] });
      qc.invalidateQueries({ queryKey: ['c-cash-accounts', userId] });
      qc.invalidateQueries({ queryKey: ['c-cash-accounts-home', userId] });
      setSelectedId(data.id);
      setCreating(false);
      setStep(1); setNewName(''); setNewType('bank'); setNewCurrency(receiveCurrency || 'EGP');
    },
    onError: (e: any) => toast.error(e?.message ?? L('Failed', 'فشل')),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error(L('Select a cash account first', 'اختر حساباً نقدياً أولاً'));

      // 1. Approve the order
      const result = await respondSharedOrder({ orderId, actorRole: 'customer', action: 'approve' });

      // 2. Write cash ledger entry to credit the selected account
      const creditAmount = egpAmount ?? (result as any)?.amount ?? 0;
      if (creditAmount > 0 && userId) {
        await supabase.from('cash_ledger').insert({
          user_id: userId,
          account_id: selectedId,
          ts: Date.now(),
          type: 'order_receipt',
          direction: 'in',
          amount: creditAmount,
          currency: receiveCurrency || 'EGP',
          note: `Order receipt`,
          linked_entity_id: orderId,
          linked_entity_type: 'customer_order',
        });
        qc.invalidateQueries({ queryKey: ['customer-cash-ledger', userId] });
        qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
      }

      return result;
    },
    onSuccess: () => {
      toast.success(L('Order approved', 'تمت الموافقة على الطلب'));
      onSuccess();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? L('Failed to approve', 'فشل في الموافقة')),
  });

  const noAccounts = !accountsLoading && accounts.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-background flex flex-col"
        style={{ maxHeight: '85dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          <div>
            <p className="text-sm font-bold">
              {creating
                ? L('Create Cash Account', 'إنشاء حساب نقدي')
                : L('Accept Order', 'قبول الطلب')}
            </p>
            {creating && (
              <p className="text-[10px] text-muted-foreground">{L(`Step ${step} of 3`, `خطوة ${step} من 3`)}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {/* ── Account creation flow ── */}
          {creating ? (
            <>
              {/* Step indicator */}
              <div className="flex gap-1.5">
                {[1,2,3].map(s => (
                  <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors', s <= step ? 'bg-primary' : 'bg-muted')} />
                ))}
              </div>

              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Account name', 'اسم الحساب')}</p>
                  <p className="text-xs text-muted-foreground">{L('e.g. My EGP Account, Cairo Bank', 'مثال: حسابي، بنك القاهرة')}</p>
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder={L('Account name', 'اسم الحساب')}
                    className="h-12 w-full rounded-xl border border-border/50 bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Account type', 'نوع الحساب')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'bank', en: 'Bank Transfer', ar: 'تحويل بنكي' },
                      { value: 'cash', en: 'Cash', ar: 'نقد' },
                      { value: 'wallet', en: 'Mobile Wallet', ar: 'محفظة موبايل' },
                      { value: 'instapay', en: 'InstaPay', ar: 'إنستاباي' },
                    ].map(t => (
                      <button key={t.value} type="button" onClick={() => setNewType(t.value)}
                        className={cn('rounded-xl border px-4 py-3 text-sm font-semibold transition-colors',
                          newType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40')}>
                        {lang === 'ar' ? t.ar : t.en}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Currency', 'العملة')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {['EGP', 'QAR', 'USD'].map(c => (
                      <button key={c} type="button" onClick={() => setNewCurrency(c)}
                        className={cn('rounded-xl border px-4 py-3 text-center text-sm font-bold transition-colors',
                          newCurrency === c ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40')}>
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-xl bg-muted/30 px-4 py-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Name', 'الاسم')}</span><span className="font-semibold">{newName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Type', 'النوع')}</span><span className="font-semibold">{newType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Currency', 'العملة')}</span><span className="font-semibold">{newCurrency}</span></div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── Account selection ── */
            <>
              {accountsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : noAccounts ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-4 space-y-3">
                  <p className="text-sm font-semibold">{L('No cash account found', 'لا يوجد حساب نقدي')}</p>
                  <p className="text-xs text-muted-foreground">{L('You need a cash account to receive EGP funds. Create one now.', 'تحتاج إلى حساب نقدي لاستلام الأموال. أنشئ واحداً الآن.')}</p>
                  <button onClick={() => setCreating(true)}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    <Plus className="h-4 w-4" />{L('Create Cash Account', 'إنشاء حساب نقدي')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{L('Select account to receive EGP proceeds', 'اختر الحساب لاستلام المبلغ بالجنيه')}</p>
                  {accounts.map(acc => (
                    <button key={acc.id} type="button" onClick={() => setSelectedId(acc.id === selectedId ? null : acc.id)}
                      className={cn('w-full text-left rounded-xl border px-4 py-3 transition-colors',
                        acc.id === selectedId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/50 hover:border-primary/50')}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{(acc as any).nickname ?? acc.name}</p>
                          <p className="text-xs text-muted-foreground">{acc.type} · {acc.currency}</p>
                        </div>
                        {acc.id === selectedId && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/50 px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40">
                    <Plus className="h-3.5 w-3.5" />{L('Add another account', 'إضافة حساب آخر')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-6 pt-3 border-t border-border/40 shrink-0 flex gap-2">
          {creating ? (
            <>
              {step > 1 && (
                <button onClick={() => setStep(s => s - 1)}
                  className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">
                  {L('Back', 'رجوع')}
                </button>
              )}
              <button
                disabled={createMutation.isPending}
                onClick={() => {
                  if (step === 1) {
                    if (!newName.trim()) { toast.error(L('Enter account name', 'أدخل اسم الحساب')); return; }
                    setStep(2);
                  } else if (step === 2) {
                    setStep(3);
                  } else {
                    createMutation.mutate();
                  }
                }}
                className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : step < 3 ? L('Next', 'التالي') : L('Create Account', 'إنشاء الحساب')}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">
                {L('Cancel', 'إلغاء')}
              </button>
              <button
                disabled={!selectedId || approveMutation.isPending || noAccounts}
                onClick={() => approveMutation.mutate()}
                className="flex-1 h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
                {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : L('Approve', 'موافقة')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
