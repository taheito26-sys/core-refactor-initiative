import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Receipt } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import {
  deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber,
  getCustomerOrderReceivedAmount, getCustomerOrderSentAmount,
  listCustomerOrders, type CustomerOrderRow,
} from '@/features/customer/customer-portal';

export default function CustomerWalletPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['c-wallet', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await listCustomerOrders(userId);
      return (data ?? []) as CustomerOrderRow[];
    },
    enabled: !!userId,
  });

  const completed = useMemo(() => orders.filter(o => o.status === 'completed'), [orders]);

  const summary = useMemo(() => {
    const byCurrency = new Map<string, { sent: number; received: number }>();
    for (const o of completed) {
      const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
      const sb = byCurrency.get(meta.sendCurrency) ?? { sent: 0, received: 0 };
      sb.sent += getCustomerOrderSentAmount(o);
      byCurrency.set(meta.sendCurrency, sb);
      const rb = byCurrency.get(meta.receiveCurrency) ?? { sent: 0, received: 0 };
      rb.received += getCustomerOrderReceivedAmount(o);
      byCurrency.set(meta.receiveCurrency, rb);
    }
    return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [completed, customerProfile?.country]);

  const receiptOrder = completed.find(o => o.id === receiptId) ?? null;

  const downloadReceipt = () => {
    if (!receiptOrder) return;
    const meta = deriveCustomerOrderMeta(receiptOrder, customerProfile?.country);
    const id = `RCP-${receiptOrder.id.slice(0, 8).toUpperCase()}`;
    const text = [
      id,
      `Date: ${formatCustomerDate(receiptOrder.created_at, lang)}`,
      `Corridor: ${meta.sendCurrency} → ${meta.receiveCurrency}`,
      `Amount: ${receiptOrder.amount} ${receiptOrder.currency}`,
      `Rate: ${receiptOrder.final_rate ?? receiptOrder.guide_rate ?? '—'}`,
      `Total: ${receiptOrder.final_total ?? receiptOrder.guide_total ?? '—'} ${meta.receiveCurrency}`,
      `Rail: ${receiptOrder.payout_rail ?? '—'}`,
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `${id}.txt`;
    a.click();
  };

  const fmt = (v: number, d = 2) => formatCustomerNumber(v, lang, d);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">{lang === 'ar' ? 'المحفظة' : 'Wallet'}</h1>

      {/* Summary by currency */}
      {summary.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {lang === 'ar' ? 'ملخص' : 'Summary'}
            </p>
          </div>
          {summary.map(([currency, { sent, received }]) => (
            <div key={currency} className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 last:border-0">
              <span className="text-sm font-semibold text-foreground">{currency}</span>
              <div className="flex gap-4 text-right">
                {sent > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'مُرسَل' : 'Sent'}</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(sent)}</p>
                  </div>
                )}
                {received > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'مُستلَم' : 'Received'}</p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-600">{fmt(received)}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed orders */}
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {lang === 'ar' ? 'السجل' : 'History'} · {completed.length}
        </p>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">…</div>
        ) : completed.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {lang === 'ar' ? 'لا توجد طلبات مكتملة' : 'No completed orders'}
          </div>
        ) : (
          <div className="space-y-2">
            {completed.map(o => {
              const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
              const rate = o.final_rate ?? o.guide_rate;
              return (
                <button
                  key={o.id}
                  onClick={() => setReceiptId(o.id === receiptId ? null : o.id)}
                  className="flex w-full items-center justify-between rounded-2xl border border-border/50 bg-card px-4 py-3 text-left transition-all active:scale-[0.99]"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {meta.sendCurrency} → {meta.receiveCurrency}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCustomerDate(o.created_at, lang)}
                      {rate != null && ` · ${fmt(rate, 4)}`}
                    </p>
                  </div>
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Receipt panel */}
      {receiptOrder && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-foreground">
              RCP-{receiptOrder.id.slice(0, 8).toUpperCase()}
            </p>
            <button
              onClick={downloadReceipt}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'تحميل' : 'Download'}
            </button>
          </div>
          {(() => {
            const meta = deriveCustomerOrderMeta(receiptOrder, customerProfile?.country);
            const rows = [
              [lang === 'ar' ? 'التاريخ' : 'Date', formatCustomerDate(receiptOrder.created_at, lang)],
              [lang === 'ar' ? 'المسار' : 'Corridor', `${meta.sendCurrency} → ${meta.receiveCurrency}`],
              [lang === 'ar' ? 'المبلغ' : 'Amount', `${receiptOrder.amount} ${receiptOrder.currency}`],
              [lang === 'ar' ? 'السعر' : 'Rate', receiptOrder.final_rate ?? receiptOrder.guide_rate ?? '—'],
              [lang === 'ar' ? 'الإجمالي' : 'Total', `${receiptOrder.final_total ?? receiptOrder.guide_total ?? '—'} ${meta.receiveCurrency}`],
              [lang === 'ar' ? 'القناة' : 'Rail', receiptOrder.payout_rail ?? '—'],
            ];
            return rows.map(([k, v]) => (
              <div key={String(k)} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground">{String(v)}</span>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
