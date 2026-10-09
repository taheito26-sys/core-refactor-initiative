import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, SearchCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { extractImportedReference } from '@/features/exchanges/tracker-import';
import type { TrackerState } from '@/lib/tracker-helpers';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeOrderLinks } from '../hooks/useExchangeOrderLinks';
import { useExchangeCredentials } from '../hooks/useExchangeCredentials';
import { syncExchange } from '../api';
import { monthKeyToRange } from '../month-range';
import { auditCompletedP2POrders, type P2PAuditRow } from '../p2p-audit';

const fmtN = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/**
 * "Check P2P": compares the completed P2P orders Binance reports for the
 * selected month with what the tracker holds. The button itself carries a red
 * alarm count whenever a completed order is missing, so it is visible
 * without opening anything; the dialog lists exactly which orders to register.
 */
export function P2PAuditButton({ state, monthKey, lang }: { state: TrackerState; monthKey: string; lang: 'en' | 'ar' }) {
  const isAr = lang === 'ar';
  const L = (en: string, ar: string) => (isAr ? ar : en);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const { data: orders } = useExchangeP2POrders({ includeDismissed: true });
  const { data: linksByOrder } = useExchangeOrderLinks();
  const { data: credentials } = useExchangeCredentials();

  const audit = useMemo(() => {
    const liveTrades = state.trades.filter(tr => !tr.voided || tr.usdtTransferKind);
    const liveEntityIds = new Set<string>([
      ...state.batches.map(b => b.id),
      ...liveTrades.map(tr => tr.id),
      ...(state.usdtTransfers || []).filter(x => !x.voided).map(x => x.id),
    ]);
    const importedReferences = new Set<string>(
      [...state.batches.map(b => extractImportedReference(b.note)), ...liveTrades.map(tr => extractImportedReference(tr.note))]
        .filter((r): r is string => !!r),
    );
    return auditCompletedP2POrders({ orders, linksByOrder, liveEntityIds, importedReferences, monthKey });
  }, [state.batches, state.trades, state.usdtTransfers, orders, linksByOrder, monthKey]);

  const alarms = audit.missing + audit.partial;
  const hasBinance = !!credentials?.some(c => c.exchange === 'binance');

  const refresh = async () => {
    if (monthKey === 'all' || !hasBinance) return;
    setRefreshing(true);
    try {
      await syncExchange('binance', 'p2p-orders', monthKeyToRange(monthKey));
      await qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
      toast.success(L('Binance orders refreshed', 'تم تحديث طلبات Binance'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L('Could not reach Binance', 'تعذر الاتصال بـ Binance'));
    } finally {
      setRefreshing(false);
    }
  };

  const visible = audit.rows.filter(r => showAll || r.status === 'missing' || r.status === 'partial');
  const tone = (r: P2PAuditRow) => (r.status === 'missing'
    ? 'border-red-500/50 bg-red-500/10'
    : r.status === 'partial'
      ? 'border-amber-500/50 bg-amber-500/10'
      : 'border-border/50 bg-card');
  const label = (r: P2PAuditRow) => (r.status === 'missing' ? L('NOT REGISTERED', 'غير مسجل')
    : r.status === 'partial' ? L('PARTIAL', 'جزئي')
    : r.status === 'resolved' ? L('Resolved', 'تمت المعالجة') : L('Registered', 'مسجل'));

  return (
    <>
      <button
        type="button"
        className="rowBtn"
        onClick={() => setOpen(true)}
        title={L('Check completed P2P orders against the tracker', 'مطابقة طلبات P2P المكتملة مع النظام')}
        style={alarms > 0 ? { borderColor: 'var(--bad)', color: 'var(--bad)', fontWeight: 800 } : undefined}
      >
        {alarms > 0
          ? <AlertTriangle className={cn('inline h-3.5 w-3.5 align-[-2px]', 'animate-pulse')} />
          : <SearchCheck className="inline h-3.5 w-3.5 align-[-2px]" />}
        {' '}P2P{alarms > 0 ? ` · ${alarms}` : ''}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-4" dir={isAr ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-base">{L('P2P check', 'مطابقة P2P')} · {monthKey === 'all' ? L('All months', 'كل الأشهر') : monthKey}</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            {L('Completed Binance P2P orders compared with the orders registered in the tracker.', 'مطابقة طلبات Binance P2P المكتملة مع الطلبات المسجلة في النظام.')}
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg border border-border/50 p-2"><div className="text-[10px] text-muted-foreground">{L('Completed', 'مكتملة')}</div><div className="font-mono text-base font-extrabold">{audit.total}</div></div>
            <div className="rounded-lg border border-border/50 p-2"><div className="text-[10px] text-muted-foreground">{L('Registered', 'مسجلة')}</div><div className="font-mono text-base font-extrabold" style={{ color: 'var(--good)' }}>{audit.registered}</div></div>
            <div className={cn('rounded-lg border p-2', alarms > 0 ? 'border-red-500/60 bg-red-500/10' : 'border-border/50')}><div className="text-[10px] text-muted-foreground">{L('Missing', 'ناقصة')}</div><div className="font-mono text-base font-extrabold" style={{ color: alarms > 0 ? 'var(--bad)' : undefined }}>{alarms}</div></div>
          </div>

          {alarms > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/60 bg-red-500/10 p-2.5 text-xs font-semibold text-red-600 dark:text-red-400" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {L(`${alarms} completed P2P order(s) on Binance are not fully registered — ${fmtN(audit.missingUSDT, 2)} USDT missing.`,
                  `${alarms} طلب P2P مكتمل على Binance غير مسجل بالكامل — ينقص ${fmtN(audit.missingUSDT, 2)} USDT.`)}
              </span>
            </div>
          ) : audit.total > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {L('Every completed P2P order this month is registered.', 'كل طلبات P2P المكتملة في هذا الشهر مسجلة.')}
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 p-2.5 text-xs text-muted-foreground">
              {hasBinance
                ? L('No completed P2P orders found for this period. Refresh from Binance to be sure.', 'لا توجد طلبات P2P مكتملة لهذه الفترة. حدّث من Binance للتأكد.')
                : L('No exchange is connected, so there is nothing to compare.', 'لا توجد منصة مربوطة، لذلك لا يوجد ما يُقارن.')}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              {L('Show registered too', 'إظهار المسجلة أيضًا')}
            </label>
            {hasBinance && monthKey !== 'all' && (
              <button type="button" className="rowBtn" onClick={refresh} disabled={refreshing}>
                {refreshing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <RefreshCw className="inline h-3 w-3" />} {L('Refresh from Binance', 'تحديث من Binance')}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            {visible.map(r => (
              <div key={r.order.id} className={cn('rounded-lg border p-2 text-xs', tone(r))}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{r.order.order_number}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-extrabold', r.status === 'missing' ? 'bg-red-500 text-white' : r.status === 'partial' ? 'bg-amber-500 text-black' : 'bg-muted text-muted-foreground')}>
                    {r.status === 'missing' ? '🚨 ' : ''}{label(r)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-bold">
                    {r.order.side === 'sell' ? L('Sell', 'بيع') : L('Buy', 'شراء')} {fmtN(Number(r.order.amount), 2)} USDT
                    <span className="font-normal text-muted-foreground"> @ {fmtN(Number(r.order.price), 2)} {r.order.fiat}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{r.ts ? new Date(r.ts).toLocaleString(isAr ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                </div>
                <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{r.order.counterparty || '—'}</span>
                  {r.status === 'partial' && <span>{L('Missing', 'ناقص')} {fmtN(r.missingUSDT, 2)} USDT</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {L('Register a missing order from the exchange list in the new-sale form.', 'سجّل الطلب الناقص من قائمة المنصات في نموذج البيع الجديد.')}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
