import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Check, Loader2, PencilLine, AlertCircle } from 'lucide-react';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS } from '../types';

export interface ExchangeOrderPayload {
  exchange: 'binance' | 'okx';
  orderId: string;
  orderNumber: string;
  fiat: string;
  amountUSDT: number;
  priceFiat: number;
  ts: number;
}

export interface ExchangeTransferPayload {
  exchange: 'binance' | 'okx';
  transferId: string;
  reference: string;
  kind: 'pay' | 'network';
  amountUSDT: number;
  buyPrice: number;
  ts: number;
}

type RowState = { status: 'idle' | 'saving' | 'done' | 'error'; message?: string };

const fmtNum = (n: number, max = 2) =>
  n.toLocaleString(undefined, { maximumFractionDigits: max });

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '—';

/**
 * Everything synced from a connected exchange that isn't in the tracker yet,
 * as one readable list with a per-row Import button.
 *
 * Deliberately not a modal and not a collapsible: the panel has a bounded
 * height and scrolls internally, so it never grows to bury the rest of the
 * page, and nothing shifts when rows come and go.
 */
export function ExchangeInbox({
  side,
  onImportOrder,
  onEditOrder,
  onImportTransfer,
  fiatLabel,
  defaultPrice,
}: {
  side: 'buy' | 'sell';
  onImportOrder: (order: ExchangeOrderPayload) => Promise<void> | void;
  onEditOrder: (order: ExchangeOrderPayload) => void;
  /** Only meaningful for the buy side -- received USDT becomes stock. */
  onImportTransfer?: (transfer: ExchangeTransferPayload) => Promise<void> | void;
  fiatLabel: string;
  /** Prefills each transfer's price box, typically the weighted-average cost. */
  defaultPrice?: number;
}) {
  const { data: orders } = useExchangeP2POrders();
  const { data: transfers } = useExchangeTransfers();
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});

  const pendingOrders = useMemo(
    () => (orders ?? []).filter((o) => o.side === side && !o.linked_at),
    [orders, side],
  );
  const pendingTransfers = useMemo(
    () =>
      onImportTransfer
        ? (transfers ?? []).filter((tr) => tr.direction === 'in' && !tr.linked_at)
        : [],
    [transfers, onImportTransfer],
  );

  const total = pendingOrders.length + pendingTransfers.length;
  // Rows that finished stay listed until their query refetches, so the count
  // shouldn't include them.
  const settled = Object.values(rowState).filter((s) => s.status === 'done').length;
  if (total === 0) return null;

  const set = (id: string, s: RowState) => setRowState((p) => ({ ...p, [id]: s }));

  const run = async (id: string, fn: () => Promise<void> | void) => {
    set(id, { status: 'saving' });
    try {
      await fn();
      set(id, { status: 'done' });
    } catch (err) {
      set(id, { status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const RowAction = ({ id, onImport, disabled }: { id: string; onImport: () => void; disabled?: boolean }) => {
    const st = rowState[id]?.status ?? 'idle';
    if (st === 'done') {
      return (
        <span className="flex items-center gap-1 px-2 text-xs font-medium text-green-600 dark:text-green-500">
          <Check className="h-3.5 w-3.5" /> Added
        </span>
      );
    }
    return (
      <Button size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={onImport} disabled={disabled || st === 'saving'}>
        {st === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {st === 'error' ? 'Retry' : 'Import'}
      </Button>
    );
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="text-xs font-semibold">From your exchanges</span>
        <Badge variant="secondary">{Math.max(0, total - settled)}</Badge>
      </div>

      <div className="max-h-[228px] space-y-1.5 overflow-y-auto p-2">
        {pendingOrders.map((o) => {
          const st = rowState[o.id];
          const payload: ExchangeOrderPayload = {
            exchange: o.exchange,
            orderId: o.id,
            orderNumber: o.order_number,
            fiat: o.fiat,
            amountUSDT: o.amount,
            priceFiat: o.price,
            ts: o.order_time ? new Date(o.order_time).getTime() : Date.now(),
          };
          return (
            <div key={o.id} className="rounded border bg-muted/30 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {fmtNum(o.amount)} {o.asset}
                    <span className="font-normal text-muted-foreground"> @ </span>
                    {fmtNum(o.price, 4)} {o.fiat}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    = {fmtNum(o.amount * o.price)} {o.fiat} · {EXCHANGE_LABELS[o.exchange]} · {fmtWhen(o.order_time)}
                    {o.counterparty ? ` · ${o.counterparty}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    title="Load into the form to adjust before saving"
                    onClick={() => onEditOrder(payload)}
                    disabled={st?.status === 'saving' || st?.status === 'done'}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                  </Button>
                  <RowAction id={o.id} onImport={() => run(o.id, () => onImportOrder(payload))} />
                </div>
              </div>
              {st?.status === 'error' && (
                <div className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                  <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                  <span>{st.message}</span>
                </div>
              )}
            </div>
          );
        })}

        {pendingTransfers.map((tr) => {
          const st = rowState[tr.id];
          const raw = prices[tr.id] ?? (defaultPrice && defaultPrice > 0 ? String(Number(defaultPrice.toFixed(4))) : '');
          const parsed = parseFloat(raw);
          const valid = Number.isFinite(parsed) && parsed > 0;
          return (
            <div key={tr.id} className="rounded border border-dashed bg-muted/30 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {fmtNum(tr.amount, 8)} {tr.asset}
                    <Badge variant="outline" className="ml-1.5 align-middle text-[10px]">
                      {tr.kind === 'pay' ? 'Pay' : 'Network'}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    received · {EXCHANGE_LABELS[tr.exchange]} · {fmtWhen(tr.transfer_time)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Input
                    value={raw}
                    onChange={(e) => setPrices((p) => ({ ...p, [tr.id]: e.target.value }))}
                    inputMode="decimal"
                    placeholder={fiatLabel}
                    aria-label={`Buy price in ${fiatLabel}`}
                    className="h-7 w-20 text-xs"
                    disabled={st?.status === 'saving' || st?.status === 'done'}
                  />
                  <RowAction
                    id={tr.id}
                    disabled={!valid}
                    onImport={() =>
                      run(tr.id, () =>
                        onImportTransfer!({
                          exchange: tr.exchange,
                          transferId: tr.id,
                          reference: tr.reference,
                          kind: tr.kind,
                          amountUSDT: tr.amount,
                          buyPrice: parsed,
                          ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : Date.now(),
                        }),
                      )
                    }
                  />
                </div>
              </div>
              {!valid && st?.status !== 'done' && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Enter the cost basis ({fiatLabel} per USDT) to import.
                </div>
              )}
              {st?.status === 'error' && (
                <div className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                  <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                  <span>{st.message}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
