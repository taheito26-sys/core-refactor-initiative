import { useMemo, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

export interface ExchangeOrderPayload {
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  amountUSDT: number;
  ts: number;
  /** Counterparty name the exchange reported, used to prefill the buyer/supplier field. */
  assigneeName?: string;
  /**
   * Unit price in QAR, or 0 when the order was settled in another fiat and the
   * user still has to supply a QAR rate in the form.
   */
  priceFiat: number;
  /** True when the exchange order was not in QAR, so the form must ask for the rate. */
  needsQarRate?: boolean;
  /** Present for a non-QAR order -- the original figures, kept on the saved record. */
  originalFiat?: string;
  originalPriceFiat?: number;
  originalTotalFiat?: number;
}

export interface ExchangeTransferPayload {
  exchange: ExchangeId;
  transferId: string;
  reference: string;
  kind: 'pay' | 'network';
  amountUSDT: number;
  buyPrice: number;
  ts: number;
  assigneeName?: string;
}

const fmtNum = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

/**
 * Everything synced from a connected exchange that isn't in the tracker yet,
 * offered purely as a prefill source for the form it sits in.
 *
 * Picking a row fills the normal entry form and nothing else happens -- the
 * user reviews it and saves with the same button as a hand-entered order, so
 * there is exactly one way to record a sale or a batch. When nothing is
 * waiting (no exchange connected, or everything already imported) this renders
 * nothing at all, leaving the form exactly as it was before exchanges existed.
 */
export function ExchangeInbox({
  side,
  onPick,
  onPickTransfer,
  defaultPrice,
  activeEntityIds,
}: {
  side: 'buy' | 'sell';
  onPick: (order: ExchangeOrderPayload) => void;
  /** Only meaningful for the buy side -- received USDT becomes stock. */
  onPickTransfer?: (transfer: ExchangeTransferPayload) => void;
  /** Cost basis used to prefill a transfer, typically the weighted-average cost. */
  defaultPrice?: number;
  /**
   * IDs of batches/trades still alive in the tracker. A row marked linked to
   * an id that's no longer in this set (because the batch/trade was deleted)
   * is treated as pending again, so deleting an import lets it be re-imported.
   */
  activeEntityIds?: Set<string>;
}) {
  const { data: orders } = useExchangeP2POrders();
  const { data: transfers } = useExchangeTransfers();
  const [open, setOpen] = useState(false);

  // Only what still needs importing. Already-imported rows are trades/batches
  // in the table below now, so repeating them here would just be noise.
  const pendingOrders = useMemo(() => {
    const pending = (linkedAt: string | null, linkedEntityId: string | null) => {
      if (!linkedAt) return true;
      if (!activeEntityIds || !linkedEntityId) return false;
      return !activeEntityIds.has(linkedEntityId);
    };
    return (orders ?? [])
      .filter((o) => o.side === side && pending(o.linked_at, o.linked_entity_id))
      .sort((a, b) => (b.order_time ? new Date(b.order_time).getTime() : 0) - (a.order_time ? new Date(a.order_time).getTime() : 0));
  }, [orders, side, activeEntityIds]);

  const pendingTransfers = useMemo(() => {
    if (!onPickTransfer) return [];
    const pending = (linkedAt: string | null, linkedEntityId: string | null) => {
      if (!linkedAt) return true;
      if (!activeEntityIds || !linkedEntityId) return false;
      return !activeEntityIds.has(linkedEntityId);
    };
    return (transfers ?? [])
      .filter((tr) => tr.direction === 'in' && pending(tr.linked_at, tr.linked_entity_id))
      .sort((a, b) => (b.transfer_time ? new Date(b.transfer_time).getTime() : 0) - (a.transfer_time ? new Date(a.transfer_time).getTime() : 0));
  }, [transfers, onPickTransfer, activeEntityIds]);

  const count = pendingOrders.length + pendingTransfers.length;
  if (count === 0) return null;

  const exchangeNames = Array.from(
    new Set([...pendingOrders.map((o) => o.exchange), ...pendingTransfers.map((tr) => tr.exchange)]),
  ).map((id) => EXCHANGE_LABELS[id]);

  const pick = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div className="w-full max-w-full overflow-hidden rounded-lg border border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold"
      >
        <Download className="h-3 w-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          {count} new from {exchangeNames.join(' & ')}
        </span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="max-h-[168px] space-y-1 overflow-y-auto overflow-x-hidden border-t border-primary/20 p-1">
          {pendingOrders.map((o) => {
            const needsQarRate = o.fiat.toUpperCase() !== 'QAR';
            return (
              <button
                key={o.id}
                type="button"
                className="block w-full rounded border bg-card px-1.5 py-1 text-left hover:border-primary/50"
                onClick={() =>
                  pick(() =>
                    onPick({
                      exchange: o.exchange,
                      orderId: o.id,
                      orderNumber: o.order_number,
                      amountUSDT: o.amount,
                      ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
                      assigneeName: o.counterparty ?? undefined,
                      priceFiat: needsQarRate ? 0 : o.price,
                      needsQarRate,
                      ...(needsQarRate
                        ? { originalFiat: o.fiat, originalPriceFiat: o.price, originalTotalFiat: o.amount * o.price }
                        : {}),
                    }),
                  )
                }
              >
                <div className="truncate text-[12px] font-bold leading-tight">
                  {fmtNum(o.amount)} USDT @ {fmtNum(o.price, 4)} {o.fiat}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {fmtNum(o.amount * o.price)} {o.fiat} · {EXCHANGE_LABELS[o.exchange]}
                  {o.counterparty ? ` · ${o.counterparty}` : ''}
                  {o.order_time ? ` · ${fmtWhen(o.order_time)}` : ''}
                </div>
              </button>
            );
          })}

          {pendingTransfers.map((tr) => (
            <button
              key={tr.id}
              type="button"
              className="block w-full rounded border border-dashed bg-card px-1.5 py-1 text-left hover:border-primary/50"
              onClick={() =>
                pick(() =>
                  onPickTransfer!({
                    exchange: tr.exchange,
                    transferId: tr.id,
                    reference: tr.reference,
                    kind: tr.kind,
                    amountUSDT: tr.amount,
                    buyPrice: defaultPrice && defaultPrice > 0 ? defaultPrice : 0,
                    ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : Date.now(),
                    assigneeName: tr.counterparty ?? undefined,
                  }),
                )
              }
            >
              <div className="truncate text-[12px] font-bold leading-tight">
                {fmtNum(tr.amount, 8)} USDT received
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {EXCHANGE_LABELS[tr.exchange]} {tr.kind === 'pay' ? 'Pay' : 'network'}
                {tr.counterparty ? ` · ${tr.counterparty}` : ''}
                {tr.transfer_time ? ` · ${fmtWhen(tr.transfer_time)}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
