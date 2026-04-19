import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, TrendingUp, Wallet, ShoppingCart, ReceiptText, ArrowDownLeft, ArrowUpRight, Sparkles, Bell } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import {
  CUSTOMER_COUNTRIES,
  deriveCustomerOrderMeta,
  formatCustomerDate,
  formatCustomerNumber,
  getCompatibleRails,
  getCorridorLabel,
  getCurrencyForCountry,
  getCustomerOrderReceivedAmount,
  getCustomerOrderSentAmount,
  listCustomerConnections,
  listCustomerNotifications,
  listCustomerOrders,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { cn } from '@/lib/utils';

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
  tone?: 'brand' | 'good' | 'warn' | 'muted';
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
        tone === 'muted' && 'border-border',
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

function CorridorCard({ order, language }: { order: CustomerOrderRow; language: 'en' | 'ar' }) {
  const sendAmount = getCustomerOrderSentAmount(order);
  const receiveAmount = getCustomerOrderReceivedAmount(order);
  const meta = deriveCustomerOrderMeta(order);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{meta.corridorLabel}</h2>
        <span className="pill">{order.payout_rail ?? '—'}</span>
      </div>
      <div className="panel-body space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{meta.sendCountry}</div>
            <div className="mt-1 text-lg font-black text-foreground">
              {formatCustomerNumber(sendAmount, language, 2)} {meta.sendCurrency}
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{meta.receiveCountry}</div>
            <div className="mt-1 text-lg font-black text-foreground">
              {formatCustomerNumber(receiveAmount, language, 2)} {meta.receiveCurrency}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {order.corridor_label ?? getCorridorLabel(meta.sendCountry, meta.receiveCountry)} · {order.status}
        </div>
      </div>
    </div>
  );
}

