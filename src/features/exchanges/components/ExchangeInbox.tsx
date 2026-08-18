import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Loader2, PencilLine, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

export interface ExchangeOrderPayload {
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  fiat: string;
  amountUSDT: number;
  priceFiat: number;
  ts: number;
}

export interface ExchangeTransferPayload {
  exchange: ExchangeId;
  transferId: string;
  reference: string;
  kind: 'pay' | 'network';
  amountUSDT: number;
  buyPrice: number;
  ts: number;
}

type RowState = { status: 'idle' | 'saving' | 'done' | 'error'; message?: string };

/** Each row type gets its own accent so the list is scannable at a glance. */
const ACCENT = {
  buy: { bar: 'bg-emerald-500', amount: 'text-emerald-500 dark:text-emerald-400' },
  sell: { bar: 'bg-orange-500', amount: 'text-orange-500 dark:text-orange-400' },
  transfer: { bar: 'bg-cyan-500', amount: 'text-cyan-600 dark:text-cyan-400' },
} as const;

const EXCHANGE_CHIP: Record<ExchangeId, string> = {
  binance: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30',
  okx: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30',
};

const KIND_CHIP = {
  pay: { label: 'Pay', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/30' },
  network: { label: 'Network', cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 ring-teal-500/30' },
} as const;

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset', className)}>
      {children}
    </span>
  );
}

const fmtNum = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

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
 * Deliberately not a modal and not a collapsible: bounded height with internal
 * scrolling, so it never grows to bury the form and nothing shifts as rows come
 * and go. Rows wrap rather than overflow, since the panel sits inside a
 * narrow mobile sheet.
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
    () => (onImportTransfer ? (transfers ?? []).filter((tr) => tr.direction === 'in' && !tr.linked_at) : []),
    [transfers, onImportTransfer],
  );

  const total = pendingOrders.length + pendingTransfers.length;
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
        <span className="flex shrink-0 items-center gap-1 px-1.5 text-xs font-semibold text-emerald-500">
          <Check className="h-3.5 w-3.5" /> Added
        </span>
      );
    }
    return (
      <Button
        size="sm"
        className="h-7 shrink-0 px-2.5 text-xs"
        onClick={onImport}
        disabled={disabled || st === 'saving'}
      >
        {st === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {st === 'error' ? 'Retry' : 'Import'}
      </Button>
    );
  };

  const RowError = ({ st }: { st?: RowState }) =>
    st?.status === 'error' ? (
      <div className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
        <AlertCircle className="mt-px h-3 w-3 shrink-0" />
        <span className="min-w-0 break-words">{st.message}</span>
      </div>
    ) : null;

  return (
    <div className="w-full max-w-full overflow-hidden rounded-lg border border-primary/25 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold">
          <Inbox className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">From your exchanges</span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-2 py-px text-[11px] font-bold text-primary-foreground">
          {Math.max(0, total - settled)}
        </span>
      </div>

      <div className="max-h-[232px] space-y-1.5 overflow-y-auto overflow-x-hidden p-1.5">
        {pendingOrders.map((o) => {
          const st = rowState[o.id];
          const accent = ACCENT[side];
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
            <div key={o.id} className="flex w-full max-w-full overflow-hidden rounded-md border bg-muted/30">
              <div className={cn('w-1 shrink-0', accent.bar)} />
              <div className="min-w-0 flex-1 px-2 py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <div className="min-w-0 flex-1 basis-[55%]">
                    <div className="flex flex-wrap items-baseline gap-x-1 text-sm font-bold">
                      <span className={accent.amount}>{fmtNum(o.amount)} {o.asset}</span>
                      <span className="text-xs font-normal text-muted-foreground">@</span>
                      <span>{fmtNum(o.price, 4)} {o.fiat}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground/80">
                        {fmtNum(o.amount * o.price)} {o.fiat}
                      </span>
                      <Chip className={EXCHANGE_CHIP[o.exchange]}>{EXCHANGE_LABELS[o.exchange]}</Chip>
                      <span className="truncate">{fmtWhen(o.order_time)}</span>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
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
                <RowError st={st} />
              </div>
            </div>
          );
        })}

        {pendingTransfers.map((tr) => {
          const st = rowState[tr.id];
          const kind = KIND_CHIP[tr.kind];
          const raw = prices[tr.id] ?? (defaultPrice && defaultPrice > 0 ? String(Number(defaultPrice.toFixed(4))) : '');
          const parsed = parseFloat(raw);
          const valid = Number.isFinite(parsed) && parsed > 0;
          return (
            <div key={tr.id} className="flex w-full max-w-full overflow-hidden rounded-md border bg-muted/30">
              <div className={cn('w-1 shrink-0', ACCENT.transfer.bar)} />
              <div className="min-w-0 flex-1 px-2 py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <div className="min-w-0 flex-1 basis-[45%]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('text-sm font-bold', ACCENT.transfer.amount)}>
                        {fmtNum(tr.amount, 8)} {tr.asset}
                      </span>
                      <Chip className={kind.cls}>{kind.label}</Chip>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span>received</span>
                      <Chip className={EXCHANGE_CHIP[tr.exchange]}>{EXCHANGE_LABELS[tr.exchange]}</Chip>
                      <span className="truncate">{fmtWhen(tr.transfer_time)}</span>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Input
                      value={raw}
                      onChange={(e) => setPrices((p) => ({ ...p, [tr.id]: e.target.value }))}
                      inputMode="decimal"
                      placeholder={fiatLabel}
                      aria-label={`Buy price in ${fiatLabel}`}
                      className="h-7 w-[4.5rem] text-xs"
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
                  <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
                    Enter cost basis ({fiatLabel} per USDT) to import.
                  </div>
                )}
                <RowError st={st} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
