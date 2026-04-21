import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, TrendingUp, Clock, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { formatCustomerNumber, formatCustomerDate, listCustomerConnections, listCustomerOrders, getDisplayedCustomerTotal, deriveCustomerOrderMeta, type CustomerOrderRow } from '@/features/customer/customer-portal';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';

const STATUS_CFG: Record<string, { en: string; ar: string; cls: string }> = {
  pending_quote:    { en: 'Awaiting quote',  ar: 'بانتظار العرض',  cls: 'bg-amber-500/10 text-amber-600' },
  quoted:           { en: 'Quote ready',     ar: 'العرض جاهز',     cls: 'bg-blue-500/10 text-blue-600' },
  quote_accepted:   { en: 'Accepted',        ar: 'مقبول',          cls: 'bg-emerald-500/10 text-emerald-600' },
  awaiting_payment: { en: 'Send payment',    ar: 'أرسل الدفعة',    cls: 'bg-orange-500/10 text-orange-600' },
  payment_sent:     { en: 'Payment sent',    ar: 'تم الإرسال',     cls: 'bg-blue-500/10 text-blue-600' },
  completed:        { en: 'Completed',       ar: 'مكتمل',          cls: 'bg-emerald-500/10 text-emerald-600' },
  cancelled:        { en: 'Cancelled',       ar: 'ملغي',           cls: 'bg-muted text-muted-foreground' },
};

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;

  const { data: orders = [] } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-home-orders', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerOrders(userId); return (data ?? []) as CustomerOrderRow[]; },
    enabled: !!userId, refetchInterval: 30_000,
  });
  const { data: connections = [] } = useQuery({
    queryKey: ['c-home-connections', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerConnections(userId); return (data ?? []).filter((c: any) => c.status === 'active'); },
    enabled: !!userId,
  });
  const { data: guide } = useQuery({ queryKey: ['c-guide-rate'], queryFn: getQatarEgyptGuideRate, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });

  const active      = orders.filter(o => !['completed','cancelled','quote_rejected'].includes(o.status));
  const completed   = orders.filter(o => o.status === 'completed');
  const needsAction = orders.filter(o => ['quoted','awaiting_payment'].includes(o.status));
  const totalSent   = completed.reduce((s, o) => s + (o.amount ?? 0), 0);
  const totalRecvd  = completed.reduce((s, o) => s + (Number(getDisplayedCustomerTotal(o)) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground">
        <p className="text-sm opacity-80">{L('Welcome back', 'مرحباً')}</p>
        <h1 className="mt-0.5 text-xl font-bold">{customerProfile?.display_name ?? '—'}</h1>
        {guide?.rate != null && (
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-xs opacity-70">{L('Live QAR/EGP', 'سعر QAR/EGP المباشر')}</p>
              <p className="text-3xl font-black tabular-nums">{formatCustomerNumber(guide.rate, lang, 4)}</p>
            </div>
            <button onClick={() => navigate('/c/market')} className="flex items-center gap-1 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30">
              {L('Market', 'السوق')} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {needsAction.length > 0 && (
        <button onClick={() => navigate('/c/orders')} className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left active:scale-[0.99]">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{needsAction.length} {L('order(s) need action', 'طلب/طلبات تحتاج إجراء')}</p>
            <p className="text-xs text-muted-foreground">
              {needsAction.filter(o => o.status === 'quoted').length > 0 && L('Review quotes · ', 'راجع العروض · ')}
              {needsAction.filter(o => o.status === 'awaiting_payment').length > 0 && L('Send payment', 'أرسل الدفعة')}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-4"><Clock className="mb-2 h-4 w-4 text-amber-500" /><p className="text-2xl font-black">{active.length}</p><p className="text-[11px] text-muted-foreground">{L('Active', 'نشط')}</p></div>
        <div className="rounded-2xl border border-border/50 bg-card p-4"><CheckCircle2 className="mb-2 h-4 w-4 text-emerald-500" /><p className="text-2xl font-black">{completed.length}</p><p className="text-[11px] text-muted-foreground">{L('Done', 'مكتمل')}</p></div>
        <div className="rounded-2xl border border-border/50 bg-card p-4"><TrendingUp className="mb-2 h-4 w-4 text-primary" /><p className="text-2xl font-black">{(connections as any[]).length}</p><p className="text-[11px] text-muted-foreground">{L('Merchants', 'تجار')}</p></div>
      </div>

      {completed.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-border/50">
            <div className="p-4"><p className="text-[11px] text-muted-foreground">{L('Total sent (QAR)', 'إجمالي المُرسَل')}</p><p className="mt-1 text-lg font-black tabular-nums">{formatCustomerNumber(totalSent, lang, 0)}</p></div>
            <div className="p-4"><p className="text-[11px] text-muted-foreground">{L('Total received (EGP)', 'إجمالي المُستلَم')}</p><p className="mt-1 text-lg font-black tabular-nums text-emerald-600">{formatCustomerNumber(totalRecvd, lang, 0)}</p></div>
          </div>
        </div>
      )}

      <button onClick={() => navigate('/c/orders?new=1')} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground active:scale-[0.99]">
        <Plus className="h-4 w-4" />{L('New QAR → EGP Order', 'طلب جديد QAR → EGP')}
      </button>

      {orders.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('Recent', 'الأخيرة')}</p>
            <button onClick={() => navigate('/c/orders')} className="text-xs text-primary font-medium">{L('All', 'الكل')}</button>
          </div>
          <div className="space-y-2">
            {orders.slice(0, 5).map(o => {
              const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
              const total = getDisplayedCustomerTotal(o);
              const cfg = STATUS_CFG[o.status] ?? STATUS_CFG.pending_quote;
              return (
                <button key={o.id} onClick={() => navigate(`/c/orders?id=${o.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3 text-left active:scale-[0.99]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{o.amount} {meta.sendCurrency}</span>
                      {total != null && <span className="text-sm font-semibold text-emerald-600">→ {formatCustomerNumber(total, lang, 0)} {meta.receiveCurrency}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.cls)}>{lang === 'ar' ? cfg.ar : cfg.en}</span>
                      <span className="text-[11px] text-muted-foreground">{formatCustomerDate(o.created_at, lang)}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