export default function CustomerHomePage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const language = settings.language === 'ar' ? 'ar' : 'en';

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-dashboard-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerOrders(userId);
      if (error) throw error;
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['customer-dashboard-connections', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerConnections(userId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['customer-dashboard-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerNotifications(userId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });

  const summary = useMemo(() => {
    const completed = orders.filter((order) => order.status === 'completed');
    const sent = completed.reduce((sum, order) => sum + getCustomerOrderSentAmount(order), 0);
    const received = completed.reduce((sum, order) => sum + getCustomerOrderReceivedAmount(order), 0);

    const cashByCurrency = new Map<string, { sent: number; received: number }>();
    for (const order of completed) {
      const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
      const sentBucket = cashByCurrency.get(meta.sendCurrency) ?? { sent: 0, received: 0 };
      sentBucket.sent += getCustomerOrderSentAmount(order);
      cashByCurrency.set(meta.sendCurrency, sentBucket);

      const receiveBucket = cashByCurrency.get(meta.receiveCurrency) ?? { sent: 0, received: 0 };
      receiveBucket.received += getCustomerOrderReceivedAmount(order);
      cashByCurrency.set(meta.receiveCurrency, receiveBucket);
    }

    const latestCorridorOrder =
      [...completed].find((order) => {
        const sendCountry = order.send_country ?? customerProfile?.country;
        const receiveCountry = order.receive_country ?? (order.receive_currency === 'EGP' ? 'Egypt' : null);
        const receiveCurrency = order.receive_currency ?? (order.total ? 'EGP' : null);
        return sendCountry === 'Qatar' && receiveCountry === 'Egypt' && receiveCurrency === 'EGP';
      }) ?? completed[0] ?? null;

    const payoutHistory = completed.slice(0, 6);
    const rateHistory = completed.filter((order) => order.rate !== null).slice(0, 6);
    const recentNotifications = notifications.slice(0, 4);

    return {
      totalDeals: orders.length,
      totalCash: sent + received,
      historicalTotalSent: sent,
      historicalTotalReceived: received,
      cashByCurrency: [...cashByCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      latestCorridorOrder,
      payoutHistory,
      rateHistory,
      recentNotifications,
    };
  }, [orders, notifications, customerProfile?.country]);

  const supportedRails = useMemo(() => {
    if (!summary.latestCorridorOrder) return [];
    const meta = deriveCustomerOrderMeta(summary.latestCorridorOrder, customerProfile?.country);
    return getCompatibleRails(meta.sendCountry, meta.receiveCountry);
  }, [summary.latestCorridorOrder, customerProfile?.country]);

  return (
    <div className="space-y-3">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">
                <Sparkles className="h-3.5 w-3.5" />
                {t('customerDashboard')}
              </div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">
                {t('welcomeCustomer')}
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {t('customerDashboardSubtitle')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/c/orders')}
                className="btn"
              >
                <ShoppingCart className="h-4 w-4" />
                {t('newOrder')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/c/notifications')}
                className="btn secondary"
              >
                <Bell className="h-4 w-4" />
                {t('notifications')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="kpis kpis-p2p">
        <StatCard
          label={t('totalDeals')}
          value={formatCustomerNumber(summary.totalDeals, language, 0)}
          sublabel={t('loggedInCustomerOnly')}
          icon={ReceiptText}
          onClick={() => navigate('/c/orders')}
        />
        <StatCard
          label={t('totalCash')}
          value={`${formatCustomerNumber(summary.totalCash, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`}
          sublabel={`${t('historicalTotalSent')}: ${formatCustomerNumber(summary.historicalTotalSent, language, 2)} · ${t('historicalTotalReceived')}: ${formatCustomerNumber(summary.historicalTotalReceived, language, 2)}`}
          icon={Wallet}
          tone="warn"
        />
        <StatCard
          label={t('historicalTotalSent')}
          value={`${formatCustomerNumber(summary.historicalTotalSent, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`}
          sublabel={t('completedOrdersOnly')}
          icon={ArrowDownLeft}
          tone="good"
        />
        <StatCard
          label={t('historicalTotalReceived')}
          value={`${formatCustomerNumber(summary.historicalTotalReceived, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`}
          sublabel={t('completedOrdersOnly')}
          icon={ArrowUpRight}
          tone="good"
        />
      </div>

      {summary.latestCorridorOrder && (
        <CorridorCard order={summary.latestCorridorOrder} language={language} />
      )}

      <div className="dash-bottom">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('cashByCurrency')}</h2>
            <span className="pill">{summary.cashByCurrency.length} {t('currencies')}</span>
          </div>
          <div className="panel-body">
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('currency')}</th>
                    <th>{t('historicalTotalSent')}</th>
                    <th>{t('historicalTotalReceived')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.cashByCurrency.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-muted-foreground">{t('noCashHistory')}</td>
                    </tr>
                  ) : (
                    summary.cashByCurrency.map(([currency, totals]) => (
                      <tr key={currency}>
                        <td className="font-semibold">{currency}</td>
                        <td>{formatCustomerNumber(totals.sent, language, 2)}</td>
                        <td>{formatCustomerNumber(totals.received, language, 2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('payoutHistory')}</h2>
            <span className="pill">{summary.payoutHistory.length} {t('completed')}</span>
          </div>
          <div className="panel-body space-y-2">
            {summary.payoutHistory.length === 0 ? (
              <div className="empty">
                <ReceiptText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <div className="empty-t">{t('noPayoutHistory')}</div>
              </div>
            ) : (
              summary.payoutHistory.map((order) => {
                const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
                return (
                  <div key={order.id} className="rounded-lg border border-border/60 bg-card/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {meta.corridorLabel}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatCustomerDate(order.created_at, language)}
                        </div>
                      </div>
                      <span className="pill">{order.payout_rail ?? t('nA')}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">{t('destinationCountry')}</div>
                        <div className="font-semibold">{meta.receiveCountry}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{t('destinationCurrency')}</div>
                        <div className="font-semibold">{meta.receiveCurrency}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{t('status')}</div>
                        <div className="font-semibold capitalize">{order.status.replace(/_/g, ' ')}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="dash-bottom">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('rateHistory')}</h2>
            <span className="pill">{summary.rateHistory.length} {t('orders')}</span>
          </div>
          <div className="panel-body space-y-2">
            {summary.rateHistory.length === 0 ? (
              <div className="empty">
                <TrendingUp className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <div className="empty-t">{t('noRateHistory')}</div>
              </div>
            ) : (
              summary.rateHistory.map((order) => {
                const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
                return (
                  <div key={order.id} className="rounded-lg border border-border/60 bg-card/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{meta.corridorLabel}</div>
                        <div className="text-xs text-muted-foreground">{formatCustomerDate(order.created_at, language)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-foreground">
                          {order.rate ? formatCustomerNumber(order.rate, language, 3) : '—'}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t('rate')}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('customerNotifications')}</h2>
            <span className="pill">{summary.recentNotifications.length}</span>
          </div>
          <div className="panel-body space-y-2">
            {summary.recentNotifications.length === 0 ? (
              <div className="empty">
                <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <div className="empty-t">{t('noNotifications')}</div>
              </div>
            ) : (
              summary.recentNotifications.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/60 bg-card/80 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.body ?? t('noDetails')}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{formatCustomerDate(item.created_at, language)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('corridorSupport')}</h2>
          <span className="pill">{supportedRails.length} {t('rails')}</span>
        </div>
        <div className="panel-body flex flex-wrap gap-2">
          {supportedRails.map((rail) => (
            <span key={rail.value} className="pill">
              {t(rail.labelKey as never)}
            </span>
          ))}
          {supportedRails.length === 0 && <span className="text-sm text-muted-foreground">{t('noRailsAvailable')}</span>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('customerPortalScope')}</h2>
          <span className="pill">{customerProfile?.country ?? CUSTOMER_COUNTRIES[0]}</span>
        </div>
        <div className="panel-body text-sm text-muted-foreground">
          {t('customerDashboardScopeNote')}
        </div>
      </section>
    </div>
  );
}
