import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, SearchCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { extractImportedReference, stashTrackerImportPrefill } from '@/features/exchanges/tracker-import';
import type { TrackerState } from '@/lib/tracker-helpers';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeOrderLinks } from '../hooks/useExchangeOrderLinks';
import { useExchangeCredentials } from '../hooks/useExchangeCredentials';
import { dismissExchangeRecord, restoreExchangeRecord, syncExchange } from '../api';
import type { ExchangeOrderPayload } from './ExchangeInbox';
import { monthKeyToRange } from '../month-range';
import { auditCompletedP2POrders, type P2PAuditRow } from '../p2p-audit';

const fmtN = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/**
 * "Check P2P": compares the completed P2P orders Binance reports for the
 * selected month with what the tracker holds. The button itself carries a red
 * alarm count whenever a completed order is missing, so it is visible
 * without opening anything; the dialog lists exactly which orders to register.
 */
export function P2PAuditButton({
  state, monthKey, lang, onRegisterSell,
}: {
  state: TrackerState;
  monthKey: string;
  lang: 'en' | 'ar';
  /** Loads a sell order into the new-sale form, exactly like picking it from the exchange list. */
  onRegisterSell: (order: ExchangeOrderPayload) => void;
}) {
  const isAr = lang === 'ar';
  const L = (en: string, ar: string) => (isAr ? ar : en);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
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
  const notRegistered = alarms + audit.ignored;
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

  const refreshOrders = () => qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });

  /** Opens the normal entry form for this order; an order ignored earlier is brought back first. */
  const register = async (r: P2PAuditRow) => {
    const o = r.order;
    const remaining = r.missingUSDT > 0 ? r.missingUSDT : Number(o.amount);
    const isPartial = r.status === 'partial';
    const needsQarRate = o.fiat.toUpperCase() !== 'QAR';
    const payload: ExchangeOrderPayload = {
      exchange: o.exchange,
      orderId: o.id,
      orderNumber: o.order_number,
      amountUSDT: remaining,
      orderTotalUSDT: Number(o.amount),
      ts: r.ts || Date.now(),
      assigneeName: isPartial ? undefined : (o.counterparty ?? undefined),
      priceFiat: needsQarRate ? 0 : Number(o.price),
      needsQarRate,
      ...(needsQarRate ? { originalFiat: o.fiat, originalPriceFiat: Number(o.price), originalTotalFiat: Number(o.total) } : {}),
    };
    setBusyId(o.id);
    try {
      if (o.dismissed_at) {
        await restoreExchangeRecord({ source: 'order', id: o.id });
        await refreshOrders();
      }
      setOpen(false);
      if (o.side === 'buy') {
        stashTrackerImportPrefill({ ...payload, kind: 'batch' });
        navigate('/trading/stock');
      } else {
        onRegisterSell(payload);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L('Could not open this order', 'تعذر فتح هذا الطلب'));
    } finally {
      setBusyId(null);
    }
  };

  /** Ignoring a missing order records the decision; an order already ignored just stays ignored. */
  const ignore = async (r: P2PAuditRow) => {
    if (r.status === 'ignored') {
      setKept(prev => new Set(prev).add(r.order.id));
      return;
    }
    setBusyId(r.order.id);
    try {
      await dismissExchangeRecord({ source: 'order', id: r.order.id }, 'ignored');
      await refreshOrders();
      toast.success(L('Order ignored', 'تم تجاهل الطلب'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L('Could not ignore this order', 'تعذر تجاهل الطلب'));
    } finally {
      setBusyId(null);
    }
  };

  const visible = audit.rows.filter(r => showAll || r.status !== 'registered');
  const tone = (r: P2PAuditRow) => (r.status === 'missing'
    ? 'border-red-500/50 bg-red-500/10'
    : r.status === 'partial' || r.status === 'ignored'
      ? 'border-amber-500/50 bg-amber-500/10'
      : 'border-border/50 bg-card');
  const label = (r: P2PAuditRow) => (r.status === 'missing' ? L('NOT REGISTERED', 'غير مسجل')
    : r.status === 'partial' ? L('PARTIAL', 'جزئي')
    : r.status === 'ignored' ? L('IGNORED EARLIER', 'تم تجاهله سابقًا') : L('Registered', 'مسجل'));

  return (
    <>
      <button
        type="button"
        className="rowBtn"
        onClick={() => setOpen(true)}
        title={L('Check completed P2P orders against the tracker', 'مطابقة طلبات P2P المكتملة مع النظام')}
        style={alarms > 0
          ? { borderColor: 'var(--bad)', color: 'var(--bad)', fontWeight: 800 }
          : audit.ignored > 0 ? { borderColor: 'var(--warn)', color: 'var(--warn)', fontWeight: 800 } : undefined}
      >
        {notRegistered > 0
          ? <AlertTriangle className={cn('inline h-3.5 w-3.5 align-[-2px]', alarms > 0 && 'animate-pulse')} />
          : <SearchCheck className="inline h-3.5 w-3.5 align-[-2px]" />}
        {' '}P2P{notRegistered > 0 ? ` · ${notRegistered}` : ''}
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
            <div className={cn('rounded-lg border p-2', alarms > 0 ? 'border-red-500/60 bg-red-500/10' : notRegistered > 0 ? 'border-amber-500/60 bg-amber-500/10' : 'border-border/50')}><div className="text-[10px] text-muted-foreground">{L('Not registered', 'غير مسجلة')}</div><div className="font-mono text-base font-extrabold" style={{ color: alarms > 0 ? 'var(--bad)' : notRegistered > 0 ? 'var(--warn)' : undefined }}>{notRegistered}</div></div>
          </div>

          {notRegistered > 0 ? (
            <div className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-xs font-semibold', alarms > 0 ? 'border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400' : 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400')} role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {L(`${notRegistered} completed P2P order(s) on Binance are not registered in the tracker — ${fmtN(audit.missingUSDT, 2)} USDT.`,
                  `${notRegistered} طلب P2P مكتمل على Binance غير مسجل في النظام — ${fmtN(audit.missingUSDT, 2)} USDT.`)}
                {audit.ignored > 0 && ` ${L(`${audit.ignored} of them were ignored earlier.`, `${audit.ignored} منها تم تجاهلها سابقًا.`)}`}
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
                {r.status === 'ignored' && r.order.dismiss_note && (
                  <div className="mt-0.5 text-[10px] italic text-muted-foreground">{r.order.dismiss_note}</div>
                )}
                {r.status !== 'registered' && (
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="button" className="rowBtn flex-1" disabled={busyId === r.order.id} onClick={() => register(r)}
                      style={{ background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)', fontWeight: 700 }}>
                      {busyId === r.order.id ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {L('Register', 'تسجيل')}
                    </button>
                    <button type="button" className="rowBtn flex-1" disabled={busyId === r.order.id || (r.status === 'ignored' && kept.has(r.order.id))} onClick={() => ignore(r)}>
                      {r.status === 'ignored'
                        ? (kept.has(r.order.id) ? L('Kept ignored', 'مُتجاهَل') : L('Keep ignored', 'إبقاء التجاهل'))
                        : L('Ignore', 'تجاهل')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {L('Register opens the order in the normal entry form so you can confirm the price and customer before saving.', 'يفتح «تسجيل» الطلب في نموذج الإدخال المعتاد لتأكيد السعر والعميل قبل الحفظ.')}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
