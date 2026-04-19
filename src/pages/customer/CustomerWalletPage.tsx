import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ArrowDownLeft, ArrowUpRight, Loader2, Receipt, Wallet, TrendingUp } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import {
  deriveCustomerOrderMeta,
  formatCustomerDate,
  formatCustomerNumber,
  getCustomerOrderReceivedAmount,
  getCustomerOrderSentAmount,
  listCustomerOrders,
  type CustomerOrderRow,
} from '@/features/customer/customer-portal';
import { cn } from '@/lib/utils';

export default function CustomerWalletPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const t = useT();
  const language = settings.language === 'ar' ? 'ar' : 'en';
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['customer-wallet-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await listCustomerOrders(userId);
      if (error) throw error;
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const summary = useMemo(() => {
    const completed = orders.filter((order) => order.status === 'completed');
    const sent = completed.reduce((sum, order) => sum + getCustomerOrderSentAmount(order), 0);
    const received = completed.reduce((sum, order) => sum + getCustomerOrderReceivedAmount(order), 0);
    const byCurrency = new Map<string, { sent: number; received: number }>();

    for (const order of completed) {
      const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
      const sentBucket = byCurrency.get(meta.sendCurrency) ?? { sent: 0, received: 0 };
      sentBucket.sent += getCustomerOrderSentAmount(order);
      byCurrency.set(meta.sendCurrency, sentBucket);

      const receivedBucket = byCurrency.get(meta.receiveCurrency) ?? { sent: 0, received: 0 };
      receivedBucket.received += getCustomerOrderReceivedAmount(order);
      byCurrency.set(meta.receiveCurrency, receivedBucket);
    }

    return {
      completed,
      sent,
      received,
      byCurrency: [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [orders, customerProfile?.country]);

  const receiptOrder = summary.completed.find((order) => order.id === receiptOrderId) ?? null;

  const downloadReceipt = () => {
    if (!receiptOrder) return;
    const meta = deriveCustomerOrderMeta(receiptOrder, customerProfile?.country);
    const receiptId = `RCP-${receiptOrder.id.slice(0, 8).toUpperCase()}`;
    const blob = new Blob(
      [
        [
          receiptId,
          formatCustomerDate(receiptOrder.created_at, language),
          receiptOrder.status,
          meta.corridorLabel,
          `${formatCustomerNumber(getCustomerOrderSentAmount(receiptOrder), language, 2)} ${meta.sendCurrency}`,
          `${formatCustomerNumber(getCustomerOrderReceivedAmount(receiptOrder), language, 2)} ${meta.receiveCurrency}`,
          receiptOrder.payout_rail ?? t('nA'),
        ].join('\n'),
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${receiptId}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setReceiptOrderId(null);
  };

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="relative border-b border-border/60 px-4 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground/60">{t('customerWallet')}</div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">{t('payoutHistory')}</h1>
              <p className="text-sm text-muted-foreground">{t('customerWalletSubtitle')}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-sm shadow-sm">
              <div className="font-semibold text-foreground">{customerProfile?.display_name ?? t('customer')}</div>
              <div className="text-xs text-muted-foreground">{customerProfile?.country ?? t('country')}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="kpis kpis-p2p">
        <StatCard icon={Wallet} label={t('totalCash')} value={`${formatCustomerNumber(summary.sent + summary.received, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`} sublabel={`${t('historicalTotalSent')}: ${formatCustomerNumber(summary.sent, language, 2)} · ${t('historicalTotalReceived')}: ${formatCustomerNumber(summary.received, language, 2)}`} />
        <StatCard icon={ArrowDownLeft} label={t('historicalTotalSent')} value={`${formatCustomerNumber(summary.sent, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`} sublabel={t('completedOrdersOnly')} tone="good" />
        <StatCard icon={ArrowUpRight} label={t('historicalTotalReceived')} value={`${formatCustomerNumber(summary.received, language, 2)} ${customerProfile?.preferred_currency ?? 'QAR'}`} sublabel={t('completedOrdersOnly')} tone="good" />
        <StatCard icon={TrendingUp} label={t('completed')} value={formatCustomerNumber(summary.completed.length, language, 0)} sublabel={t('rateHistory')} tone="warn" />
      </div>

      <div className="dash-bottom">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('cashByCurrency')}</h2>
            <span className="pill">{summary.byCurrency.length} {t('currencies')}</span>
          </div>
          <div className="panel-body">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
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
                    {summary.byCurrency.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-muted-foreground">{t('noCashHistory')}</td>
                      </tr>
                    ) : (
                      summary.byCurrency.map(([currency, totals]) => (
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
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('payoutHistory')}</h2>
            <span className="pill">{summary.completed.length} {t('completed')}</span>
          </div>
          <div className="panel-body space-y-2">
            {summary.completed.length === 0 ? (
              <div className="empty">
                <Receipt className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <div className="empty-t">{t('noPayoutHistory')}</div>
              </div>
            ) : (
              summary.completed.map((order) => {
                const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setReceiptOrderId(order.id)}
                    className="w-full rounded-lg border border-border/60 bg-card/80 p-3 text-left transition-colors hover:bg-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{meta.corridorLabel}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatCustomerDate(order.created_at, language)}</div>
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
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('rateHistory')}</h2>
          <span className="pill">{summary.completed.filter((order) => order.rate !== null).length}</span>
        </div>
        <div className="panel-body space-y-2">
          {summary.completed.filter((order) => order.rate !== null).length === 0 ? (
            <div className="empty">
              <TrendingUp className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <div className="empty-t">{t('noRateHistory')}</div>
            </div>
          ) : (
            summary.completed
              .filter((order) => order.rate !== null)
              .slice(0, 8)
              .map((order) => {
                const meta = deriveCustomerOrderMeta(order, customerProfile?.country);
                return (
                  <div key={order.id} className="rounded-lg border border-border/60 bg-card/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{meta.corridorLabel}</div>
                        <div className="text-xs text-muted-foreground">{formatCustomerDate(order.created_at, language)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-foreground">{order.rate ? formatCustomerNumber(order.rate, language, 3) : t('nA')}</div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t('rate')}</div>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </section>

      {receiptOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                {t('receipt')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-sm">
                <ReceiptRow label={t('receiptId')} value={`RCP-${receiptOrder.id.slice(0, 8).toUpperCase()}`} />
                <ReceiptRow label={t('date')} value={formatCustomerDate(receiptOrder.created_at, language)} />
                <ReceiptRow label={t('corridorLabel')} value={deriveCustomerOrderMeta(receiptOrder, customerProfile?.country).corridorLabel} />
                <ReceiptRow label={t('sendCurrency')} value={deriveCustomerOrderMeta(receiptOrder, customerProfile?.country).sendCurrency} />
                <ReceiptRow label={t('receiveCurrency')} value={deriveCustomerOrderMeta(receiptOrder, customerProfile?.country).receiveCurrency} />
                <ReceiptRow label={t('payoutRail')} value={receiptOrder.payout_rail ?? t('nA')} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReceiptOrderId(null)}>
                  {t('close')}
                </Button>
                <Button className="flex-1 gap-1" onClick={downloadReceipt}>
                  <Download className="h-4 w-4" />
                  {t('download')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  tone = 'brand',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel: string;
  tone?: 'brand' | 'good' | 'warn';
}) {
  return (
    <div className={cn('kpi-card', tone === 'good' && 'border-emerald-500/25', tone === 'warn' && 'border-amber-500/25')}>
      <div className="kpi-head">
        <span className="kpi-badge" style={{ color: 'var(--brand)' }}>
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <div className="kpi-lbl">{label}</div>
      <div className={cn('kpi-val', tone === 'good' && 'good', tone === 'warn' && 'warn')}>{value}</div>
      <div className="kpi-sub">{sublabel}</div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right text-foreground">{value}</span>
    </div>
  );
}
