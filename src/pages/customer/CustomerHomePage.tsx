import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, Store, CheckCircle, TrendingUp, ChevronRight } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { formatCustomerNumber, listCustomerConnections, listCustomerOrders, type CustomerOrderRow } from '@/features/customer/customer-portal';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';

  const { data: orders = [] } = useQuery({
    queryKey: ['c-home-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerOrders(userId);
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['c-home-connections', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerConnections(userId);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: guide } = useQuery({
    queryKey: ['c-home-guide'],
    queryFn: getQatarEgyptGuideRate,
    staleTime: 5 * 60_000,
  });

  const pending   = orders.filter(o => ['pending_quote','quoted','quote_accepted','awaiting_payment','payment_sent'].includes(o.status));
  const completed = orders.filter(o => o.status === 'completed');
  const active    = connections.filter((c: any) => c.status === 'active');

  const kpis = [
    { icon: Store,        value: active.length,    label: lang === 'ar' ? 'تجار' : 'Merchants',  path: '/c/merchants', tone: 'blue'  },
    { icon: ShoppingCart, value: pending.length,   label: lang === 'ar' ? 'معلق' : 'Pending',    path: '/c/orders',   tone: 'amber' },
    { icon: CheckCircle,  value: completed.length, label: lang === 'ar' ? 'مكتمل' : 'Completed', path: '/c/orders',   tone: 'green' },
  ];

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'مرحباً' : 'Welcome back'}</p>
        <h1 className="text-xl font-bold text-foreground">{customerProfile?.display_name ?? '—'}</h1>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {kpis.map(({ icon: Icon, value, label, path, tone }) => (
          <button
            key={path + label}
            onClick={() => navigate(path)}
            className={cn(
              'flex flex-col items-start rounded-2xl border border-border/50 bg-card p-4 text-left transition-all active:scale-95',
            )}
          >
            <Icon className={cn(
              'mb-2 h-4 w-4',
              tone === 'blue'  && 'text-blue-500',
              tone === 'amber' && 'text-amber-500',
              tone === 'green' && 'text-emerald-500',
            )} />
            <span className="text-2xl font-black text-foreground">{value}</span>
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>

      {/* Guide rate card */}
      {guide?.rate != null && (
        <button
          onClick={() => navigate('/c/market')}
          className="flex w-full items-center justify-between rounded-2xl border border-border/50 bg-card p-4 text-left transition-all active:scale-95"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">QAR / EGP</p>
              <p className="text-lg font-black text-foreground">{formatCustomerNumber(guide.rate, lang, 4)}</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/c/orders')}
          className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all active:scale-95"
        >
          {lang === 'ar' ? '+ طلب جديد' : '+ New Order'}
        </button>
        <button
          onClick={() => navigate('/c/merchants')}
          className="rounded-2xl border border-border/50 bg-card px-4 py-3 text-sm font-semibold text-foreground transition-all active:scale-95"
        >
          {lang === 'ar' ? 'إضافة تاجر' : 'Add Merchant'}
        </button>
      </div>

      {/* Recent orders */}
      {orders.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {lang === 'ar' ? 'آخر الطلبات' : 'Recent'}
            </p>
            <button onClick={() => navigate('/c/orders')} className="text-xs text-primary">
              {lang === 'ar' ? 'الكل' : 'All'}
            </button>
          </div>
          <div className="space-y-2">
            {orders.slice(0, 3).map(order => (
              <div key={order.id} className="flex items-center justify-between rounded-xl border border-border/50 bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {order.send_currency ?? order.currency} → {order.receive_currency ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{order.amount} {order.currency}</p>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  order.status === 'completed'  && 'bg-emerald-500/10 text-emerald-600',
                  order.status === 'cancelled'  && 'bg-red-500/10 text-red-600',
                  !['completed','cancelled'].includes(order.status) && 'bg-amber-500/10 text-amber-600',
                )}>
                  {order.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
