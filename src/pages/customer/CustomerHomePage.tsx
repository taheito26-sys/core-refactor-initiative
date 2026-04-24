import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, AlertCircle, Plus, ArrowUpRight, ArrowDownLeft, CheckCircle2, X, Wallet, Calculator } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  formatCustomerNumber, formatCustomerDate,
  listCustomerConnections,
} from '@/features/customer/customer-portal';
import { getCustomerMarketKpis } from '@/features/customer/customer-market';
import { listSharedOrdersForActor, getCashAccountsForUser, type WorkflowOrder } from '@/features/orders/shared-order-workflow';
import { getLocalizedCurrencyName, type CurrencyCode } from '@/lib/currency-locale';

// ── Helpers ───────────────────────────────────────────────────────────────────
function startOfWeek(): Date {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth(offset = 0): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1);
}

// ── Status map (customer vocabulary) ─────────────────────────────────────────
const STATUS: Record<string, { en: string; ar: string; cls: string }> = {
  pending_quote:    { en: 'Pending approval', ar: 'بانتظار الموافقة', cls: 'bg-amber-500/10 text-amber-600' },
  quoted:           { en: 'Awaiting approval', ar: 'بانتظار الموافقة', cls: 'bg-blue-500/10 text-blue-600' },
  quote_accepted:   { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  awaiting_payment: { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  payment_sent:     { en: 'Approved',  ar: 'مقبول',        cls: 'bg-emerald-500/10 text-emerald-600' },
  completed:        { en: 'Approved',  ar: 'مكتمل',        cls: 'bg-emerald-500/10 text-emerald-600' },
  cancelled:        { en: 'Cancelled', ar: 'ملغي',         cls: 'bg-muted text-muted-foreground' },
  quote_rejected:   { en: 'Rejected', ar: 'مرفوض',         cls: 'bg-muted text-muted-foreground' },
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-xl font-black tabular-nums', highlight && 'text-emerald-600')}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const [calcAmount, setCalcAmount] = useState('');
  const { data: orders = [] } = useQuery<WorkflowOrder[]>({
    queryKey: ['c-dash-orders', userId],
    queryFn: async () => { if (!userId) return []; return await listSharedOrdersForActor({ customerUserId: userId }); },
    enabled: !!userId, refetchInterval: 60_000,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-dash-connections', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });

  const { data: marketData } = useQuery({ queryKey: ['c-market-kpis'], queryFn: getCustomerMarketKpis, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });
  const guideRate = marketData?.guide?.rate ?? null;
  const egyptBuyAvg = marketData?.egypt?.buyAvg ?? null;

  // Cash accounts — needed to prompt creation when receiving orders
  const qc = useQueryClient();
  const { data: cashAccounts = [] } = useQuery({
    queryKey: ['c-cash-accounts-home', userId],
    queryFn: async () => { if (!userId) return []; return getCashAccountsForUser(userId); },
    enabled: !!userId,
  });
  const hasCashAccount = cashAccounts.length > 0;

  // Create cash account state
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('bank');
  const [newAccCurrency, setNewAccCurrency] = useState('EGP');
  const [createStep, setCreateStep] = useState(1); // 1=name, 2=type, 3=currency

  const createAccountMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newAccName.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));
      const newId = Math.random().toString(36).slice(2, 10);
      const { data, error } = await supabase.from('cash_accounts').insert({
        id: newId, user_id: userId, name: newAccName.trim(), type: newAccType, currency: newAccCurrency, status: 'active', created_at: Date.now(),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(L('Cash account created!', 'تم إنشاء الحساب!'));
      setShowCreateAccount(false);
      setNewAccName(''); setNewAccType('bank'); setNewAccCurrency('EGP'); setCreateStep(1);
      qc.invalidateQueries({ queryKey: ['c-cash-accounts-home', userId] });
      qc.invalidateQueries({ queryKey: ['c-cash-accounts', userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? L('Failed', 'فشل')),
  });

  const metrics = useMemo(() => {
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();
    const lastMonthStart = startOfMonth(-1).getTime();

    const completed = orders.filter(o => o.workflow_status === 'approved');
    const active    = orders.filter(o => o.workflow_status && ['pending_customer_approval', 'pending_merchant_approval'].includes(o.workflow_status));
    const needsAction = orders.filter(o => o.workflow_status === 'pending_customer_approval');

    // Volume = only orders where customer RECEIVES QAR (merchant placed = customer receives)
    const receivedOrders = orders.filter(o => o.placed_by_role === 'merchant');
    const receivedCompleted = receivedOrders.filter(o => o.workflow_status === 'approved');

    const thisMonth  = receivedOrders.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const lastMonth  = receivedOrders.filter(o => { const t = new Date(o.created_at).getTime(); return t >= lastMonthStart && t < monthStart; });
    const thisWeek   = receivedOrders.filter(o => new Date(o.created_at).getTime() >= weekStart);

    // Current month completed received orders for summary
    const thisMonthCompleted = receivedCompleted.filter(o => new Date(o.created_at).getTime() >= monthStart);
    const monthQar = thisMonthCompleted.reduce((s, o) => s + (o.amount ?? 0), 0);
    const monthEgp = thisMonthCompleted.reduce((s, o) => s + ((o.amount ?? 0) * (o.fx_rate ?? 1)), 0);
    const monthAvgFx = monthQar > 0 ? monthEgp / monthQar : null;

    // Order activity stats (replaces 14-day trend)
    const totalOrders = orders.length;
    const approvedOrders = completed.length;
    const pendingOrders = active.length;
    const thisMonthOrders = orders.filter(o => new Date(o.created_at).getTime() >= monthStart).length;

    // Trend: last 14 days
    const trend: { date: string; qar: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const dayOrders = receivedOrders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      trend.push({ date: d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }), qar: dayOrders.reduce((s, o) => s + (o.amount ?? 0), 0) });
    }
    const maxTrend = Math.max(...trend.map(t => t.qar), 1);

    return {
      thisMonthVol: thisMonth.reduce((s, o) => s + (o.amount ?? 0), 0),
      lastMonthVol: lastMonth.reduce((s, o) => s + (o.amount ?? 0), 0),
      thisWeekVol:  thisWeek.reduce((s, o) => s + (o.amount ?? 0), 0),
      monthQar, monthEgp, monthAvgFx,
      totalOrders, approvedOrders, pendingOrders, thisMonthOrders,
      active, completed, needsAction, trend, maxTrend,
    };
  }, [orders, lang]);

  const calcResult = guideRate && calcAmount && parseFloat(calcAmount) > 0
    ? parseFloat(calcAmount) * guideRate
    : null;

  return (
    <div className="space-y-5">
      {/* Hero: rates + calculator */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground space-y-4">
        <div>
          <p className="text-sm opacity-80">{L('Welcome back', 'مرحباً')}</p>
          <h1 className="mt-0.5 text-xl font-bold">{customerProfile?.display_name ?? '—'}</h1>
        </div>

        {/* Rate row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] opacity-70 uppercase tracking-wide">{getLocalizedCurrencyName('QAR', lang)}/{getLocalizedCurrencyName('EGP', lang)} {L('Guide', 'دليل')}</p>
            <p className="text-xl font-black tabular-nums mt-0.5">
              {guideRate != null ? fmt(guideRate, 4) : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] opacity-70 uppercase tracking-wide">{L('Egypt Buy Avg', 'متوسط شراء مصر')}</p>
            <p className="text-xl font-black tabular-nums mt-0.5">
              {egyptBuyAvg != null ? fmt(egyptBuyAvg, 4) : '—'}
            </p>
          </div>
        </div>

        {/* Quick Calculator */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Calculator className="h-3.5 w-3.5 opacity-70" />
            <p className="text-xs opacity-70 font-medium">{L('Quick Calculator', 'حاسبة سريعة')}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                value={calcAmount}
                onChange={e => setCalcAmount(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                className="h-10 w-full rounded-xl bg-white/20 px-3 pe-14 text-sm font-semibold text-white placeholder:text-white/40 outline-none focus:bg-white/25"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-70">{getLocalizedCurrencyName('QAR', lang)}</span>
            </div>
            <span className="text-white/60 font-bold">→</span>
            <div className="relative flex-1">
              <input
                value={calcResult != null ? fmt(calcResult, 0) : ''}
                readOnly
                placeholder="0"
                className="h-10 w-full rounded-xl bg-white/10 px-3 pe-14 text-sm font-semibold text-white placeholder:text-white/30 outline-none tabular-nums"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-70">{getLocalizedCurrencyName('EGP', lang)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action needed */}
      {metrics.needsAction.length > 0 && (
        <button onClick={() => navigate('/c/orders')} className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left active:scale-[0.99]">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{metrics.needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}</p>
            <p className="text-xs text-muted-foreground">
              {metrics.needsAction.length > 0 && L('Review quotes', 'راجع العروض')}
            </p>
          </div>
        </button>
      )}

      {/* No cash account prompt — shown when customer has no cash account */}
      {!hasCashAccount && orders.length > 0 && (
        <button
          onClick={() => setShowCreateAccount(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left active:scale-[0.99]"
        >
          <Wallet className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{L('Set up a cash account to receive funds', 'أنشئ حساباً نقدياً لاستلام الأموال')}</p>
            <p className="text-xs text-muted-foreground">{L('Required to approve incoming orders', 'مطلوب للموافقة على الطلبات الواردة')}</p>
          </div>
          <Plus className="h-4 w-4 text-primary shrink-0" />
        </button>
      )}

      {/* Create Cash Account Modal — step by step */}
      {showCreateAccount && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateAccount(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-background flex flex-col" style={{ maxHeight: '80dvh' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
              <div>
                <p className="text-sm font-bold">{L('New Cash Account', 'حساب نقدي جديد')}</p>
                <p className="text-[10px] text-muted-foreground">{L(`Step ${createStep} of 3`, `خطوة ${createStep} من 3`)}</p>
              </div>
              <button onClick={() => setShowCreateAccount(false)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>

            {/* Step indicator */}
            <div className="flex gap-1.5 px-4 pt-3 shrink-0">
              {[1,2,3].map(s => (
                <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors', s <= createStep ? 'bg-primary' : 'bg-muted')} />
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
              {/* Step 1: Name */}
              {createStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-base font-bold">{L('What should we call this account?', 'ما اسم هذا الحساب؟')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{L('e.g. My EGP Account, Cairo Bank', 'مثال: حسابي، بنك القاهرة')}</p>
                  </div>
                  <input
                    autoFocus
                    value={newAccName}
                    onChange={e => setNewAccName(e.target.value)}
                    placeholder={L('Account name', 'اسم الحساب')}
                    className="h-12 w-full rounded-xl border border-border/50 bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}

              {/* Step 2: Type */}
              {createStep === 2 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Account type', 'نوع الحساب')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'bank', label: { en: 'Bank Transfer', ar: 'تحويل بنكي' } },
                      { value: 'cash', label: { en: 'Cash', ar: 'نقد' } },
                      { value: 'wallet', label: { en: 'Mobile Wallet', ar: 'محفظة موبايل' } },
                      { value: 'instapay', label: { en: 'InstaPay', ar: 'إنستاباي' } },
                    ].map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setNewAccType(t.value)}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors',
                          newAccType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {lang === 'ar' ? t.label.ar : t.label.en}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Currency */}
              {createStep === 3 && (
                <div className="space-y-3">
                  <p className="text-base font-bold">{L('Currency', 'العملة')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {['EGP', 'QAR', 'USD'].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewAccCurrency(c)}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-center text-sm font-bold transition-colors',
                          newAccCurrency === c ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {/* Summary */}
                  <div className="rounded-xl bg-muted/30 px-4 py-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Name', 'الاسم')}</span><span className="font-semibold">{newAccName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Type', 'النوع')}</span><span className="font-semibold">{newAccType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{L('Currency', 'العملة')}</span><span className="font-semibold">{newAccCurrency}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 pb-6 pt-3 border-t border-border/40 shrink-0 flex gap-2">
              {createStep > 1 && (
                <button
                  onClick={() => setCreateStep(s => s - 1)}
                  className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted"
                >
                  {L('Back', 'رجوع')}
                </button>
              )}
              <button
                onClick={() => {
                  if (createStep < 3) {
                    if (createStep === 1 && !newAccName.trim()) { toast.error(L('Enter account name', 'أدخل اسم الحساب')); return; }
                    setCreateStep(s => s + 1);
                  } else {
                    createAccountMutation.mutate();
                  }
                }}
                disabled={createAccountMutation.isPending}
                className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {createStep < 3 ? L('Next', 'التالي') : (createAccountMutation.isPending ? L('Creating...', 'جارٍ الإنشاء...') : L('Create Account', 'إنشاء الحساب'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI row: volume periods */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L('Volume', 'الحجم')} ({getLocalizedCurrencyName('QAR', lang === 'ar' ? 'ar' : 'en')})</p>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard label={L('This month', 'هذا الشهر')} value={fmt(metrics.thisMonthVol)} />
          <KpiCard label={L('Last month', 'الشهر الماضي')} value={fmt(metrics.lastMonthVol)} />
          <KpiCard label={L('This week', 'هذا الأسبوع')} value={fmt(metrics.thisWeekVol)} />
        </div>
      </div>

      {/* FX summary — current month */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {getLocalizedCurrencyName('QAR', lang)} → {getLocalizedCurrencyName('EGP', lang)} · {L('This Month', 'هذا الشهر')}
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/40">
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-[10px] text-muted-foreground">{L('Received (QAR)', 'مُستلَم')}</p></div>
            <p className="text-lg font-black tabular-nums">{fmt(metrics.monthQar)}</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /><p className="text-[10px] text-muted-foreground">{L('Delivered (EGP)', 'مُسلَّم')}</p></div>
            <p className="text-lg font-black tabular-nums text-emerald-600">{fmt(metrics.monthEgp)}</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-1 mb-1"><TrendingUp className="h-3.5 w-3.5 text-primary" /><p className="text-[10px] text-muted-foreground">{L('Avg Rate', 'متوسط السعر')}</p></div>
            <p className="text-lg font-black tabular-nums">{metrics.monthAvgFx != null ? fmt(metrics.monthAvgFx, 2) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Order Activity — replaces 14-day volume chart */}
      {orders.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Order Activity', 'نشاط الطلبات')}</p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-border/40">
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{L('Total', 'الكل')}</p>
              <p className="text-xl font-black">{metrics.totalOrders}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{L('Approved', 'مكتمل')}</p>
              <p className="text-xl font-black text-emerald-600">{metrics.approvedOrders}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{L('Pending', 'معلق')}</p>
              <p className="text-xl font-black text-amber-500">{metrics.pendingOrders}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{L('This Month', 'هذا الشهر')}</p>
              <p className="text-xl font-black text-primary">{metrics.thisMonthOrders}</p>
            </div>
          </div>
        </div>
      )}

      {/* New order CTA */}
      <button onClick={() => navigate('/c/orders?new=1')} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground active:scale-[0.99]">
        <Plus className="h-4 w-4" />{L('New QAR → EGP Order', 'طلب جديد QAR → EGP')}
      </button>

      {/* Recent activity - Ledger style */}
      {orders.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Recent Orders', 'الطلبات الأخيرة')}</p>
              <button onClick={() => navigate('/c/orders')} className="text-xs text-primary font-medium">{L('View all', 'عرض الكل')}</button>
            </div>
          </div>
          <div className="divide-y divide-border/40">
            {orders.slice(0, 5).map(o => {
              const total = o.fx_rate ? o.amount * o.fx_rate : null;
              const rate  = o.fx_rate;
              const sendCur = getLocalizedCurrencyName((o.send_currency ?? 'QAR') as CurrencyCode, lang === 'ar' ? 'ar' : 'en');
              const receiveCur = getLocalizedCurrencyName((o.receive_currency ?? 'EGP') as CurrencyCode, lang === 'ar' ? 'ar' : 'en');

              // Map workflow_status to status config for display
              let cfg = STATUS.pending_quote;
              if (o.workflow_status === 'approved') cfg = STATUS.quote_accepted;
              else if (o.workflow_status === 'rejected') cfg = STATUS.quote_rejected;
              else if (o.workflow_status === 'pending_customer_approval' || o.workflow_status === 'pending_merchant_approval') cfg = STATUS.quoted;
              else if (o.workflow_status === 'cancelled') cfg = STATUS.cancelled;

              return (
                <button
                  key={o.id}
                  onClick={() => navigate(`/c/orders?id=${o.id}`)}
                  className="w-full text-left px-4 py-2.5 hover:bg-muted/40 active:scale-[0.98] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* Amounts */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-sm font-semibold tabular-nums">{fmt(o.amount)} {sendCur}</span>
                        {total != null && <span className="text-emerald-600 font-semibold">→ {fmt(total)} {receiveCur}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.cls)}>{lang === 'ar' ? cfg.ar : cfg.en}</span>
                        <span className="text-[10px] text-muted-foreground">{formatCustomerDate(o.created_at, lang)}</span>
                      </div>
                    </div>
                    {/* Rate */}
                    {rate != null && (
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground tabular-nums">@{fmt(rate, 4)}</p>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/50 py-12 text-center">
          <p className="text-sm text-muted-foreground">{L('No orders yet', 'لا توجد طلبات بعد')}</p>
          <p className="text-xs text-muted-foreground mt-1">{L('Place your first QAR → EGP order above', 'قدّم طلبك الأول أعلاه')}</p>
        </div>
      )}
    </div>
  );
}
