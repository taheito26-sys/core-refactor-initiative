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
import { ParentOrderCard } from '@/features/parent-order-fulfillment/components/ParentOrderCard';
import { PhasedClientOrderCard } from '@/features/parent-order-fulfillment/components/PhasedClientOrderCard';
import { AcceptOrderModal } from '@/features/parent-order-fulfillment/components/AcceptOrderModal';
import { MobileInstallBanner } from '@/features/parent-order-fulfillment/components/MobileInstallBanner';
import { useParentOrderSummary } from '@/features/parent-order-fulfillment/hooks/useParentOrderSummary';
import { useOrderExecutions } from '@/features/parent-order-fulfillment/hooks/useOrderExecutions';

// ── LinkCashModal — assign received EGP to a cash account ────────

function LinkCashModal({ orderId, egpAmount, receiveCurrency, lang, onClose }: {
  orderId: string; egpAmount: number; receiveCurrency: string; lang: 'en' | 'ar'; onClose: () => void;
}) {
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('bank');
  const [newCurrency, setNewCurrency] = useState(receiveCurrency || 'EGP');

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['c-cash-accounts', userId],
    queryFn: async () => { if (!userId) return []; return getCashAccountsForUser(userId); },
    enabled: !!userId,
  });

  const createAccMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newName.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));
      const { data, error } = await supabase.from('cash_accounts').insert({ user_id: userId, name: newName.trim(), type: newType, currency: newCurrency, status: 'active' }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['c-cash-accounts', userId] });
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
      setSelectedId(data.id);
      setCreating(false);
      setNewName(''); setNewType('bank'); setNewCurrency(receiveCurrency || 'EGP');
      toast.success(L('Account created', 'تم إنشاء الحساب'));
    },
    onError: (e: any) => toast.error(e?.message),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || !userId) throw new Error(L('Select an account', 'اختر حساباً'));
      const { error } = await supabase.from('cash_ledger').insert({
        user_id: userId, account_id: selectedId, ts: Date.now(),
        type: 'order_receipt', direction: 'in', amount: egpAmount,
        currency: receiveCurrency || 'EGP',
        note: L('Order receipt', 'استلام طلب'),
        linked_entity_id: orderId, linked_entity_type: 'customer_order',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L('Linked to cash account', 'تم الربط بالحساب النقدي'));
      qc.invalidateQueries({ queryKey: ['customer-cash-ledger', userId] });
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background flex flex-col" style={{ maxHeight: '80dvh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          <div>
            <p className="text-sm font-bold">{L('Link to Cash Account', 'ربط بحساب نقدي')}</p>
            <p className="text-[10px] text-muted-foreground">{L('Credit', 'إضافة')} {egpAmount.toLocaleString()} {receiveCurrency}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-3">
          {creating ? (
            <div className="space-y-3">
              <p className="text-sm font-bold">{L('New Account', 'حساب جديد')}</p>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder={L('Account name', 'اسم الحساب')}
                className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="grid grid-cols-2 gap-2">
                <select value={newType} onChange={e => setNewType(e.target.value)} className="h-10 rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
                  {[['bank','Bank','بنك'],['cash','Cash','نقد'],['mobile_wallet','Mobile Wallet','محفظة موبايل'],['other','Other','أخرى']].map(([v,en,ar]) => (
                    <option key={v} value={v}>{lang === 'ar' ? ar : en}</option>
                  ))}
                </select>
                <select value={newCurrency} onChange={e => setNewCurrency(e.target.value)} className="h-10 rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
                  {['EGP','QAR','USD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCreating(false)} className="flex-1 h-10 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L('Back', 'رجوع')}</button>
                <button onClick={() => createAccMutation.mutate()} disabled={createAccMutation.isPending} className="flex-1 h-10 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
                  {createAccMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : L('Create', 'إنشاء')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {isLoading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{L('Select account to receive funds', 'اختر الحساب لاستلام الأموال')}</p>
                  {accounts.map((acc: any) => (
                    <button key={acc.id} type="button" onClick={() => setSelectedId(acc.id === selectedId ? null : acc.id)}
                      className={cn('w-full text-left rounded-xl border px-4 py-3 transition-colors',
                        acc.id === selectedId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/50 hover:border-primary/50')}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{acc.name}</p>
                          <p className="text-xs text-muted-foreground">{acc.type} · {acc.currency}</p>
                        </div>
                        {acc.id === selectedId && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/50 px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40">
                    <Plus className="h-3.5 w-3.5" />{L('Add new account', 'إضافة حساب جديد')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {!creating && (
          <div className="px-4 pb-6 pt-3 border-t border-border/40 shrink-0 flex gap-2">
            <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L('Cancel', 'إلغاء')}</button>
            <button disabled={!selectedId || linkMutation.isPending} onClick={() => linkMutation.mutate()}
              className="flex-1 h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
              {linkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : L('Link & Credit', 'ربط وإضافة')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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

function getLocalizedWorkflowStatusLabel(status: WorkflowOrder['workflow_status'], lang: 'en' | 'ar') {
  switch (status) {
    case 'pending_customer_approval':
      return lang === 'ar' ? 'بانتظار موافقة العميل' : 'Awaiting Customer Approval';
    case 'pending_merchant_approval':
      return lang === 'ar' ? 'بانتظار موافقة التاجر' : 'Awaiting Merchant Approval';
    case 'approved':
      return lang === 'ar' ? 'تمت الموافقة' : 'Approved';
    case 'rejected':
      return lang === 'ar' ? 'مرفوض' : 'Rejected';
    case 'cancelled':
      return lang === 'ar' ? 'ملغي' : 'Cancelled';
    default:
      return lang === 'ar' ? 'غير معروف' : 'Unknown';
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
      if (!merchantId || !amount || parseFloat(amount) <= 0) throw new Error(L('Enter amount and select merchant', 'أدخل المبلغ واختر التاجر'));

      const conn = connections.find((c: any) => c.merchant_id === merchantId);
      if (!conn) throw new Error(L('Merchant not found', 'التاجر غير موجود'));

      // Use exact InstaPay V1 market rate (no transformation)
      if (!liveRate || liveRate.rate == null || !Number.isFinite(liveRate.rate) || liveRate.rate <= 0) {
        throw new Error(L('Live market rate unavailable', 'سعر السوق غير متوفر'));
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

        {/* Live FX Rate Display - exact InstaPay V1 value, no transformation */}
        {isRateLoading ? (
          <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-border/50 bg-card">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{L('Loading rate...', 'جاري تحميل السعر...')}</span>
          </div>
        ) : isRateError || !liveRate || liveRate.rate == null || !Number.isFinite(liveRate.rate) ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-3 space-y-2 border border-amber-500/20">
            <div className="text-xs font-medium text-amber-700">{L('Market rate unavailable', 'سعر السوق غير متوفر')}</div>
            <div className="text-[11px] text-amber-600">{L('Please try again shortly.', 'يرجى المحاولة لاحقًا.')}</div>
          </div>
        ) : (
          <div className="rounded-lg bg-blue-500/10 px-3 py-3 space-y-2 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700">{L('Market Rate (InstaPay V1)', 'سعر السوق (InstaPay V1)')}</span>
              <span className="text-sm font-bold text-blue-700">1 قطري = {liveRate.rate.toFixed(4)} جنية</span>
            </div>
            {amount && (
              <div className="pt-2 border-t border-blue-500/20">
                <div className="text-[11px] text-blue-600 mb-1">{L('Estimated delivery (may change)', 'التسليم المتوقع (قد يتغير)')}</div>
                <div className="text-lg font-bold text-blue-700">
                  {(parseFloat(amount) * liveRate.rate).toFixed(2)} جنية
                </div>
                <div className="text-[10px] text-blue-600 mt-1">{L('Merchant sets final rate', 'التاجر يحدد السعر النهائي')}</div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Note (optional)', 'ملاحظة (اختيارية)')}</label>
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
                  {L('No active cash accounts found. Select "No Account" above or add one in Wallet.', 'لا توجد حسابات نقدية نشطة. اختر "بدون حساب" أعلاه أو أضف واحدًا في المحفظة.')}
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
  const isMobile = useIsMobile();
  const { settings } = useTheme();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const qc = useQueryClient();
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // 'YYYY-MM' or null = all
  const [acceptingOrder, setAcceptingOrder] = useState<WorkflowOrder | null>(null);
  const [linkingOrder, setLinkingOrder] = useState<WorkflowOrder | null>(null);

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
      toast.error(error?.message ?? L('Failed to approve', 'فشل في الموافقة'));
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
      toast.error(error?.message ?? L('Failed to reject', 'فشل في الرفض'));
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
      toast.success(L('Order updated and sent to merchant', 'تم تحديث الطلب وإرساله للتاجر'));
      setEditingId(null);
      setEditAmount('');
      qc.invalidateQueries({ queryKey: ['c-orders', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to update', 'فشل في التحديث'));
    },
  });

  // Derive available months from orders (most recent first)
  const availableMonths = useMemo(() => {
    const seen = new Set<string>();
    const months: string[] = [];
    for (const o of [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      const key = o.created_at.slice(0, 7); // 'YYYY-MM'
      if (!seen.has(key)) { seen.add(key); months.push(key); }
    }
    return months;
  }, [orders]);

  const filteredOrders = useMemo(() =>
    selectedMonth ? orders.filter(o => o.created_at.startsWith(selectedMonth)) : orders,
    [orders, selectedMonth],
  );

  const grouped = groupByDay(filteredOrders, lang);

  return (
    <div className="space-y-6 pb-16">
      {/* Mobile install banner — rendered once at page level (Req 9.1) */}
      <MobileInstallBanner />

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

        {/* Month filter pills */}
        {availableMonths.length > 0 && (
          <div className="flex gap-2 mt-3 overflow-x-auto pb-0.5 scrollbar-none">
            <button
              onClick={() => setSelectedMonth(null)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                selectedMonth === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {L('All Months', 'كل الأشهر')}
            </button>
            {availableMonths.map(m => {
              const [y, mo] = m.split('-');
              const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(
                lang === 'ar' ? 'ar-EG' : 'en-US',
                { month: 'short', year: '2-digit' },
              );
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMonth(m)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                    selectedMonth === m
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
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
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
          <p className="text-muted-foreground">{orders.length === 0 ? L('No orders yet', 'لا توجد طلبات بعد') : L('No orders this month', 'لا توجد طلبات هذا الشهر')}</p>
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
                    EGP: { en: 'EGP (جنية)', ar: 'جنية' },
                  };
                  return labels[cur] ? (lang === 'ar' ? labels[cur].ar : labels[cur].en) : cur;
                };

                if (isMobile) {
                  // ── PHASED ORDER: render single integrated card ──
                  const isPhasedOrder = order.fulfillment_mode === 'phased';
                  if (isPhasedOrder) {
                    const phasedActions = (canApprove || canReject || canEdit) ? (
                      isEditing ? (
                        <div className="space-y-2">
                          <label className="block text-[10px] font-medium tracking-wide text-slate-400">
                            {L('New amount', 'المبلغ الجديد')}
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
                              {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Update', 'تحديث')}
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
                              onClick={() => setAcceptingOrder(order)}
                              disabled={isActioning}
                              className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                            >
                              {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              {L('Approve', 'موافقة')}
                            </button>
                          )}
                          {canReject && (
                            <button
                              onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                              disabled={isActioning}
                              className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50"
                            >
                              {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                              {L('Reject', 'رفض')}
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                              className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                            >
                              {L('Edit', 'تعديل')}
                            </button>
                          )}
                        </div>
                      )
                    ) : undefined;

                    return (
                      <PhasedClientOrderCard
                        key={order.id}
                        orderId={order.id}
                        parentQarAmount={order.amount}
                        sendCurrency={order.send_currency || 'QAR'}
                        receiveCurrency={order.receive_currency || 'EGP'}
                        workflowStatus={order.workflow_status}
                        lang={lang}
                        createdAt={order.created_at}
                        note={order.note}
                        actions={phasedActions}
                      />
                    );
                  }

                  // ── NON-PHASED ORDER: default mobile card ──
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
                  const fxRateLabel = order.fx_rate != null ? formatCustomerNumber(order.fx_rate, lang, 2) : '—';
                  const sendAmountLabel = formatCustomerNumber(order.amount, lang, 0);
                  const receiveAmountLabel = deliveredAmount != null
                    ? formatCustomerNumber(deliveredAmount, lang, 0)
                    : '—';
                  const sendCurrencyLabel = currencyLabel(order.send_currency);
                  const receiveCurrencyLabel = currencyLabel(order.receive_currency);
                  const dateLabel = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(new Date(order.created_at));
                  const approvalBadge =
                    order.workflow_status === 'approved'
                      ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] leading-none text-emerald-400">✓</span>
                      : null;

                  return (
                    <div key={order.id} className="space-y-2">
                    <div
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      className={cn(
                        'overflow-hidden rounded-[20px] border px-3 py-2.5 text-[12px] text-slate-100',
                        statusTone.card,
                        lang === 'ar' && 'text-right',
                      )}
                    >
                      <div className={cn('flex items-start justify-between gap-2', lang === 'ar' && 'flex-row-reverse')}>
                        <div className="min-w-0">
                          {approvalBadge}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-medium text-slate-300">
                          <span>{dateLabel}</span>
                        </div>
                      </div>

                      <div className={cn('mt-2 grid grid-cols-2 gap-2', lang === 'ar' && 'text-right')}>
                        <div className="rounded-xl bg-white/[0.03] px-2 py-1.5">
                          <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{lang === 'ar' ? 'المستلم' : 'Received'}</div>
                          <div className="mt-1 text-[17px] font-black leading-none text-slate-50">
                            {sendAmountLabel}
                          </div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{sendCurrencyLabel}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] px-2 py-1.5 text-right">
                          <div className="text-[9px] uppercase tracking-[0.08em] text-slate-400">{lang === 'ar' ? 'المرسل' : 'Sent'}</div>
                          <div className="mt-1 text-[17px] font-black leading-none text-slate-50">
                            {receiveAmountLabel}
                          </div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-300">{receiveCurrencyLabel}</div>
                        </div>
                      </div>

                      <div className={cn('mt-2 text-[10px] leading-4 text-slate-400', lang === 'ar' && 'text-right')}>
                        1 {sendCurrencyLabel} = {fxRateLabel} {receiveCurrencyLabel}
                      </div>

                      {(canApprove || canReject || canEdit) && (
                        <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2.5">
                          {isEditing ? (
                            <div className="space-y-2">
                              <label className="block text-[10px] font-medium tracking-wide text-slate-400">
                                {L('New amount', 'المبلغ الجديد')}
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
                                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : L('Update', 'تحديث')}
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
                                  onClick={() => setAcceptingOrder(order)}
                                  disabled={isActioning}
                                  className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  {L('Approve', 'موافقة')}
                                </button>
                              )}
                              {canReject && (
                                <button
                                  onClick={() => { setActioningId(order.id); rejectMutation.mutate({ order }); }}
                                  disabled={isActioning}
                                  className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50"
                                >
                                  {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                  {L('Reject', 'رفض')}
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => { setEditingId(order.id); setEditAmount(String(order.amount)); }}
                                  className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                                >
                                  {L('Edit', 'تعديل')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Link to Cash — shown on approved orders */}
                      {order.workflow_status === 'approved' && order.fx_rate && (
                        <div className="mt-2 border-t border-white/5 pt-2">
                          <button
                            onClick={e => { e.stopPropagation(); setLinkingOrder(order); }}
                            className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20"
                          >
                            💰 {L('Link to Cash Account', 'ربط بحساب نقدي')}
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Parent order fulfillment card — realtime subscription handled inside hook (Req 6.1, 6.6, 6.7) */}
                    <ParentOrderCard parentOrderId={order.id} parentQarAmount={order.amount} fulfillmentMode={order.fulfillment_mode} />
                    </div>
                  );
                }

                return (
                  <div key={order.id} className="space-y-2">
                  {order.fulfillment_mode === 'phased' ? (
                    <PhasedClientOrderCard
                      orderId={order.id}
                      parentQarAmount={order.amount}
                      sendCurrency={order.send_currency || 'QAR'}
                      receiveCurrency={order.receive_currency || 'EGP'}
                      workflowStatus={order.workflow_status}
                      lang={lang}
                      createdAt={order.created_at}
                      note={order.note}
                      actions={(canApprove || canReject || canEdit) ? (
                        isEditing ? (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-muted-foreground">{L('New amount', 'المبلغ الجديد')}</label>
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
                                onClick={() => setAcceptingOrder(order)}
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
                        )
                      ) : order.workflow_status === 'approved' ? (
                        <button
                          onClick={() => setLinkingOrder(order)}
                          className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-600 hover:bg-sky-500/20"
                        >
                          💰 {L('Link to Cash Account', 'ربط بحساب نقدي')}
                        </button>
                      ) : undefined}
                    />
                  ) : (
                  <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
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
                              {L('Received', 'المستلم')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">{formatCustomerNumber(order.amount, lang, 0)}</span>
                              <span className="text-xs font-semibold text-muted-foreground">{currencyLabel(order.send_currency)}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {L('Delivered', 'المسلّم')}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-bold">
                                {deliveredAmount ? formatCustomerNumber(deliveredAmount, lang, 0) : '—'}
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
                              <div className="text-xs sm:text-sm font-semibold">1 {currencyLabel(order.send_currency)} = {formatCustomerNumber(order.fx_rate, lang, 2)} {currencyLabel(order.receive_currency)}</div>
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
                              <label className="block text-xs font-medium text-muted-foreground">{L('New amount', 'المبلغ الجديد')}</label>
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
                                  onClick={() => setAcceptingOrder(order)}
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
                      {/* Link to Cash — shown on approved orders */}
                      {order.workflow_status === 'approved' && order.fx_rate && (
                        <div className="mt-3 pt-3 border-t border-border/30">
                          <button
                            onClick={() => setLinkingOrder(order)}
                            className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-600 hover:bg-sky-500/20"
                          >
                            💰 {L('Link to Cash Account', 'ربط بحساب نقدي')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* AcceptOrderModal — forces cash account selection/creation before approval */}
      {acceptingOrder && (
        <AcceptOrderModal
          orderId={acceptingOrder.id}
          receiveCurrency={acceptingOrder.receive_currency ?? 'EGP'}
          egpAmount={acceptingOrder.fx_rate ? acceptingOrder.amount * acceptingOrder.fx_rate : null}
          lang={lang}
          onClose={() => setAcceptingOrder(null)}
          onSuccess={() => {
            setAcceptingOrder(null);
            qc.invalidateQueries({ queryKey: ['c-orders', userId] });
          }}
        />
      )}

      {/* LinkCashModal — assign received EGP to a cash account on approved orders */}
      {linkingOrder && (
        <LinkCashModal
          orderId={linkingOrder.id}
          egpAmount={linkingOrder.fx_rate ? Math.round(linkingOrder.amount * linkingOrder.fx_rate) : 0}
          receiveCurrency={linkingOrder.receive_currency ?? 'EGP'}
          lang={lang}
          onClose={() => setLinkingOrder(null)}
        />
      )}
    </div>
  );
}
