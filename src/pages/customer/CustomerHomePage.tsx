import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Store, TrendingUp } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  formatCustomerNumber,
  getQatarEgyptGuideRate,
  listCustomerConnections,
  listCustomerOrders,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';

function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = 'brand',
  onClick,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: LucideIcon;
  tone?: 'brand' | 'good' | 'warn';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'kpi-card text-left transition-all',
        onClick && 'cursor-pointer',
        tone === 'good' && 'border-emerald-500/25',
        tone === 'warn' && 'border-amber-500/25',
      )}
    >
      <div className="kpi-head">
        <span className="kpi-badge" style={{ color: 'var(--brand)' }}>
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <div className="kpi-lbl">{label}</div>
      <div className={cn('kpi-val', tone === 'good' && 'good', tone === 'warn' && 'warn')}>{value}</div>
      {sublabel && <div className="kpi-sub">{sublabel}</div>}
    </button>
  );
}

export default function CustomerHomePage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const language = settings.language === 'ar' ? 'ar' : 'en';

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-dashboard-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerOrders(userId);
      if (error) return [];
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['customer-dashboard-connections', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerConnections(userId);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: guide } = useQuery({
    queryKey: ['customer-dashboard-guide'],
    queryFn: getQatarEgyptGuideRate,
  });

  const summary = useMemo(() => {
    const completedOrders = orders.filter((order) => order.status === 'completed');
    const pendingOrders = orders.filter((order) => ['pending_quote', 'quoted', 'quote_accepted', 'awaiting_payment', 'pending'].includes(order.status));
    return {
      connectedMerchants: connections.filter((connection: any) => connection.status === 'active').length,
      pendingOrders: pendingOrders.length,
      completedOrders: completedOrders.length,
      lastGuideRate: guide?.rate ?? null,
      lastGuideTimestamp: guide?.timestamp ?? null,
      lastGuideSource: guide?.source ?? null,
    };
  }, [connections, guide, orders]);

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{t('customerDashboard')}</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">{t('welcomeCustomer')}</h1>
          </div>
        </div>
      </section>

      <div className="kpis kpis-p2p">
        <StatCard
          label="Connected Merchants"
          value={formatCustomerNumber(summary.connectedMerchants, language, 0)}
          sublabel={t('customerMerchants')}
          icon={Store}
          onClick={() => navigate('/c/merchants')}
        />
        <StatCard
          label="Pending Orders"
          value={formatCustomerNumber(summary.pendingOrders, language, 0)}
          sublabel={t('orders')}
          icon={ArrowDownLeft}
          tone="warn"
          onClick={() => navigate('/c/orders')}
        />
        <StatCard
          label="Completed Orders"
          value={formatCustomerNumber(summary.completedOrders, language, 0)}
          sublabel={t('completed')}
          icon={ArrowUpRight}
          tone="good"
          onClick={() => navigate('/c/orders')}
        />
        <StatCard
          label="Last Qatar -> Egypt Guide"
          value={summary.lastGuideRate != null ? formatCustomerNumber(summary.lastGuideRate, language, 4) : '-'}
          sublabel={summary.lastGuideTimestamp ? `${summary.lastGuideSource ?? 'INSTAPAY_V1'} - ${new Date(summary.lastGuideTimestamp).toLocaleString()}` : 'Guide unavailable'}
          icon={TrendingUp}
        />
      </div>

    </div>
  );
}
